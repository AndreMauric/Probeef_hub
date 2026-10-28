import { Router } from 'express';
import {
  clearFailedLogins,
  hashPassword,
  loginAllowed,
  publicUser,
  registerFailedLogin,
  requireAuth,
  userClients,
  validatePassword,
  verifyAgainstDummy,
  verifyPassword,
} from '../auth.js';
import { recordEvent } from '../accessLog.js';
import { consumeResetToken } from '../passwordReset.js';
import { db, save } from '../store.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const key = `${req.ip}|${email}`;

  if (!loginAllowed(key)) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' });
  }

  const user = db().users.find((u) => u.email === email);
  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyAgainstDummy(password);

  if (!user || !ok || !user.active) {
    registerFailedLogin(key);
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }
  // Empresa desativada bloqueia quem é dela, a não ser que a pessoa tenha alguma ferramenta liberada.
  // Usuário sem cliente nenhum (só ferramentas) entra normalmente.
  const toolApproved = user.confinamento?.status === 'approved' || user.pasto?.status === 'approved' || Boolean(user.bmkValidator);
  if (user.role === 'client' && user.clientIds.length && !userClients(user).length && !toolApproved) {
    return res.status(403).json({ error: 'O acesso da sua empresa está desativado. Fale com o administrador.' });
  }

  clearFailedLogins(key);
  user.lastLoginAt = new Date().toISOString();
  await save();
  req.session = { uid: user.id, sv: user.sessionVersion };
  if (user.role === 'client') recordEvent('login', { userId: user.id });
  res.json({ user: publicUser(user) });
});

// Nova senha a partir do link enviado pelo WhatsApp (o token chega no corpo, nunca na URL do servidor).
authRouter.post('/reset-password', async (req, res) => {
  const key = `reset|${req.ip}`;
  if (!loginAllowed(key)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' });
  const problem = validatePassword(req.body?.password);
  if (problem) return res.status(400).json({ error: problem });
  const user = consumeResetToken(req.body?.token);
  if (!user) {
    registerFailedLogin(key);
    return res.status(400).json({ error: 'Este link é inválido ou já venceu. Peça um novo pelo WhatsApp.' });
  }
  user.passwordHash = await hashPassword(req.body.password);
  user.mustChangePassword = false;
  user.sessionVersion += 1;
  await save();
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user, req.impersonator) });
});

// Admin sai do "entrar como" e volta para a própria sessão.
authRouter.post('/stop-impersonation', requireAuth, (req, res) => {
  if (!req.impersonator) return res.status(400).json({ error: 'Você não está vendo o portal como outro usuário.' });
  req.session = { uid: req.impersonator.id, sv: req.impersonator.sessionVersion };
  res.json({ ok: true });
});

authRouter.post('/password', requireAuth, async (req, res) => {
  if (req.impersonator) return res.status(403).json({ error: 'Não é possível trocar a senha enquanto você vê o portal como outro usuário.' });
  const { currentPassword, newPassword } = req.body || {};
  if (!(await verifyPassword(String(currentPassword || ''), req.user.passwordHash))) {
    return res.status(400).json({ error: 'A senha atual está incorreta.' });
  }
  const problem = validatePassword(newPassword);
  if (problem) return res.status(400).json({ error: problem });

  req.user.passwordHash = await hashPassword(newPassword);
  req.user.mustChangePassword = false;
  req.user.sessionVersion += 1;
  await save();
  req.session = { uid: req.user.id, sv: req.user.sessionVersion };
  res.json({ ok: true });
});

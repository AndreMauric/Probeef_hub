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
import { PENDING_TTL_MS, checkCode, mfaEnabled, mfaRequired, startSetup } from '../mfa.js';
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
  const toolApproved = user.confinamento?.status === 'approved' || user.pasto?.status === 'approved';
  if (user.role === 'client' && !user.bmkOnly && user.clientIds.length && !userClients(user).length && !toolApproved) {
    return res.status(403).json({ error: 'O acesso da sua empresa está desativado. Fale com o administrador.' });
  }

  clearFailedLogins(key);
  // Senha certa, mas falta o código do autenticador: a sessão fica pendente (sem uid) até /mfa/verify.
  if (mfaRequired(user)) {
    req.session = { mfa: { uid: user.id, sv: user.sessionVersion, at: Date.now() } };
    return res.json({ mfa: mfaEnabled(user) ? 'verify' : 'setup' });
  }
  await finishLogin(req, user);
  res.json({ user: publicUser(user) });
});

async function finishLogin(req, user, extra = {}) {
  user.lastLoginAt = new Date().toISOString();
  await save();
  req.session = { uid: user.id, sv: user.sessionVersion, ...extra };
  if (user.role === 'client') recordEvent('login', { userId: user.id });
}

// Quem acertou a senha e está na etapa do código.
function pendingUser(req) {
  const p = req.session?.mfa;
  if (!p || Date.now() - p.at > PENDING_TTL_MS) return null;
  const user = db().users.find((u) => u.id === p.uid);
  return user && user.active && user.sessionVersion === p.sv ? user : null;
}
const pendingExpired = (res) => res.status(401).json({ error: 'A etapa de verificação expirou. Entre com a senha de novo.' });

// Primeira vez: gera o segredo e o QR code para cadastrar no aplicativo autenticador.
authRouter.post('/mfa/setup', async (req, res) => {
  const user = pendingUser(req);
  if (!user) return pendingExpired(res);
  if (mfaEnabled(user)) return res.status(400).json({ error: 'A verificação em duas etapas já está configurada.' });
  const setup = await startSetup(user);
  await save();
  res.json(setup);
});

authRouter.post('/mfa/verify', async (req, res) => {
  const user = pendingUser(req);
  if (!user) return pendingExpired(res);
  const key = `mfa|${user.id}`;
  if (!loginAllowed(key)) {
    req.session = null;
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' });
  }
  const result = checkCode(user, req.body?.code);
  if (!result.ok) {
    registerFailedLogin(key);
    if (result.expired) return res.status(400).json({ error: 'A configuração expirou. Gere um novo QR code.' });
    return res.status(400).json({ error: 'Código incorreto. Confira o código atual no aplicativo.' });
  }
  clearFailedLogins(key);
  await finishLogin(req, user, { m: 1 });
  res.json({ user: publicUser(user), recoveryCodes: result.recoveryCodes, usedRecovery: result.usedRecovery, remaining: result.remaining });
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
  req.session = { uid: req.impersonator.id, sv: req.impersonator.sessionVersion, m: req.session.m };
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
  req.session = { uid: req.user.id, sv: req.user.sessionVersion, m: req.session.m };
  res.json({ ok: true });
});

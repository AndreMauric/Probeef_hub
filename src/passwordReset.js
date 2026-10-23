// Links de redefinição de senha: o token vai só para o usuário (pelo WhatsApp); aqui fica
// apenas o hash dele. Cada link vale 30 minutos e uma única vez.
import crypto from 'node:crypto';
import { db, save } from './store.js';

const TTL_MS = 30 * 60 * 1000;
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function createResetToken(user) {
  const data = db();
  const now = Date.now();
  const token = crypto.randomBytes(32).toString('base64url');
  // Um link ativo por usuário; os vencidos são descartados.
  data.resetTokens = (data.resetTokens || []).filter((t) => t.userId !== user.id && t.expiresAt > now);
  data.resetTokens.push({ hash: hash(token), userId: user.id, expiresAt: now + TTL_MS });
  await save();
  return token;
}

// Devolve o usuário do token (e invalida o token), ou null se for inválido ou vencido.
export function consumeResetToken(token) {
  const data = db();
  const now = Date.now();
  const entry = (data.resetTokens || []).find((t) => t.hash === hash(String(token || '')) && t.expiresAt > now);
  data.resetTokens = (data.resetTokens || []).filter((t) => t !== entry && t.expiresAt > now);
  if (!entry) return null;
  const user = data.users.find((u) => u.id === entry.userId && u.active);
  return user || null;
}

export const resetLink = (baseUrl, token) => `${String(baseUrl).replace(/\/$/, '')}/redefinir-senha#${token}`;

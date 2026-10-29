import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './store.js';

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, salt, expected] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !expected) return false;
  const key = await scrypt(password, Buffer.from(salt, 'base64'), KEY_LENGTH);
  const exp = Buffer.from(expected, 'base64');
  return exp.length === key.length && crypto.timingSafeEqual(key, exp);
}

// Hash usado quando o e-mail não existe, para o tempo de resposta não revelar quais e-mails estão cadastrados.
const dummyHash = await hashPassword(crypto.randomBytes(16).toString('hex'));
export const verifyAgainstDummy = (password) => verifyPassword(password, dummyHash);

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'A senha precisa ter pelo menos 10 caracteres.';
  }
  return null;
}

export function generatePassword() {
  return crypto.randomBytes(12).toString('base64url');
}

// Carrega o usuário da sessão. A sessão guarda a versão da sessão do usuário:
// trocar a senha ou desativar o usuário invalida todos os logins abertos.
export function loadUser(req, _res, next) {
  const { uid, sv, imp, isv } = req.session || {};
  const users = db().users;
  const user = uid ? users.find((u) => u.id === uid) : null;
  // Admin "entrando como" um usuário: a sessão guarda também o admin, que precisa continuar
  // ativo, administrador e com a mesma versão de sessão; senão tudo cai.
  const impersonator = imp ? users.find((u) => u.id === imp) : null;
  const impersonationOk = !imp || (impersonator && impersonator.active && impersonator.role === 'admin' && impersonator.sessionVersion === isv);
  if (user && user.active && user.sessionVersion === sv && impersonationOk) {
    req.user = user;
    req.impersonator = impersonator || null;
  } else {
    req.user = null;
    req.impersonator = null;
    if (uid) req.session = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a administradores.' });
  next();
}

// Limite de tentativas de login por IP + e-mail.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginAllowed(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) return true;
  return entry.count < MAX_ATTEMPTS;
}

export function registerFailedLogin(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) attempts.set(key, { first: now, count: 1 });
  else entry.count += 1;
}

export function clearFailedLogins(key) {
  attempts.delete(key);
}

// Clientes ativos aos quais o usuário tem acesso, em ordem alfabética.
export function userClients(user) {
  const ids = new Set(user.clientIds || []);
  return db()
    .clients.filter((c) => ids.has(c.id) && c.active)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function publicUser(user, impersonator = null) {
  const clients = userClients(user);
  return {
    impersonatedBy: impersonator ? { name: impersonator.name } : null,
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    clients: clients.map((c) => ({ id: c.id, name: c.name })),
    mustChangePassword: Boolean(user.mustChangePassword),
    // Perfil no Benchmarking (src/bmkTeam.js).
    kind: user.role === 'admin' ? 'admin' : user.kind || 'cliente',
  };
}

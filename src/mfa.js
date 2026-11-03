// Verificação em duas etapas (TOTP, RFC 6238): código de 6 dígitos de um aplicativo autenticador
// (Google Authenticator, Microsoft Authenticator...). Obrigatória para administradores (desligue
// localmente com ADMIN_MFA=off); quem não é admin só passa por ela se tiver ativado.
// O segredo fica criptografado (secretBox) em user.mfa.box; os códigos de recuperação, só o hash.
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { config } from './config.js';
import { open, seal } from './secretBox.js';
import { db } from './store.js';

const STEP = 30;
const DIGITS = 6;
const RECOVERY_COUNT = 8;
const SETUP_TTL_MS = 15 * 60 * 1000;
export const PENDING_TTL_MS = 10 * 60 * 1000;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of text.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', unbase32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

const nowStep = () => Math.floor(Date.now() / 1000 / STEP);
const sameCode = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Aceita o código do passo atual e de um passo antes/depois (relógio do celular adiantado ou atrasado).
// Devolve o passo usado, ou null. Um passo já usado não vale de novo (lastStep).
function matchStep(secret, code, lastStep = -1) {
  const now = nowStep();
  for (const step of [now - 1, now, now + 1]) {
    if (step > lastStep && sameCode(totp(secret, step), code)) return step;
  }
  return null;
}

const hashRecovery = (code) => crypto.createHash('sha256').update(code.replace(/[^a-z0-9]/gi, '').toLowerCase()).digest('hex');
function newRecoveryCodes() {
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const raw = base32(crypto.randomBytes(7)).slice(0, 10).toLowerCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export const mfaEnabled = (user) => Boolean(user.mfa?.enabledAt);
export const mfaRequired = (user) => mfaEnabled(user) || (user.role === 'admin' && config.requireAdminMfa);

// Começa (ou recomeça) a configuração: segredo novo guardado como pendente até o primeiro código certo.
export async function startSetup(user) {
  const secret = base32(crypto.randomBytes(20));
  user.mfaPending = { box: seal(secret), at: new Date().toISOString() };
  const label = encodeURIComponent(`${config.portalName}:${user.email}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(config.portalName)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
}

// Confere o código. Na configuração, o primeiro código certo ativa e devolve os códigos de recuperação.
// Devolve { ok, recoveryCodes?, usedRecovery?, remaining? }.
export function checkCode(user, input) {
  const code = String(input || '').replace(/\s/g, '');
  if (mfaEnabled(user)) {
    const secret = open(user.mfa.box);
    if (secret && /^\d{6}$/.test(code)) {
      const step = matchStep(secret, code, user.mfa.lastStep ?? -1);
      if (step !== null) {
        user.mfa.lastStep = step;
        return { ok: true };
      }
      return { ok: false };
    }
    // Código de recuperação (uso único).
    const hash = hashRecovery(code);
    const i = (user.mfa.recovery || []).indexOf(hash);
    if (code.length >= 10 && i >= 0) {
      user.mfa.recovery.splice(i, 1);
      audit(user, 'mfa.recovery-used');
      return { ok: true, usedRecovery: true, remaining: user.mfa.recovery.length };
    }
    return { ok: false };
  }
  const pending = user.mfaPending;
  if (!pending || Date.now() - Date.parse(pending.at) > SETUP_TTL_MS) return { ok: false, expired: true };
  const secret = open(pending.box);
  const step = secret && /^\d{6}$/.test(code) ? matchStep(secret, code) : null;
  if (step === null) return { ok: false };
  const recoveryCodes = newRecoveryCodes();
  user.mfa = { box: pending.box, enabledAt: new Date().toISOString(), lastStep: step, recovery: recoveryCodes.map(hashRecovery) };
  delete user.mfaPending;
  audit(user, 'mfa.enabled');
  return { ok: true, recoveryCodes };
}

// Admin zera a verificação de alguém (celular perdido): a pessoa configura de novo no próximo login.
export function resetMfa(user, actor) {
  delete user.mfa;
  delete user.mfaPending;
  user.sessionVersion += 1;
  audit(user, 'mfa.reset', actor);
}

function audit(user, action, actor = user) {
  const data = db();
  data.audit = [...(data.audit || []), { at: new Date().toISOString(), action, adminId: actor.id, userId: user.id }].slice(-1000);
}

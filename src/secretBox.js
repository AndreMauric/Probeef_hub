// Criptografia de segredos guardados nos cadastros (ex.: chave da Anthropic de cada usuário).
// AES-256-GCM com a chave de KEY_ENCRYPTION_SECRET.
// Para trocar a chave sem perder o que já está guardado: coloque o valor antigo em
// KEY_ENCRYPTION_SECRET_OLD e o novo em KEY_ENCRYPTION_SECRET. Na partida, o servidor
// recriptografa tudo com a chave nova (resealAll); depois a variável _OLD pode ser apagada.
import crypto from 'node:crypto';
import { config } from './config.js';

if (!process.env.KEY_ENCRYPTION_SECRET && config.isProduction) {
  console.warn('[aviso] KEY_ENCRYPTION_SECRET não definido: usando um valor derivado do SESSION_SECRET.');
}

const derive = (secret) => crypto.createHash('sha256').update(secret).digest();
const key = derive(process.env.KEY_ENCRYPTION_SECRET || `${config.sessionSecret}|chaves-dos-usuarios`);
const oldKey = process.env.KEY_ENCRYPTION_SECRET_OLD ? derive(process.env.KEY_ENCRYPTION_SECRET_OLD) : null;

export function seal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function openWith(k, box) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// Devolve o texto original, ou null se o segredo não puder ser aberto (ex.: veio de outro servidor).
export function open(box) {
  return openWith(key, box) ?? (oldKey ? openWith(oldKey, box) : null);
}

// Troca de chave: recriptografa com a chave nova o que ainda estava na antiga. Devolve quantos mudaram.
export function resealAll(boxes) {
  if (!oldKey) return 0;
  let changed = 0;
  for (const holder of boxes) {
    if (openWith(key, holder.box) !== null) continue;
    const plain = openWith(oldKey, holder.box);
    if (plain === null) continue;
    holder.box = seal(plain);
    changed += 1;
  }
  return changed;
}

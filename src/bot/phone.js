// Telefones no formato do WhatsApp: só dígitos, com DDI (ex.: 5561999998888).
import { db } from '../store.js';

export const normalizePhone = (raw) => String(raw || '').replace(/\D+/g, '');

// Celulares do Brasil às vezes chegam do WhatsApp sem o nono dígito (556199998888 em vez de
// 5561999998888). Compara as duas formas para reconhecer o mesmo número.
export function phoneVariants(raw) {
  const digits = normalizePhone(raw);
  const variants = new Set([digits]);
  const br = digits.match(/^55(\d{2})(9?)(\d{8})$/);
  if (br) {
    variants.add(`55${br[1]}9${br[3]}`);
    variants.add(`55${br[1]}${br[3]}`);
  }
  return variants;
}

export function samePhone(a, b) {
  if (!a || !b) return false;
  const va = phoneVariants(a);
  return [...phoneVariants(b)].some((v) => va.has(v));
}

// Usuário de cliente ativo dono desse número (ou null).
export function findUserByPhone(phone) {
  return db().users.find((u) => u.active && u.role === 'client' && samePhone(u.phone, phone)) || null;
}

// Valida o telefone digitado no cadastro: precisa ter DDI + DDD + número (12 a 15 dígitos).
export function cleanPhoneInput(raw) {
  const digits = normalizePhone(raw);
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) return `55${digits}`; // brasileiro sem o 55
  return digits;
}

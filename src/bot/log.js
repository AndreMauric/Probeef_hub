// Últimas mensagens do bot (recebidas e enviadas), só em memória, para acompanhar no admin.
const MAX = 300;
const entries = [];

// Links de redefinição de senha não ficam no registro: o código secreto é ocultado.
const redact = (text) => String(text || '').replace(/(redefinir-senha#)[\w-]+/g, '$1(oculto)');

export function logBotMessage({ direction, userId = null, phone = null, text, channel = 'whatsapp' }) {
  entries.push({ at: new Date().toISOString(), direction, userId, phone, channel, text: redact(text).slice(0, 500) });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
}

export const recentBotMessages = () => [...entries].reverse();

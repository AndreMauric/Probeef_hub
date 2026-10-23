// Conector com a API oficial do WhatsApp (WhatsApp Business Platform / Cloud API da Meta).
// Fica desligado até as variáveis WHATSAPP_* serem preenchidas.
import crypto from 'node:crypto';

const cfg = () => ({
  token: process.env.WHATSAPP_TOKEN || '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  appSecret: process.env.WHATSAPP_APP_SECRET || '',
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
  version: process.env.WHATSAPP_GRAPH_VERSION || 'v21.0',
  updateTemplate: process.env.WHATSAPP_TEMPLATE_UPDATE || '',
  // Alertas e resumos da Ferramenta CCV enviados pelo admin: {{1}} nome, {{2}} fazenda, {{3}} texto (uma linha).
  ccvTemplate: process.env.WHATSAPP_TEMPLATE_CCV || '',
  templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR',
});

export function whatsappStatus() {
  const c = cfg();
  return {
    configured: Boolean(c.token && c.phoneNumberId && c.appSecret && c.verifyToken),
    updateTemplate: c.updateTemplate || null,
    ccvTemplate: c.ccvTemplate || null,
  };
}

const graph = (path) => `https://graph.facebook.com/${cfg().version}/${path}`;

async function post(path, body) {
  const res = await fetch(graph(path), {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg().token}`, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp recusou o envio (${res.status}): ${data?.error?.message || 'sem detalhes'}`);
  return data;
}

export async function sendText(to, text) {
  // O WhatsApp aceita até 4096 caracteres por mensagem.
  return post(`${cfg().phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: String(text).slice(0, 4096), preview_url: true },
  });
}

export async function sendDocument(to, buffer, fileName, caption) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'application/pdf');
  form.append('file', new Blob([buffer], { type: 'application/pdf' }), fileName);
  const media = await post(`${cfg().phoneNumberId}/media`, form);
  return post(`${cfg().phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'document',
    document: { id: media.id, filename: fileName, caption: caption || undefined },
  });
}

// Mensagens que a empresa inicia (avisos) precisam de um modelo aprovado pela Meta.
export async function sendTemplate(to, name, params = []) {
  return post(`${cfg().phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name,
      language: { code: cfg().templateLanguage },
      components: params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text) })) }] : [],
    },
  });
}

// Confere a assinatura que a Meta coloca em cada notificação (X-Hub-Signature-256).
export function validSignature(rawBody, header) {
  const secret = cfg().appSecret;
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export const verifyToken = () => cfg().verifyToken;

// Extrai as mensagens de texto recebidas de uma notificação da Meta.
export function incomingTexts(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      for (const msg of change.value?.messages || []) {
        const text = msg.type === 'text' ? msg.text?.body : msg.type === 'button' ? msg.button?.text : msg.interactive?.button_reply?.title;
        if (msg.from && msg.id) out.push({ id: msg.id, from: msg.from, text: text || '' , type: msg.type });
      }
    }
  }
  return out;
}

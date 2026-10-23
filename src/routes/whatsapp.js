// Webhook do WhatsApp (Cloud API da Meta). A Meta chama GET para verificar o endereço e POST a
// cada mensagem recebida. O corpo chega bruto (Buffer) para conferir a assinatura.
import { Router } from 'express';
import { config } from '../config.js';
import { handleMessage } from '../bot/engine.js';
import { logBotMessage } from '../bot/log.js';
import { findUserByPhone } from '../bot/phone.js';
import { incomingTexts, sendDocument, sendText, validSignature, verifyToken, whatsappStatus } from '../bot/whatsapp.js';

export const whatsappRouter = Router();

whatsappRouter.get('/', (req, res) => {
  const ok = req.query['hub.mode'] === 'subscribe' && verifyToken() && req.query['hub.verify_token'] === verifyToken();
  if (!ok) return res.sendStatus(403);
  res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
});

// A Meta reenvia a mesma mensagem se não receber resposta a tempo: guarda os ids já tratados.
const seen = new Map();
const SEEN_TTL_MS = 60 * 60 * 1000;

function firstTime(id) {
  const now = Date.now();
  for (const [key, at] of seen) if (now - at > SEEN_TTL_MS) seen.delete(key);
  if (seen.has(id)) return false;
  seen.set(id, now);
  return true;
}

async function handleIncoming(message) {
  const user = findUserByPhone(message.from);
  logBotMessage({ direction: 'in', userId: user?.id, phone: message.from, text: message.text || `[${message.type}]` });
  const send = async (reply) => {
    if (reply.type === 'text') {
      await sendText(message.from, reply.text);
      logBotMessage({ direction: 'out', userId: user?.id, phone: message.from, text: reply.text });
    } else if (reply.type === 'document') {
      await sendDocument(message.from, reply.buffer, reply.fileName, reply.caption);
      logBotMessage({ direction: 'out', userId: user?.id, phone: message.from, text: `[PDF] ${reply.fileName}` });
    }
  };
  if (!user) {
    await send({
      type: 'text',
      text: 'Olá! Este número não está cadastrado no BI Probeef. Peça ao administrador do portal para incluir seu telefone no seu usuário.',
    });
    return;
  }
  await handleMessage({ user, text: message.text, send, channel: 'whatsapp', baseUrl: config.publicUrl });
}

whatsappRouter.post('/', (req, res) => {
  if (!whatsappStatus().configured) return res.sendStatus(503);
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!validSignature(raw, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  // Responde logo (a Meta espera poucos segundos) e processa em seguida.
  res.sendStatus(200);
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    return;
  }
  for (const message of incomingTexts(payload)) {
    if (!firstTime(message.id)) continue;
    handleIncoming(message).catch((err) => console.error('Falha ao responder no WhatsApp:', err.message));
  }
});

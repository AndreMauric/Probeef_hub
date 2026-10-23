// Assistente do portal: cada usuário conversa com o seu, que só enxerga os relatórios dele
// (e, quando há várias fazendas, só os da fazenda selecionada).
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { recordEvent } from '../accessLog.js';
import { loginAllowed, registerFailedLogin } from '../auth.js';
import { aiAvailableFor, answerQuestion } from '../bot/ai.js';
import { KeyError, keyInfo, removeUserKey, setUserKey } from '../userKeys.js';

export const assistantRouter = Router();
assistantRouter.use(requireAuth);

const HISTORY_TURNS = 6;
const TTL_MS = 2 * 60 * 60 * 1000;
const conversations = new Map(); // `${userId}|${clientId}` -> { at, items: [{ role, content }] }

const key = (req, clientId) => `${req.user.id}|${clientId || ''}`;

function conversation(req, clientId) {
  const now = Date.now();
  for (const [k, c] of conversations) if (now - c.at > TTL_MS) conversations.delete(k);
  let c = conversations.get(key(req, clientId));
  if (!c) {
    c = { at: now, items: [] };
    conversations.set(key(req, clientId), c);
  }
  c.at = now;
  return c;
}

// Só aceita um cliente que o usuário realmente tem (o resto é ignorado).
function clientParam(req, raw) {
  const id = String(raw || '');
  return req.user.clientIds?.includes(id) ? id : null;
}

assistantRouter.get('/', (req, res) => {
  const clientId = clientParam(req, req.query.client);
  const enabled = aiAvailableFor(req.user);
  res.json({
    enabled,
    // Admin "entrando como" outro usuário não usa o assistente (seria com a chave e os créditos dele).
    blocked: Boolean(req.impersonator),
    key: keyInfo(req.user),
    history: enabled && !req.impersonator ? conversation(req, clientId).items : [],
  });
});

// ---------- Chave da Anthropic do próprio usuário ----------

const noImpersonation = (req, res, next) =>
  req.impersonator ? res.status(403).json({ error: 'Não é possível usar ou alterar o assistente enquanto você vê o portal como outro usuário.' }) : next();

assistantRouter.put('/key', noImpersonation, async (req, res, next) => {
  // Limita tentativas para a tela não virar um teste de chaves alheias.
  const attemptKey = `chave|${req.user.id}`;
  if (!loginAllowed(attemptKey)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
  try {
    await setUserKey(req.user, req.body?.apiKey);
    res.json({ key: keyInfo(req.user) });
  } catch (err) {
    if (err instanceof KeyError) {
      registerFailedLogin(attemptKey);
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

assistantRouter.delete('/key', noImpersonation, async (req, res) => {
  await removeUserKey(req.user);
  for (const k of conversations.keys()) if (k.startsWith(`${req.user.id}|`)) conversations.delete(k);
  res.json({ key: keyInfo(req.user) });
});

const busy = new Set();

assistantRouter.post('/', async (req, res, next) => {
  const clientId = clientParam(req, req.body?.client);
  const message = String(req.body?.message || '').trim().slice(0, 1000);
  if (!message) return res.status(400).json({ error: 'Escreva uma pergunta.' });
  if (req.impersonator) return res.status(403).json({ error: 'O assistente fica desligado enquanto você vê o portal como outro usuário.' });
  if (!aiAvailableFor(req.user)) return res.status(400).json({ error: 'Cadastre a sua chave da Anthropic em Conta → Meu assistente para usar o assistente.' });
  // Uma pergunta por vez por usuário.
  if (busy.has(req.user.id)) return res.status(429).json({ error: 'Aguarde a resposta da pergunta anterior.' });
  busy.add(req.user.id);
  try {
    const c = conversation(req, clientId);
    let answer;
    try {
      answer = await answerQuestion(req.user, message, c.items, {
        channel: 'portal',
        clientId,
        currentReportId: String(req.body?.reportId || '') || null,
      });
    } catch (err) {
      console.error('Falha no assistente:', err.message);
      answer = 'Tive um problema para consultar seus dados agora. Tente de novo em alguns minutos.';
    }
    if (req.user.role === 'client') recordEvent('ask', { userId: req.user.id, clientId });
    c.items.push({ role: 'user', content: message }, { role: 'assistant', content: answer });
    c.items = c.items.slice(-HISTORY_TURNS * 2);
    res.json({ answer });
  } catch (err) {
    next(err);
  } finally {
    busy.delete(req.user.id);
  }
});

assistantRouter.post('/reset', (req, res) => {
  conversations.delete(key(req, clientParam(req, req.body?.client)));
  res.json({ ok: true });
});

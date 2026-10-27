// API do Benchmarking Confinamento (ver src/benchmark.js). O admin usa as mesmas rotas para
// revisar a coleta de qualquer cliente participante; as rotas só de admin ficam em admin.js.
import { Router } from 'express';
import { recordToolAccess, startToolView } from '../accessLog.js';
import { requireAuth } from '../auth.js';
import { clearDraft, getForUser, participantClients, review, saveDraft, settings, submit } from '../benchmark.js';

export const benchmarkRouter = Router();

benchmarkRouter.use(requireAuth);

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// Clientes que a pessoa pode abrir, com o ano e o prazo da coleta.
benchmarkRouter.get('/clients', (req, res) => {
  const s = settings();
  res.json({ ano: s.ano, prazo: s.prazo, isAdmin: req.user.role === 'admin', clients: participantClients(req.user).map((c) => ({ id: c.id, name: c.name })) });
});

// Abertura da ferramenta: conta no uso do portal (aba Uso → Ferramentas), como o 4M e a 3P.
benchmarkRouter.post('/open', (req, res) => {
  if (req.user.role === 'admin' || req.impersonator) return res.json({ viewId: null });
  const clientId = participantClients(req.user)[0]?.id || null;
  recordToolAccess({ userId: req.user.id, clientId, toolId: 'benchmark' });
  res.json({ viewId: startToolView({ userId: req.user.id, clientId, toolId: 'benchmark' }) });
});

benchmarkRouter.get('/:clientId', (req, res) => res.json(getForUser(req.user, req.params.clientId)));

benchmarkRouter.put('/:clientId', route(async (req, res) => {
  // Admin "entrando como" o cliente só olha: não grava em nome dele.
  if (req.impersonator) return res.status(403).json({ error: 'Você está vendo como o cliente: as alterações não são salvas.' });
  res.json(await saveDraft(req.user, req.params.clientId, req.body || {}));
}));

benchmarkRouter.post('/:clientId/clear', route(async (req, res) => {
  if (req.impersonator) return res.status(403).json({ error: 'Você está vendo como o cliente: as alterações não são salvas.' });
  res.json(await clearDraft(req.user, req.params.clientId, req.body || {}));
}));

benchmarkRouter.post('/:clientId/submit', route(async (req, res) => {
  if (req.impersonator) return res.status(403).json({ error: 'Você está vendo como o cliente: não é possível enviar em nome dele.' });
  res.json(await submit(req.user, req.params.clientId, { text: req.body?.text }));
}));

benchmarkRouter.post('/:clientId/review', route(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Só a equipe Cargill valida o benchmarking.' });
  res.json(await review(req.user, req.params.clientId, req.body || {}));
}));

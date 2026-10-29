// API do Benchmarking Confinamento (ver src/benchmark.js). O admin (todos os clientes) e os
// validadores (os clientes deles) usam as mesmas rotas para revisar a coleta; as rotas só de admin
// ficam em admin.js.
import { Router } from 'express';
import { recordToolAccess, startToolView } from '../accessLog.js';
import { requireAuth } from '../auth.js';
import { adminList, clearDraft, createClientFor, getForUser, isValidator, participantClients, review, saveDraft, settings, submit } from '../benchmark.js';

export const benchmarkRouter = Router();

benchmarkRouter.use(requireAuth);

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// Clientes que a pessoa pode abrir, com o ano e o prazo da coleta.
benchmarkRouter.get('/clients', (req, res) => {
  const s = settings();
  res.json({ ano: s.ano, prazo: s.prazo, isAdmin: req.user.role === 'admin', isValidator: isValidator(req.user), clients: participantClients(req.user).map((c) => ({ id: c.id, name: c.name })) });
});

// Abertura da ferramenta: conta no uso do portal (aba Uso → Ferramentas), como o 4M e a 3P.
benchmarkRouter.post('/open', (req, res) => {
  if (req.user.role === 'admin' || req.impersonator) return res.json({ viewId: null });
  // O tempo conta no cliente aberto (quem tem mais de um cliente reabre a contagem ao trocar).
  const clients = participantClients(req.user);
  const clientId = clients.find((c) => c.id === req.body?.clientId)?.id || clients[0]?.id || null;
  recordToolAccess({ userId: req.user.id, clientId, toolId: 'benchmark' });
  res.json({ viewId: startToolView({ userId: req.user.id, clientId, toolId: 'benchmark' }) });
});

// Quem valida cadastra um cliente só para o benchmarking (ver createClientFor).
benchmarkRouter.post('/clients', route(async (req, res) => {
  if (req.impersonator) return res.status(403).json({ error: 'Você está vendo como outra pessoa: não é possível cadastrar clientes.' });
  res.status(201).json({ client: await createClientFor(req.user, req.body || {}) });
}));

// Andamento dos clientes para quem valida (a mesma lista da aba Benchmarking do admin, só com os
// clientes da pessoa).
benchmarkRouter.get('/overview', (req, res) => {
  if (!isValidator(req.user)) return res.status(403).json({ error: 'Só quem valida o benchmarking vê o andamento dos clientes.' });
  res.json({ ano: settings().ano, prazo: settings().prazo, clients: adminList({ clientIds: req.user.role === 'admin' ? null : req.user.clientIds || [] }) });
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
  if (req.impersonator) return res.status(403).json({ error: 'Você está vendo como o cliente: não é possível validar em nome dele.' });
  res.json(await review(req.user, req.params.clientId, req.body || {}));
}));

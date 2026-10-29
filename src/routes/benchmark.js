// API do Benchmarking (ver src/benchmark.js e src/bmkTeam.js). O admin (todas as fazendas), o Time
// e os Canais Cargill (as fazendas da equipe) usam as mesmas rotas; as rotas só de admin ficam em
// admin.js. A aba Equipe (gestores) fica em /team.
import { Router } from 'express';
import { recordToolAccess, startToolView } from '../accessLog.js';
import { requireAuth } from '../auth.js';
import { adminList, clearDraft, coletaAberta, createClientFor, getForUser, isValidator, participantClients, review, saveDraft, setOwner, settings, submit } from '../benchmark.js';
import { canCreateFarm, canCreateTeam, createMember, isGestor, isInternal, kindOf, ownerCandidates, resetMemberPassword, teamView, updateMember } from '../bmkTeam.js';

export const benchmarkRouter = Router();

benchmarkRouter.use(requireAuth);

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// Fazendas que a pessoa pode abrir, o ciclo (ano, prazo, coleta aberta) e o que ela pode fazer.
benchmarkRouter.get('/clients', (req, res) => {
  const s = settings();
  const u = req.user;
  res.json({
    ano: s.ano,
    prazo: s.prazo,
    aberta: coletaAberta(),
    kind: kindOf(u),
    isAdmin: u.role === 'admin',
    isValidator: isValidator(u),
    // Aba Clientes (andamento das fazendas da equipe): admin, Time e Canais.
    seesOverview: u.role === 'admin' || isInternal(u),
    canCreateFarm: canCreateFarm(u),
    isGestor: isGestor(u),
    canCreateTeam: canCreateTeam(u),
    clients: participantClients(u).map((c) => ({ id: c.id, name: c.name })),
  });
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

const noImpersonation = (req, res) => {
  if (!req.impersonator) return false;
  res.status(403).json({ error: 'Você está vendo como outra pessoa: nada é alterado.' });
  return true;
};

// O Time Cargill cadastra uma fazenda só para o benchmarking (ver createClientFor).
benchmarkRouter.post('/clients', route(async (req, res) => {
  if (noImpersonation(req, res)) return;
  res.status(201).json({ client: await createClientFor(req.user, req.body || {}) });
}));

benchmarkRouter.put('/clients/:clientId/owner', route(async (req, res) => {
  if (noImpersonation(req, res)) return;
  res.json(await setOwner(req.user, req.params.clientId, req.body || {}));
}));

// Andamento das fazendas que a pessoa enxerga (a mesma lista da aba Benchmarking do admin) e quem
// pode ser responsável por elas.
benchmarkRouter.get('/overview', (req, res) => {
  const u = req.user;
  if (u.role !== 'admin' && !isInternal(u)) return res.status(403).json({ error: 'O andamento das fazendas é para a equipe Cargill.' });
  const ids = u.role === 'admin' ? null : participantClients(u).map((c) => c.id);
  res.json({
    ano: settings().ano,
    prazo: settings().prazo,
    clients: adminList({ clientIds: ids }),
    owners: canCreateFarm(u) ? ownerCandidates(u).map((o) => ({ id: o.id, name: o.name, kind: kindOf(o) })) : [],
  });
});

// ---------- Equipe (só gestores; ver src/bmkTeam.js) ----------

const farmsOf = (user) => participantClients(user);
benchmarkRouter.get('/team', route(async (req, res) => res.json(teamView(req.user, farmsOf(req.user)))));

benchmarkRouter.post('/team', route(async (req, res) => {
  if (noImpersonation(req, res)) return;
  res.status(201).json(await createMember(req.user, req.body || {}, farmsOf(req.user)));
}));

benchmarkRouter.put('/team/:id', route(async (req, res) => {
  if (noImpersonation(req, res)) return;
  res.json({ member: await updateMember(req.user, req.params.id, req.body || {}, farmsOf(req.user)) });
}));

benchmarkRouter.post('/team/:id/reset-password', route(async (req, res) => {
  if (noImpersonation(req, res)) return;
  res.json(await resetMemberPassword(req.user, req.params.id, farmsOf(req.user)));
}));

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

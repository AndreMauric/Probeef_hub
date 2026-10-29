// API da calculadora 4M Confinamento: pedido/consulta de acesso e simulações salvas.
// O front-end mora em public/confinamento (servido só para quem está logado e liberado,
// ver server.js) e fala com estas rotas usando a mesma sessão do portal.
import { Router } from 'express';
import { recordToolAccess, startToolView } from '../accessLog.js';
import { requireAuth } from '../auth.js';
import { db, newId, save } from '../store.js';

export const confinamentoRouter = Router();

confinamentoRouter.use(requireAuth);

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const byUpdatedDesc = (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt);
const canUse = (user) => user.role === 'admin' || user.confinamento?.status === 'approved';

confinamentoRouter.get('/status', (req, res) => {
  res.json({
    status: req.user.role === 'admin' ? 'approved' : req.user.confinamento?.status || 'none',
    isAdmin: req.user.role === 'admin',
  });
});

confinamentoRouter.post('/request', route(async (req, res) => {
  const user = req.user;
  if (canUse(user)) return res.json({ status: 'approved' });
  if (user.bmkOnly) return res.status(403).json({ error: 'Seu acesso é só ao Benchmarking. Fale com o administrador.' });

  user.confinamento = { ...(user.confinamento || {}), status: 'pending', requestedAt: new Date().toISOString() };
  await save();
  res.json({ status: 'pending' });
}));

function requireAccess(req, res, next) {
  if (!canUse(req.user)) return res.status(403).json({ error: 'Acesso ao 4M Confinamento ainda não foi liberado para o seu usuário.' });
  next();
}

confinamentoRouter.use(requireAccess);

// Chamado quando a ferramenta termina de carregar: registra a abertura nas métricas de uso do
// portal (aba Uso → Ferramentas) e devolve um viewId para o tempo de uso, igual ao embed de relatório.
// Admins não contam no uso (mesma regra dos relatórios), então não ganham viewId.
confinamentoRouter.post('/open', (req, res) => {
  if (req.user.role === 'admin') return res.json({ viewId: null });
  const clientId = req.user.clientIds?.[0] || null;
  recordToolAccess({ userId: req.user.id, clientId, toolId: 'confinamento' });
  const viewId = startToolView({ userId: req.user.id, clientId, toolId: 'confinamento' });
  res.json({ viewId });
});

confinamentoRouter.get('/simulations', (req, res) => {
  const list = db().confinamentoSimulations;
  if (req.query.all === '1') {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores podem ver todas as simulações.' });
    const users = db().users;
    const simulations = [...list]
      .sort(byUpdatedDesc)
      .map((s) => ({ ...s, ownerName: users.find((u) => u.id === s.userId)?.name || 'Usuário removido' }));
    return res.json({ simulations });
  }
  res.json({ simulations: list.filter((s) => s.userId === req.user.id).sort(byUpdatedDesc) });
});

function findOwnedOr403(req) {
  const sim = db().confinamentoSimulations.find((s) => s.id === req.params.id);
  if (!sim) {
    const err = new Error('Simulação não encontrada.');
    err.status = 404;
    throw err;
  }
  if (sim.userId !== req.user.id && req.user.role !== 'admin') {
    const err = new Error('Sem permissão para alterar esta simulação.');
    err.status = 403;
    throw err;
  }
  return sim;
}

confinamentoRouter.post('/simulations', route(async (req, res) => {
  const { name, data } = req.body || {};
  if (!name || !data) return res.status(400).json({ error: 'name e data são obrigatórios.' });
  const now = new Date().toISOString();
  const simulation = { id: newId(), userId: req.user.id, name: String(name).slice(0, 200), data, createdAt: now, updatedAt: now };
  db().confinamentoSimulations.push(simulation);
  await save();
  res.status(201).json({ simulation });
}));

confinamentoRouter.put('/simulations/:id', route(async (req, res) => {
  const sim = findOwnedOr403(req);
  const { name, data } = req.body || {};
  if (name) sim.name = String(name).slice(0, 200);
  if (data) sim.data = data;
  sim.updatedAt = new Date().toISOString();
  await save();
  res.json({ simulation: sim });
}));

confinamentoRouter.delete('/simulations/:id', route(async (req, res) => {
  const sim = findOwnedOr403(req);
  db().confinamentoSimulations = db().confinamentoSimulations.filter((s) => s.id !== sim.id);
  await save();
  res.json({ ok: true });
}));

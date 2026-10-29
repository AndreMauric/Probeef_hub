// API da 3P · Predição de Desempenho a Pasto: pedido/consulta de acesso e simulações salvas.
// Mesmo padrão do 4M Confinamento (ver confinamento.js): o front-end mora em public/pasto (servido
// só para quem está logado e liberado, ver server.js) e o cálculo roda no navegador (model.js).
import { Router } from 'express';
import { recordToolAccess, startToolView } from '../accessLog.js';
import { requireAuth } from '../auth.js';
import { db, newId, save } from '../store.js';

export const pastoRouter = Router();

pastoRouter.use(requireAuth);

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const byUpdatedDesc = (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt);
export const canUsePasto = (user) => user.role === 'admin' || user.pasto?.status === 'approved';
const MAX_DATA_BYTES = 20_000; // uma simulação são os dois cenários de entrada (o resultado é recalculado)

pastoRouter.get('/status', (req, res) => {
  res.json({ status: req.user.role === 'admin' ? 'approved' : req.user.pasto?.status || 'none', isAdmin: req.user.role === 'admin' });
});

pastoRouter.post('/request', route(async (req, res) => {
  const user = req.user;
  if (canUsePasto(user)) return res.json({ status: 'approved' });
  if (user.bmkOnly) return res.status(403).json({ error: 'Seu acesso é só ao Benchmarking. Fale com o administrador.' });

  user.pasto = { ...(user.pasto || {}), status: 'pending', requestedAt: new Date().toISOString() };
  await save();
  res.json({ status: 'pending' });
}));

pastoRouter.use((req, res, next) => {
  if (!canUsePasto(req.user)) return res.status(403).json({ error: 'Acesso à 3P ainda não foi liberado para o seu usuário.' });
  next();
});

// Abertura da ferramenta: conta no uso do portal (aba Uso → Ferramentas) e devolve o viewId do tempo de uso.
pastoRouter.post('/open', (req, res) => {
  if (req.user.role === 'admin' || req.impersonator) return res.json({ viewId: null });
  const clientId = req.user.clientIds?.[0] || null;
  recordToolAccess({ userId: req.user.id, clientId, toolId: 'pasto' });
  res.json({ viewId: startToolView({ userId: req.user.id, clientId, toolId: 'pasto' }) });
});

pastoRouter.get('/simulations', (req, res) => {
  const list = db().pastoSimulations.filter((s) => s.userId === req.user.id).sort(byUpdatedDesc);
  res.json({ simulations: list.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })) });
});

function ownOr404(req) {
  const sim = db().pastoSimulations.find((s) => s.id === req.params.id && s.userId === req.user.id);
  if (!sim) {
    const err = new Error('Simulação não encontrada.');
    err.status = 404;
    throw err;
  }
  return sim;
}

function readBody(body) {
  const name = String(body?.name || '').trim().slice(0, 120);
  const data = body?.data;
  if (!name) throw Object.assign(new Error('Dê um nome para a simulação.'), { status: 400 });
  if (!data || typeof data !== 'object' || JSON.stringify(data).length > MAX_DATA_BYTES) throw Object.assign(new Error('Simulação inválida.'), { status: 400 });
  return { name, data };
}

pastoRouter.get('/simulations/:id', (req, res) => res.json({ simulation: ownOr404(req) }));

pastoRouter.post('/simulations', route(async (req, res) => {
  const { name, data } = readBody(req.body);
  const now = new Date().toISOString();
  const simulation = { id: newId(), userId: req.user.id, name, data, createdAt: now, updatedAt: now };
  db().pastoSimulations.push(simulation);
  await save();
  res.status(201).json({ simulation });
}));

pastoRouter.put('/simulations/:id', route(async (req, res) => {
  const sim = ownOr404(req);
  Object.assign(sim, readBody(req.body), { updatedAt: new Date().toISOString() });
  await save();
  res.json({ simulation: sim });
}));

pastoRouter.delete('/simulations/:id', route(async (req, res) => {
  const sim = ownOr404(req);
  db().pastoSimulations = db().pastoSimulations.filter((s) => s.id !== sim.id);
  await save();
  res.json({ ok: true });
}));

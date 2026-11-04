// API do Semi Confinamento (três produtos lado a lado a pasto com suplementação;
// veio do app "Semi Confinamento Probeef" do Power Apps):
// pedido/consulta de acesso e análises salvas. Mesmo padrão da 3P (ver pasto.js): o front-end mora em
// public/semi (servido só para quem está logado e liberado, ver server.js) e o cálculo roda
// no navegador (model.js).
import { Router } from 'express';
import { recordToolAccess, startToolView } from '../accessLog.js';
import { canRequestTools, requireAuth, toolRequestRefusal } from '../auth.js';
import { db, newId, save } from '../store.js';

export const semiRouter = Router();

semiRouter.use(requireAuth);

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const byUpdatedDesc = (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt);
export const canUseSemi = (user) => user.role === 'admin' || user.semi?.status === 'approved';
const MAX_DATA_BYTES = 60_000; // cadastro da visita, ingredientes e os três produtos; o resultado é recalculado

semiRouter.get('/status', (req, res) => {
  res.json({ status: req.user.role === 'admin' ? 'approved' : req.user.semi?.status || 'none', isAdmin: req.user.role === 'admin' });
});

semiRouter.post('/request', route(async (req, res) => {
  const user = req.user;
  if (canUseSemi(user)) return res.json({ status: 'approved' });
  if (!canRequestTools(user)) return res.status(403).json({ error: toolRequestRefusal(user) });

  user.semi = { ...(user.semi || {}), status: 'pending', requestedAt: new Date().toISOString() };
  await save();
  res.json({ status: 'pending' });
}));

semiRouter.use((req, res, next) => {
  if (!canUseSemi(req.user)) return res.status(403).json({ error: 'Acesso ao Semi Confinamento ainda não foi liberado para o seu usuário.' });
  next();
});

// Abertura da ferramenta: conta no uso do portal (aba Uso → Ferramentas) e devolve o viewId do tempo de uso.
semiRouter.post('/open', (req, res) => {
  if (req.user.role === 'admin' || req.impersonator) return res.json({ viewId: null });
  const clientId = req.user.clientIds?.[0] || null;
  recordToolAccess({ userId: req.user.id, clientId, toolId: 'semi' });
  res.json({ viewId: startToolView({ userId: req.user.id, clientId, toolId: 'semi' }) });
});

semiRouter.get('/simulations', (req, res) => {
  const list = db().semiSimulations.filter((s) => s.userId === req.user.id).sort(byUpdatedDesc);
  // Histórico: como a tela "Histórico" do app, mostra fazenda, proprietário e data da visita.
  res.json({
    simulations: list.map(({ id, name, updatedAt, data }) => ({ id, name, updatedAt, fazenda: data.cadastro?.fazenda || '', proprietario: data.cadastro?.proprietario || '', dataVisita: data.cadastro?.dataVisita || '' })),
  });
});

function ownOr404(req) {
  const sim = db().semiSimulations.find((s) => s.id === req.params.id && s.userId === req.user.id);
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
  if (!data || typeof data !== 'object' || JSON.stringify(data).length > MAX_DATA_BYTES) throw Object.assign(new Error('Simulação inválida ou grande demais.'), { status: 400 });
  return { name, data };
}

semiRouter.get('/simulations/:id', (req, res) => res.json({ simulation: ownOr404(req) }));

semiRouter.post('/simulations', route(async (req, res) => {
  const { name, data } = readBody(req.body);
  const now = new Date().toISOString();
  const simulation = { id: newId(), userId: req.user.id, name, data, createdAt: now, updatedAt: now };
  db().semiSimulations.push(simulation);
  await save();
  res.status(201).json({ simulation });
}));

semiRouter.put('/simulations/:id', route(async (req, res) => {
  const sim = ownOr404(req);
  Object.assign(sim, readBody(req.body), { updatedAt: new Date().toISOString() });
  await save();
  res.json({ simulation: sim });
}));

semiRouter.delete('/simulations/:id', route(async (req, res) => {
  const sim = ownOr404(req);
  db().semiSimulations = db().semiSimulations.filter((s) => s.id !== sim.id);
  await save();
  res.json({ ok: true });
}));

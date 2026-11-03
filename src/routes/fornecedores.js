// API do 4M Fornecedores (resultado e risco por fornecedor a partir da planilha de desempenho):
// pedido/consulta de acesso e análises salvas. Mesmo padrão da 3P (ver pasto.js): o front-end mora em
// public/fornecedores (servido só para quem está logado e liberado, ver server.js) e o cálculo roda
// no navegador (model.js).
import { Router } from 'express';
import { recordToolAccess, startToolView } from '../accessLog.js';
import { requireAuth } from '../auth.js';
import { db, newId, save } from '../store.js';

export const fornecedoresRouter = Router();

fornecedoresRouter.use(requireAuth);

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const byUpdatedDesc = (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt);
export const canUseFornecedores = (user) => user.role === 'admin' || user.fornecedores?.status === 'approved';
const MAX_DATA_BYTES = 400_000; // a planilha (fornecedores com média e CV) + as entradas; o resultado é recalculado

fornecedoresRouter.get('/status', (req, res) => {
  res.json({ status: req.user.role === 'admin' ? 'approved' : req.user.fornecedores?.status || 'none', isAdmin: req.user.role === 'admin' });
});

fornecedoresRouter.post('/request', route(async (req, res) => {
  const user = req.user;
  if (canUseFornecedores(user)) return res.json({ status: 'approved' });
  if (user.bmkOnly) return res.status(403).json({ error: 'Seu acesso é só ao Benchmarking. Fale com o administrador.' });

  user.fornecedores = { ...(user.fornecedores || {}), status: 'pending', requestedAt: new Date().toISOString() };
  await save();
  res.json({ status: 'pending' });
}));

fornecedoresRouter.use((req, res, next) => {
  if (!canUseFornecedores(req.user)) return res.status(403).json({ error: 'Acesso ao 4M Fornecedores ainda não foi liberado para o seu usuário.' });
  next();
});

// Abertura da ferramenta: conta no uso do portal (aba Uso → Ferramentas) e devolve o viewId do tempo de uso.
fornecedoresRouter.post('/open', (req, res) => {
  if (req.user.role === 'admin' || req.impersonator) return res.json({ viewId: null });
  const clientId = req.user.clientIds?.[0] || null;
  recordToolAccess({ userId: req.user.id, clientId, toolId: 'fornecedores' });
  res.json({ viewId: startToolView({ userId: req.user.id, clientId, toolId: 'fornecedores' }) });
});

fornecedoresRouter.get('/simulations', (req, res) => {
  const list = db().fornecedoresSimulations.filter((s) => s.userId === req.user.id).sort(byUpdatedDesc);
  res.json({ simulations: list.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })) });
});

function ownOr404(req) {
  const sim = db().fornecedoresSimulations.find((s) => s.id === req.params.id && s.userId === req.user.id);
  if (!sim) {
    const err = new Error('Análise não encontrada.');
    err.status = 404;
    throw err;
  }
  return sim;
}

function readBody(body) {
  const name = String(body?.name || '').trim().slice(0, 120);
  const data = body?.data;
  if (!name) throw Object.assign(new Error('Dê um nome para a análise.'), { status: 400 });
  if (!data || typeof data !== 'object' || JSON.stringify(data).length > MAX_DATA_BYTES) throw Object.assign(new Error('Análise inválida ou grande demais.'), { status: 400 });
  return { name, data };
}

fornecedoresRouter.get('/simulations/:id', (req, res) => res.json({ simulation: ownOr404(req) }));

fornecedoresRouter.post('/simulations', route(async (req, res) => {
  const { name, data } = readBody(req.body);
  const now = new Date().toISOString();
  const simulation = { id: newId(), userId: req.user.id, name, data, createdAt: now, updatedAt: now };
  db().fornecedoresSimulations.push(simulation);
  await save();
  res.status(201).json({ simulation });
}));

fornecedoresRouter.put('/simulations/:id', route(async (req, res) => {
  const sim = ownOr404(req);
  Object.assign(sim, readBody(req.body), { updatedAt: new Date().toISOString() });
  await save();
  res.json({ simulation: sim });
}));

fornecedoresRouter.delete('/simulations/:id', route(async (req, res) => {
  const sim = ownOr404(req);
  db().fornecedoresSimulations = db().fornecedoresSimulations.filter((s) => s.id !== sim.id);
  await save();
  res.json({ ok: true });
}));

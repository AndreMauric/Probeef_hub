// Painel nativo da Ferramenta CCV no portal (ver src/ccv.js). Cada rota confere o acesso ao
// relatório (mesmas regras dos relatórios incorporados) e a fazenda pedida contra a lista liberada
// para o cliente/usuário; as consultas ao Power BI sempre filtram por essa fazenda.
import { Router } from 'express';
import { AccessError, isCcv, resolveAccess } from '../access.js';
import { recordAccess, startView } from '../accessLog.js';
import { requireAuth } from '../auth.js';
import { allowedFarms, diaDetalhe, painel, readFilters } from '../ccv.js';

export const ccvRouter = Router();

ccvRouter.use(requireAuth);

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// Admin "entrando como" um cliente vê exatamente o que o cliente vê; admin direto vê todas as fazendas.
async function context(req) {
  const { report, client } = resolveAccess(req.user, req.params.id, { client: req.query.client, native: true });
  if (!isCcv(report)) throw new AccessError('Este relatório não é um painel CCV.', 400);
  const farms = await allowedFarms(req.user, report, client?.id);
  if (!farms.length) {
    throw new AccessError(
      req.user.role === 'admin' ? 'Nenhuma fazenda encontrada no modelo do CCV.' : 'Nenhuma fazenda do CCV foi liberada para você ainda. Fale com o administrador do portal.',
      403,
    );
  }
  return { report, client, farms };
}

const countsUsage = (req) => req.user.role !== 'admin' && !req.impersonator;

// Fazendas liberadas (com a data da última leitura). Com ?open=1, conta como uma abertura do painel
// no uso do portal e devolve o viewId para o tempo de uso, igual ao embed dos relatórios.
ccvRouter.get('/:id/farms', route(async (req, res) => {
  const { report, client, farms } = await context(req);
  let viewId = null;
  if (req.query.open === '1' && countsUsage(req)) {
    recordAccess({ userId: req.user.id, clientId: client?.id || null, reportId: report.id });
    viewId = startView({ userId: req.user.id, clientId: client?.id || null, reportId: report.id });
  }
  res.json({ farms, viewId });
}));

ccvRouter.get('/:id/painel', route(async (req, res) => {
  const { report, farms } = await context(req);
  res.json(await painel(report, readFilters(req.query, farms)));
}));

ccvRouter.get('/:id/dia', route(async (req, res) => {
  const { report, farms } = await context(req);
  res.json({ currais: await diaDetalhe(report, readFilters(req.query, farms), req.query.dia) });
}));

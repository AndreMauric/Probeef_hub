import { Readable } from 'node:stream';
import { Router } from 'express';
import { AccessError, resolveAccess, visibleReports } from '../access.js';
import { beatView, endView, recordAccess, recordEvent, startView } from '../accessLog.js';
import { requireAuth, userClients } from '../auth.js';
import { categoryOf } from '../categories.js';
import { reportFreshness } from '../dataHealth.js';
import { imagePath, imageUrl, reportImageId } from '../images.js';
import { answer as answerNps, dismiss as dismissNps, shouldAsk } from '../nps.js';
import { deleteView, favoritesOf, getView, saveView, setFavorite, viewsOf } from '../personal.js';
import { getEmbedConfig, getExportFile, getExportStatus, startExport } from '../powerbi.js';
import { db } from '../store.js';

export const portalRouter = Router();

portalRouter.use(requireAuth);

portalRouter.get('/reports', (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const favorites = favoritesOf(req.user);
  const reports = visibleReports(req.user).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    categoryDescription: categoryOf(r)?.description || '',
    description: r.description,
    clientIds: r.clientIds,
    imageUrl: imageUrl(reportImageId(r)),
    freshness: reportFreshness(r.id),
    favorite: favorites.has(r.id),
    rls: isAdmin ? r.rls : undefined,
  }));
  const clients = isAdmin ? [] : userClients(req.user).map((c) => ({ id: c.id, name: c.name }));
  res.json({ clients, reports, views: viewsOf(req.user) });
});

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// ---------- Favoritos e visões salvas ----------

portalRouter.put('/reports/:id/favorite', route(async (req, res) => {
  res.json({ favorite: await setFavorite(req.user, req.params.id, req.body?.favorite === true) });
}));

portalRouter.post('/reports/:id/views', route(async (req, res) => {
  const result = await saveView(req.user, req.params.id, req.body || {});
  res.status(result.updated ? 200 : 201).json({ ...result, views: viewsOf(req.user) });
}));

portalRouter.get('/views/:id', (req, res, next) => {
  try {
    res.json({ view: getView(req.user, req.params.id) });
  } catch (err) {
    next(err);
  }
});

portalRouter.delete('/views/:id', route(async (req, res) => {
  await deleteView(req.user, req.params.id);
  res.json({ views: viewsOf(req.user) });
}));

// ---------- Pesquisa de satisfação ----------

portalRouter.get('/nps', (req, res) => res.json({ ask: shouldAsk(req.user, { impersonating: Boolean(req.impersonator) }) }));

portalRouter.post('/nps', route(async (req, res) => {
  if (!shouldAsk(req.user, { impersonating: Boolean(req.impersonator) })) return res.status(409).json({ error: 'A pesquisa não está disponível agora.' });
  await answerNps(req.user, req.body || {});
  res.status(201).json({ ok: true });
}));

portalRouter.post('/nps/dismiss', route(async (req, res) => {
  if (shouldAsk(req.user, { impersonating: Boolean(req.impersonator) })) await dismissNps(req.user);
  res.status(204).end();
}));

// Imagens dos relatórios (só para quem está logado). O id nunca muda de arquivo, então pode ficar em cache.
portalRouter.get('/images/:id', (req, res) => {
  const image = db().images.find((i) => i.id === req.params.id);
  if (!image) return res.status(404).json({ error: 'Imagem não encontrada.' });
  res.set('Cache-Control', 'private, max-age=86400, immutable');
  res.type(image.contentType).sendFile(imagePath(image), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Imagem não encontrada.' });
  });
});

// Só o uso de clientes conta (nem admin, nem admin "entrando como" um cliente).
const countsUsage = (req) => req.user.role !== 'admin' && !req.impersonator;

// Tempo de uso: o portal manda um batimento por minuto enquanto o relatório está visível,
// e um aviso de fim ao sair do relatório ou fechar a aba.
portalRouter.post('/usage/beat', (req, res) => {
  if (countsUsage(req)) beatView(String(req.body?.viewId || ''), req.user.id, req.body?.page, { resume: req.body?.resume === true });
  res.status(204).end();
});

portalRouter.post('/usage/end', (req, res) => {
  if (countsUsage(req)) endView(String(req.body?.viewId || ''), req.user.id, req.body?.page);
  res.status(204).end();
});

portalRouter.get('/reports/:id/embed', async (req, res, next) => {
  try {
    const { report, client, identity } = resolveAccess(req.user, req.params.id, req.query);
    const embed = await getEmbedConfig({ workspaceId: report.workspaceId, reportId: report.reportId, identity });
    // Acessos de admin, inclusive "entrando como" um cliente, não entram no histórico de uso.
    let viewId = null;
    if (countsUsage(req) && !req.query.renewal) {
      recordAccess({ userId: req.user.id, clientId: client.id, reportId: report.id });
      viewId = startView({ userId: req.user.id, clientId: client.id, reportId: report.id });
    }
    res.json({ ...embed, viewId });
  } catch (err) {
    next(err);
  }
});

// ---------- Exportar PDF ----------

// Exportações em andamento: só quem pediu consegue acompanhar e baixar. Somem depois de 2 horas.
const exportsInProgress = new Map();
const EXPORT_TTL_MS = 2 * 60 * 60 * 1000;
const safeFileName = (text) =>
  String(text)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-') || 'relatorio';

function ownExport(req) {
  const job = exportsInProgress.get(req.params.exportId);
  if (!job || job.userId !== req.user.id || job.reportId !== req.params.id) {
    throw new AccessError('Exportação não encontrada. Gere o PDF de novo.', 404);
  }
  return job;
}

portalRouter.post('/reports/:id/export', async (req, res, next) => {
  try {
    const now = Date.now();
    for (const [id, job] of exportsInProgress) if (now - job.createdAt > EXPORT_TTL_MS) exportsInProgress.delete(id);
    const running = [...exportsInProgress.values()].filter((j) => j.userId === req.user.id && !j.done).length;
    if (running >= 2) throw new AccessError('Aguarde terminar o PDF que já está sendo gerado.', 429);

    const body = req.body || {};
    const { report, client, identity } = resolveAccess(req.user, req.params.id, body);
    const pageName = typeof body.pageName === 'string' && /^[\w-]{1,100}$/.test(body.pageName) ? body.pageName : null;
    const bookmarkState = typeof body.bookmarkState === 'string' && body.bookmarkState.length < 90_000 ? body.bookmarkState : null;

    const exportId = await startExport({ workspaceId: report.workspaceId, reportId: report.reportId, pageName, bookmarkState, identity });
    const clientName = client?.name ? `${client.name} - ` : '';
    exportsInProgress.set(exportId, {
      userId: req.user.id,
      reportId: report.id,
      workspaceId: report.workspaceId,
      pbiReportId: report.reportId,
      fileName: `${safeFileName(`${clientName}${report.name}`)}.pdf`,
      createdAt: now,
      done: false,
    });
    if (countsUsage(req)) recordEvent('export', { userId: req.user.id, clientId: client?.id || null, reportId: report.id });
    res.status(202).json({ exportId });
  } catch (err) {
    next(err);
  }
});

portalRouter.get('/reports/:id/export/:exportId', async (req, res, next) => {
  try {
    const job = ownExport(req);
    const status = await getExportStatus(job.workspaceId, job.pbiReportId, req.params.exportId);
    if (status.status === 'Succeeded' || status.status === 'Failed') job.done = true;
    res.json(status);
  } catch (err) {
    next(err);
  }
});

portalRouter.get('/reports/:id/export/:exportId/file', async (req, res, next) => {
  try {
    const job = ownExport(req);
    const file = await getExportFile(job.workspaceId, job.pbiReportId, req.params.exportId);
    res.attachment(job.fileName);
    res.type('application/pdf');
    const length = file.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    Readable.fromWeb(file.body).pipe(res);
  } catch (err) {
    next(err);
  }
});

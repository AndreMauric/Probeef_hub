import { Router } from 'express';
import { clientUsage, reportPages, usageCsv, usageSummary } from '../accessLog.js';
import { aiAvailableFor } from '../bot/ai.js';
import { handleMessage } from '../bot/engine.js';
import { logBotMessage, recentBotMessages } from '../bot/log.js';
import { notifyReportUpdated, recipientsFor } from '../bot/notify.js';
import { cleanPhoneInput, samePhone } from '../bot/phone.js';
import { sendDocument, sendTemplate, uploadPdf, whatsappStatus } from '../bot/whatsapp.js';
import { isCcv } from '../access.js';
import { ccvUsage, computeCcvAlerts, listFarms, messageFor, oneLine, RULES } from '../ccv.js';
import { ccvPages, ccvPdfJob, publicJob, startCcvPdf } from '../ccvPdf.js';
import { adminQuotes, deleteManual, saveManual, setManualValue, setQuoteOptions } from '../quotes.js';
import { processMetrics } from '../benchmarkMetrics.js';
import { checkReportsTo, gerenciaOf, KINDS } from '../bmkTeam.js';
import { adminList as bmkList, exportAll as bmkExport, saveSettings as saveBmkSettings, settings as bmkSettings } from '../benchmark.js';
import { adminConversation, adminInbox, adminMarkRead, adminSend, chatFile, forgetChat, saveChatFile, setThreadStatus } from '../chat.js';
import { exportData, listSnapshots, snapshotPath, validateBackup } from '../backup.js';
import { generatePassword, hashPassword, requireAdmin, validatePassword } from '../auth.js';
import { config } from '../config.js';
import { alertsDigest, clearSnoozes, computeAlerts, snoozeAlert } from '../alerts.js';
import { dataHealthSummary, scanDataHealth, scanState, settings as dataSettings } from '../dataHealth.js';
import { categoryByName, ensureCategory, findCategory, sortByName, syncCategoryName } from '../categories.js';
import { deleteImageFile, detectImage, imageUrl, MAX_IMAGE_BYTES, saveImageFile } from '../images.js';
import { clientKey, preferredName, suggestFromName } from '../naming.js';
import { isConfigured, isGuid, listWorkspaceReports } from '../powerbi.js';
import { npsSummary } from '../nps.js';
import { forgetReport } from '../personal.js';
import { db, newId, replaceData, save } from '../store.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class InputError extends Error {
  status = 400;
}

function fail(message) {
  throw new InputError(message);
}

function findOr404(list, id, label) {
  const item = list.find((x) => x.id === id);
  if (!item) {
    const err = new Error(`${label} não encontrado.`);
    err.status = 404;
    throw err;
  }
  return item;
}

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// ---------- Status ----------

adminRouter.get('/status', (_req, res) => {
  const { users, clients, reports } = db();
  res.json({
    powerbiConfigured: isConfigured(),
    defaultWorkspaceId: config.powerbi.defaultWorkspaceId,
    counts: { users: users.length, clients: clients.length, reports: reports.length },
  });
});

// ---------- Imagens ----------

adminRouter.get('/images', (_req, res) => {
  const { images, categories, reports } = db();
  res.json({
    images: images.map((img) => ({
      ...img,
      url: imageUrl(img.id),
      categories: sortByName(categories.filter((c) => c.imageId === img.id)).map((c) => c.name),
      reports: reports.filter((r) => r.imageId === img.id).length,
    })),
  });
});

// O arquivo chega como corpo bruto (image/png, image/jpeg ou image/webp); o nome vem na URL.
adminRouter.post('/images', route(async (req, res) => {
  const buffer = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buffer?.length) fail('Envie uma imagem PNG, JPG ou WEBP.');
  if (buffer.length > MAX_IMAGE_BYTES) fail('A imagem passa de 5 MB. Reduza o tamanho e tente de novo.');
  const type = detectImage(buffer);
  if (!type) fail('Formato não suportado. Use PNG, JPG ou WEBP.');
  const id = newId();
  const name = text(req.query.name, 80).replace(/\.(png|jpe?g|webp)$/i, '') || 'Imagem';
  await saveImageFile(id, type, buffer);
  const image = { id, name, file: `${id}.${type.ext}`, contentType: type.mime, size: buffer.length, createdAt: new Date().toISOString() };
  db().images.push(image);
  await save();
  res.status(201).json({ image: { ...image, url: imageUrl(id) } });
}));

adminRouter.put('/images/:id', route(async (req, res) => {
  const image = findOr404(db().images, req.params.id, 'Imagem');
  const name = text(req.body?.name, 80);
  if (!name) fail('Informe o nome da imagem.');
  image.name = name;
  await save();
  res.json({ image });
}));

adminRouter.delete('/images/:id', route(async (req, res) => {
  const data = db();
  const image = findOr404(data.images, req.params.id, 'Imagem');
  data.images = data.images.filter((i) => i.id !== image.id);
  for (const c of data.categories) if (c.imageId === image.id) c.imageId = null;
  for (const r of data.reports) if (r.imageId === image.id) r.imageId = null;
  await save();
  await deleteImageFile(image);
  res.json({ ok: true });
}));

// ---------- Alertas ----------

adminRouter.get('/alerts', (_req, res) => res.json(computeAlerts()));

adminRouter.get('/alerts/digest', (_req, res) => res.json({ text: alertsDigest() }));

adminRouter.post('/alerts/:id/snooze', route(async (req, res) => {
  const days = [7, 30].includes(Number(req.body?.days)) ? Number(req.body.days) : 7;
  await snoozeAlert(String(req.params.id).slice(0, 200), days);
  res.json(computeAlerts());
}));

adminRouter.post('/alerts/unsnooze', route(async (_req, res) => {
  await clearSnoozes();
  res.json(computeAlerts());
}));

// ---------- Ferramenta CCV: fazendas e central de alertas ----------

const ccvReports = () => db().reports.filter(isCcv);

function ccvReportOr404(id) {
  const report = id ? ccvReports().find((r) => r.id === id) : ccvReports()[0];
  if (!report) {
    const err = new Error('Nenhum relatório do tipo "Painel CCV" cadastrado. Cadastre o relatório "Ferramenta CCV" em Relatórios.');
    err.status = 404;
    throw err;
  }
  return report;
}

// Fazendas do modelo, para escolher as de cada cliente e usuário.
adminRouter.get('/ccv/farms', route(async (req, res) => {
  const report = ccvReportOr404(text(req.query.reportId, 36));
  res.json({ reportId: report.id, farms: await listFarms(report) });
}));

// Última decisão por alerta (chave = fazenda + semana) e fazendas adiadas.
function ccvDecisions(reportId) {
  const log = (db().ccvAlertLog || []).filter((e) => e.reportId === reportId);
  const byKey = new Map();
  for (const e of log) if (e.action !== 'adiar') byKey.set(e.key, e);
  const snoozed = new Map();
  for (const e of log) if (e.action === 'adiar' && Date.parse(e.until) > Date.now()) snoozed.set(e.farm, e.until);
  return { byKey, snoozed };
}

const ccvLink = (req, report, farm) => `${config.publicUrl || `${req.protocol}://${req.get('host')}`}/portal#${report.id}/fazenda/${encodeURIComponent(farm)}`;

adminRouter.get('/ccv/alerts', route(async (req, res) => {
  const users = db().users;
  const result = [];
  for (const report of ccvReports()) {
    const data = await computeCcvAlerts(report, { refresh: req.query.refresh === '1' });
    const { byKey, snoozed } = ccvDecisions(report.id);
    data.farms = data.farms.map((f) => {
      const decision = byKey.get(f.key);
      return {
        ...f,
        decision: decision ? { ...decision, adminName: users.find((u) => u.id === decision.adminId)?.name || null } : null,
        snoozedUntil: snoozed.get(f.farm) || null,
        messages: Object.fromEntries(['alerta', 'relatorio'].map((kind) => [kind, messageFor({ ...f, periodFrom: data.period.from, periodTo: data.period.to }, kind, { link: ccvLink(req, report, f.farm) })])),
      };
    });
    result.push(data);
  }
  res.json({ reports: result, whatsapp: whatsappStatus(), rules: RULES });
}));

// PDF do relatório para anexar ao alerta: páginas, gerar (sempre filtrado na fazenda), acompanhar e ver.
adminRouter.get('/ccv/pages', route(async (req, res) => {
  const report = ccvReportOr404(text(req.query.reportId, 36));
  res.json({ pages: await ccvPages(report) });
}));

adminRouter.post('/ccv/pdf', route(async (req, res) => {
  const body = req.body || {};
  const report = ccvReportOr404(text(body.reportId, 36));
  const farm = text(body.farm, 120);
  if (!farm) fail('Escolha a fazenda.');
  res.status(202).json({ job: publicJob(await startCcvPdf(report, farm, text(body.pageName, 64))) });
}));

adminRouter.get('/ccv/pdf/:id', (req, res) => res.json({ job: publicJob(ccvPdfJob(req.params.id)) }));

adminRouter.get('/ccv/pdf/:id/file', (req, res) => {
  const job = ccvPdfJob(req.params.id);
  if (job.status !== 'ready') return res.status(409).json({ error: 'O PDF ainda não está pronto.' });
  res.type('application/pdf').set('Content-Disposition', `inline; filename="${job.fileName}"`).send(job.buffer);
});

// Decisão do admin sobre o alerta de uma fazenda: enviar alerta, enviar resumo, adiar ou dar por tratado.
adminRouter.post('/ccv/alerts/decide', route(async (req, res) => {
  const body = req.body || {};
  const report = ccvReportOr404(text(body.reportId, 36));
  const action = ['alerta', 'relatorio', 'adiar', 'tratado'].includes(body.action) ? body.action : fail('Ação inválida.');
  const farm = text(body.farm, 120);
  const key = text(body.key, 200);
  if (!farm || !key.startsWith(`${farm}|`)) fail('Alerta inválido.');
  // Só manda para quem realmente vê aquela fazenda (as mesmas regras do painel).
  const { recipients } = (await computeCcvAlerts(report)).farms.find((f) => f.farm === farm) || { recipients: [] };
  const entry = { id: newId(), at: new Date().toISOString(), adminId: req.user.id, reportId: report.id, key, farm, action };

  if (action === 'adiar') {
    const days = [1, 3, 7].includes(Number(body.days)) ? Number(body.days) : 7;
    entry.until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  } else if (action === 'tratado') {
    entry.note = text(body.note, 500);
  } else {
    const message = String(body.text || '').trim().slice(0, 3000);
    if (!message) fail('Escreva a mensagem.');
    const allowed = new Map(recipients.map((r) => [r.id, r]));
    const picked = [...new Set(Array.isArray(body.recipientIds) ? body.recipientIds : [])].map((id) => allowed.get(id)).filter(Boolean);
    const channel = ['whatsapp', 'portal'].includes(body.channel) ? body.channel : 'manual';
    entry.text = message;
    entry.channel = channel;
    entry.recipients = picked.map((r) => ({ id: r.id, name: r.name }));
    // PDF anexo: tem que ser desta fazenda e deste relatório (o pedido foi gerado com o filtro dela).
    let pdf = null;
    if (body.pdfId) {
      pdf = ccvPdfJob(text(body.pdfId, 64));
      if (pdf.reportId !== report.id || pdf.farm !== farm) fail('O PDF anexado é de outra fazenda.');
      if (pdf.status !== 'ready') fail('O PDF ainda não está pronto.');
      entry.pdf = { page: pdf.page, fileName: pdf.fileName };
    }
    if (channel === 'portal') {
      // Chega como mensagem no portal (botão Mensagens), com link para o painel daquela fazenda.
      if (!picked.length) fail('Marque ao menos uma pessoa.');
      const attachment = pdf ? await saveChatFile(pdf.buffer, pdf.fileName) : null;
      for (const r of picked) {
        await adminSend(req.user, r.id, { text: message, context: { reportId: report.id, farm }, origin: { type: 'ccv', action, farm }, attachment }, { persist: false });
      }
      entry.sent = picked.length;
      entry.failed = [];
    } else if (channel === 'whatsapp') {
      const status = whatsappStatus();
      if (!status.configured || !status.ccvTemplate) fail('O WhatsApp não está pronto para enviar (falta configurar o modelo WHATSAPP_TEMPLATE_CCV).');
      const withPhone = picked.filter((r) => r.phone);
      if (!withPhone.length) fail('Nenhum destinatário escolhido tem WhatsApp cadastrado.');
      // Modelo com cabeçalho Documento: o PDF vai nele (e é obrigatório). Sem cabeçalho, o PDF vai
      // solto depois do modelo, e o WhatsApp só entrega a quem escreveu para o número nas últimas 24 h.
      if (status.ccvTemplatePdf && !pdf) fail('O modelo do WhatsApp configurado exige o PDF anexo.');
      const mediaId = pdf ? await uploadPdf(pdf.buffer, pdf.fileName) : null;
      entry.sent = 0;
      entry.failed = [];
      if (pdf && !status.ccvTemplatePdf) entry.pdfFailed = [];
      for (const r of withPhone) {
        try {
          const document = pdf && status.ccvTemplatePdf ? { id: mediaId, filename: pdf.fileName } : undefined;
          await sendTemplate(r.phone, status.ccvTemplate, [r.name.split(' ')[0], farm, oneLine(message)], { document });
          logBotMessage({ direction: 'out', userId: r.id, text: `[CCV ${action}] ${farm}${pdf ? ' + PDF' : ''}` });
          entry.sent += 1;
        } catch (err) {
          console.error(`Envio CCV para ${r.phone} falhou:`, err.message);
          entry.failed.push(r.name);
          continue;
        }
        if (pdf && !status.ccvTemplatePdf) {
          try {
            await sendDocument(r.phone, null, pdf.fileName, null, { mediaId });
          } catch (err) {
            console.error(`PDF do CCV para ${r.phone} não foi entregue:`, err.message);
            entry.pdfFailed.push(r.name);
          }
        }
      }
    }
  }
  const data = db();
  data.ccvAlertLog = [...(data.ccvAlertLog || []), entry].slice(-2000);
  await save();
  res.json({ entry });
}));

// Uso da ferramenta por fazenda: voo, leitura da manhã, decisão de trato e leitura noturna.
adminRouter.get('/ccv/usage', route(async (req, res) => {
  const reports = [];
  for (const report of ccvReports()) reports.push({ report: { id: report.id, name: report.name }, ...(await ccvUsage(report, { refresh: req.query.refresh === '1' })) });
  res.json({ reports });
}));

// Histórico das decisões (mais recentes primeiro).
adminRouter.get('/ccv/log', (_req, res) => {
  const users = db().users;
  res.json({
    log: [...(db().ccvAlertLog || [])]
      .reverse()
      .slice(0, 200)
      .map((e) => ({ ...e, adminName: users.find((u) => u.id === e.adminId)?.name || null })),
  });
});

// ---------- Benchmarking Confinamento ----------

adminRouter.get('/benchmark', (_req, res) => res.json({ settings: bmkSettings(), clients: bmkList() }));

adminRouter.put('/benchmark/settings', route(async (req, res) => {
  res.json({ settings: await saveBmkSettings(req.body || {}) });
}));

// Dados de todos os clientes do ano, para o Excel consolidado (montado no navegador).
adminRouter.get('/benchmark/export', (_req, res) => res.json(bmkExport()));

// Métricas do processo de coleta (tempos, rodadas, pessoas, Pareto dos erros): ver src/benchmarkMetrics.js.
adminRouter.get('/benchmark/metrics', (_req, res) => res.json(processMetrics()));

// ---------- Cotações (faixa do rodapé do portal) ----------

adminRouter.get('/quotes', route(async (_req, res) => res.json(await adminQuotes())));

adminRouter.put('/quotes/options', route(async (req, res) => {
  await setQuoteOptions(req.body || {});
  res.json(await adminQuotes());
}));

adminRouter.post('/quotes', route(async (req, res) => {
  await saveManual(null, req.body || {});
  res.status(201).json(await adminQuotes());
}));

adminRouter.put('/quotes/:id', route(async (req, res) => {
  await saveManual(req.params.id, req.body || {});
  res.json(await adminQuotes());
}));

adminRouter.delete('/quotes/:id', route(async (req, res) => {
  await deleteManual(req.params.id);
  res.json(await adminQuotes());
}));

adminRouter.post('/quotes/:id/value', route(async (req, res) => {
  await setManualValue(req.params.id, req.body || {}, req.user);
  res.json(await adminQuotes());
}));

// ---------- Mensagens com os usuários ----------

adminRouter.get('/chat', (_req, res) => res.json(adminInbox()));

adminRouter.get('/chat/:userId', (req, res) => res.json(adminConversation(req.params.userId)));

adminRouter.post('/chat/:userId', route(async (req, res) => {
  res.status(201).json({ message: await adminSend(req.user, req.params.userId, { text: req.body?.text }) });
}));

adminRouter.get('/chat/:userId/files/:fileId', (req, res) => {
  const file = chatFile(req.params.userId, req.params.fileId);
  res.download(file.path, file.name, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Arquivo não encontrado.' });
  });
});

adminRouter.post('/chat/:userId/read', route(async (req, res) => {
  await adminMarkRead(req.params.userId);
  res.json(adminInbox());
}));

adminRouter.post('/chat/:userId/status', route(async (req, res) => {
  await setThreadStatus(req.params.userId, req.body?.status);
  res.json(adminInbox());
}));

// ---------- Saúde dos dados ----------

adminRouter.get('/data-health', (_req, res) => res.json(dataHealthSummary()));

// Dispara uma nova verificação em segundo plano; o painel acompanha o andamento.
adminRouter.post('/data-health/scan', (_req, res) => {
  scanDataHealth();
  res.status(202).json(scanState());
});

adminRouter.put('/settings', route(async (req, res) => {
  const data = db();
  const staleDays = Number.parseInt(req.body?.staleDays, 10);
  if (req.body?.staleDays !== undefined && (!Number.isFinite(staleDays) || staleDays < 1 || staleDays > 365)) {
    fail('Informe um número de dias entre 1 e 365.');
  }
  data.settings = {
    ...(data.settings || {}),
    ...(req.body?.staleDays !== undefined ? { staleDays } : {}),
    ...(req.body?.showDataDate !== undefined ? { showDataDate: Boolean(req.body.showDataDate) } : {}),
    ...(req.body?.npsEnabled !== undefined ? { npsEnabled: Boolean(req.body.npsEnabled) } : {}),
  };
  await save();
  res.json({ settings: dataSettings() });
}));

// ---------- Categorias ----------

function readCategory(body, existing) {
  const category = {
    name: text(body.name, 60),
    description: text(body.description, 500),
    imageId: body.imageId ? text(body.imageId, 36) : null,
  };
  if (!category.name) fail('Informe o nome da categoria.');
  const twin = categoryByName(category.name);
  if (twin && twin.id !== existing?.id) fail(`Já existe a categoria "${twin.name}".`);
  if (category.imageId && !db().images.some((i) => i.id === category.imageId)) fail('Imagem não encontrada.');
  return category;
}

adminRouter.get('/categories', (_req, res) => {
  const { categories, reports } = db();
  res.json({
    categories: sortByName(categories).map((c) => ({
      ...c,
      imageUrl: imageUrl(c.imageId),
      reports: reports.filter((r) => r.categoryId === c.id).length,
      ownImages: reports.filter((r) => r.categoryId === c.id && r.imageId).length,
      ownDescriptions: reports.filter((r) => r.categoryId === c.id && r.description).length,
    })),
  });
});

adminRouter.post('/categories', route(async (req, res) => {
  const category = { id: newId(), ...readCategory(req.body || {}), createdAt: new Date().toISOString() };
  db().categories.push(category);
  await save();
  res.status(201).json({ category });
}));

adminRouter.put('/categories/:id', route(async (req, res) => {
  const category = findOr404(db().categories, req.params.id, 'Categoria');
  Object.assign(category, readCategory(req.body || {}, category));
  syncCategoryName(category);
  await save();
  res.json({ category });
}));

adminRouter.delete('/categories/:id', route(async (req, res) => {
  const data = db();
  const category = findOr404(data.categories, req.params.id, 'Categoria');
  const used = data.reports.filter((r) => r.categoryId === category.id).length;
  if (used) fail(`A categoria tem ${used} relatório(s). Mova esses relatórios para outra categoria antes de excluir.`);
  data.categories = data.categories.filter((c) => c.id !== category.id);
  await save();
  res.json({ ok: true });
}));

// ---------- WhatsApp: status, avisos e simulador ----------

adminRouter.get('/bot/status', (_req, res) => {
  const { users } = db();
  const clientUsers = users.filter((u) => u.role === 'client' && u.active);
  res.json({
    whatsapp: whatsappStatus(),
    ai: clientUsers.filter((u) => aiAvailableFor(u)).length,
    publicUrl: config.publicUrl || null,
    usersWithPhone: clientUsers.filter((u) => u.phone).length,
    usersNotify: clientUsers.filter((u) => u.phone && u.whatsappNotify).length,
    clientUsers: clientUsers.length,
    messages: recentBotMessages()
      .slice(0, 100)
      .map((m) => ({ ...m, user: users.find((u) => u.id === m.userId)?.name || null })),
  });
});

adminRouter.get('/reports/:id/notify-preview', (req, res) => {
  const report = findOr404(db().reports, req.params.id, 'Relatório');
  res.json({ recipients: recipientsFor(report).map((u) => u.name), whatsapp: whatsappStatus() });
});

adminRouter.post('/reports/:id/notify', route(async (req, res) => {
  const report = findOr404(db().reports, req.params.id, 'Relatório');
  res.json(await notifyReportUpdated(report));
}));

// PDFs gerados no simulador ficam disponíveis por 1 hora para o admin baixar.
const simFiles = new Map();

adminRouter.post('/bot/simulate', route(async (req, res) => {
  const user = findOr404(db().users, text(req.body?.userId, 36), 'Usuário');
  if (user.role !== 'client') fail('Escolha um usuário de cliente para simular.');
  const message = text(req.body?.text, 1000);
  const now = Date.now();
  for (const [id, f] of simFiles) if (now - f.at > 60 * 60 * 1000) simFiles.delete(id);
  const replies = [];
  logBotMessage({ direction: 'in', userId: user.id, text: message, channel: 'simulator' });
  const send = async (reply) => {
    if (reply.type === 'text') {
      replies.push({ type: 'text', text: reply.text });
      logBotMessage({ direction: 'out', userId: user.id, text: reply.text, channel: 'simulator' });
    } else if (reply.type === 'document') {
      const id = newId();
      simFiles.set(id, { at: now, buffer: reply.buffer, fileName: reply.fileName });
      replies.push({ type: 'document', fileName: reply.fileName, caption: reply.caption, url: `/api/admin/bot/files/${id}` });
      logBotMessage({ direction: 'out', userId: user.id, text: `[PDF] ${reply.fileName}`, channel: 'simulator' });
    }
  };
  const baseUrl = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  await handleMessage({ user, text: message, send, channel: 'simulator', baseUrl });
  res.json({ replies });
}));

adminRouter.get('/bot/files/:id', (req, res) => {
  const file = simFiles.get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Arquivo expirado. Gere o PDF de novo.' });
  res.attachment(file.fileName).type('application/pdf').send(file.buffer);
});

// ---------- Backup ----------

const stamp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

adminRouter.get('/backup', (_req, res) => {
  res.attachment(`probeef-analytics-backup-${stamp()}.json`);
  res.type('application/json').send(JSON.stringify(exportData(), null, 2));
});

adminRouter.get('/backups', route(async (_req, res) => {
  res.json({ backups: await listSnapshots() });
}));

adminRouter.get('/backups/:name', (req, res) => {
  const file = snapshotPath(req.params.name);
  if (!file) return res.status(404).json({ error: 'Backup não encontrado.' });
  res.download(file, `probeef-analytics-${req.params.name}`, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Backup não encontrado.' });
  });
});

adminRouter.post('/restore', route(async (req, res) => {
  const backup = req.body?.backup;
  const problem = validateBackup(backup);
  if (problem) fail(problem);
  replaceData(backup.data);
  await save();
  const { users, clients, reports } = db();
  // Se o admin que restaurou não existir no backup (ou mudou), a sessão dele deixa de valer.
  const stillValid = users.some((u) => u.id === req.user.id && u.active && u.sessionVersion === req.session?.sv);
  res.json({ counts: { users: users.length, clients: clients.length, reports: reports.length }, loggedOut: !stillValid });
}));

// ---------- Uso ----------

const periodDays = (req) => ([7, 30, 90, 180, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30);

// ?tags=id1,id2 → só clientes com essas tags (mesmo grupo: qualquer uma; grupos diferentes: todas).
const tagFilter = (req) => String(req.query.tags || '').split(',').map((t) => t.trim()).filter(Boolean);

adminRouter.get('/usage', (req, res) => {
  const days = periodDays(req);
  res.json({ ...usageSummary(days, { tagIds: tagFilter(req) }), nps: npsSummary(days, { tagIds: tagFilter(req) }) });
});

adminRouter.get('/usage/client/:id', (req, res) => {
  const detail = clientUsage(req.params.id, periodDays(req));
  if (!detail) return res.status(404).json({ error: 'Cliente não encontrado.' });
  res.json(detail);
});

adminRouter.get('/usage/report/:id', (req, res) => {
  const detail = reportPages(req.params.id, periodDays(req));
  if (!detail) return res.status(404).json({ error: 'Relatório não encontrado.' });
  res.json(detail);
});

adminRouter.get('/usage.csv', (req, res) => {
  const days = periodDays(req);
  const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  res.attachment(`probeef-analytics-uso-${days}dias-${stamp}.csv`);
  res.type('text/csv; charset=utf-8').send(usageCsv(days, { tagIds: tagFilter(req) }));
});

// ---------- Relatórios ----------

function readReport(body) {
  const report = {
    name: text(body.name, 120),
    categoryId: text(body.categoryId, 36),
    description: text(body.description, 500),
    workspaceId: text(body.workspaceId, 36).toLowerCase(),
    reportId: text(body.reportId, 36).toLowerCase(),
    rls: Boolean(body.rls),
    imageId: body.imageId ? text(body.imageId, 36) : null,
    // "ccv": painel nativo do portal (as fazendas de cada cliente são escolhidas em Clientes).
    kind: body.kind === 'ccv' ? 'ccv' : 'powerbi',
  };
  if (report.kind === 'ccv') report.rls = false;
  if (!report.name) fail('Informe o nome do relatório.');
  if (report.imageId && !db().images.some((i) => i.id === report.imageId)) fail('Imagem não encontrada.');
  const category = findCategory(report.categoryId);
  if (!category) fail('Escolha a categoria do relatório.');
  report.category = category.name;
  if (!isGuid(report.workspaceId)) fail('O ID do workspace deve ser um GUID (ex.: 1a2b3c4d-...).');
  if (!isGuid(report.reportId)) fail('O ID do relatório deve ser um GUID (ex.: 1a2b3c4d-...).');
  return report;
}

adminRouter.get('/reports', (_req, res) => res.json({ reports: db().reports }));

adminRouter.post('/reports', route(async (req, res) => {
  const report = { id: newId(), ...readReport(req.body || {}), createdAt: new Date().toISOString() };
  db().reports.push(report);
  await save();
  res.status(201).json({ report });
}));

adminRouter.put('/reports/:id', route(async (req, res) => {
  const report = findOr404(db().reports, req.params.id, 'Relatório');
  Object.assign(report, readReport(req.body || {}));
  await save();
  res.json({ report });
}));

adminRouter.delete('/reports/:id', route(async (req, res) => {
  const data = db();
  findOr404(data.reports, req.params.id, 'Relatório');
  data.reports = data.reports.filter((r) => r.id !== req.params.id);
  for (const client of data.clients) client.reportIds = client.reportIds.filter((id) => id !== req.params.id);
  forgetReport(req.params.id);
  await save();
  res.json({ ok: true });
}));

adminRouter.get('/workspace-reports', route(async (req, res) => {
  const workspaceId = text(req.query.workspaceId || config.powerbi.defaultWorkspaceId, 36).toLowerCase();
  if (!workspaceId) fail('Informe o ID do workspace.');
  const reports = await listWorkspaceReports(workspaceId);
  const registered = new Set(db().reports.map((r) => r.reportId));
  res.json({
    workspaceId,
    reports: reports.map((r) => ({ ...r, registered: registered.has(r.reportId) })),
  });
}));

// ---------- Configuração automática ----------

// Lê o workspace e sugere cliente, categoria e nome amigável para cada relatório.
adminRouter.get('/setup-suggestions', route(async (req, res) => {
  const workspaceId = text(req.query.workspaceId || config.powerbi.defaultWorkspaceId, 36).toLowerCase();
  if (!workspaceId) fail('Informe o ID do workspace.');
  const pbiReports = await listWorkspaceReports(workspaceId);
  const { reports, clients } = db();

  const suggestions = pbiReports.map((r) => ({ ...r, ...suggestFromName(r.name) }));

  // Padroniza o nome de cada cliente: usa o cadastro existente ou a variação mais apresentável.
  const existingByKey = new Map(clients.map((c) => [clientKey(c.name), c.name]));
  const variants = new Map();
  for (const s of suggestions) {
    if (!s.client) continue;
    const key = clientKey(s.client);
    if (!variants.has(key)) variants.set(key, []);
    variants.get(key).push(s.client);
  }
  const canonical = (name) => {
    const key = clientKey(name);
    return existingByKey.get(key) || preferredName(variants.get(key) || [name]);
  };

  res.json({
    workspaceId,
    clientNames: clients.map((c) => c.name).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    items: suggestions
      .map((s) => {
        const registered = reports.find((r) => r.reportId === s.reportId);
        const assigned = registered ? clients.filter((c) => c.reportIds.includes(registered.id)).map((c) => c.name) : [];
        return {
          reportId: s.reportId,
          originalName: s.name,
          client: assigned[0] || (s.client ? canonical(s.client) : ''),
          category: registered?.category || categoryByName(s.category)?.name || s.category,
          displayName: registered?.name || s.displayName,
          registered: Boolean(registered),
          assigned: assigned.length > 0,
          skip: s.skip,
        };
      })
      .sort((a, b) => a.client.localeCompare(b.client, 'pt-BR') || a.displayName.localeCompare(b.displayName, 'pt-BR')),
  });
}));

// Cria (ou atualiza) relatórios e clientes de uma vez e libera cada relatório para o cliente indicado.
adminRouter.post('/bulk-setup', route(async (req, res) => {
  const data = db();
  const workspaceId = text(req.body?.workspaceId, 36).toLowerCase();
  if (!isGuid(workspaceId)) fail('ID de workspace inválido.');
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) fail('Marque ao menos um relatório.');
  if (items.length > 1000) fail('Envie no máximo 1000 relatórios por vez.');

  const now = new Date().toISOString();
  const clientsByKey = new Map(data.clients.map((c) => [clientKey(c.name), c]));
  const counts = { reportsCreated: 0, reportsUpdated: 0, clientsCreated: 0, assignments: 0 };

  for (const raw of items) {
    const reportId = text(raw.reportId, 36).toLowerCase();
    const name = text(raw.displayName, 120);
    // Categoria escolhida da lista (id) ou digitada/sugerida (nome, criada se ainda não existir).
    const category = findCategory(text(raw.categoryId, 36)) || ensureCategory(text(raw.category, 60));
    const clientName = text(raw.client, 120);
    if (!isGuid(reportId)) fail(`ID de relatório inválido: ${reportId || '(vazio)'}.`);
    if (!name) fail('Todo relatório marcado precisa de um nome.');
    if (!clientName) fail(`Informe o cliente do relatório "${name}".`);

    let report = data.reports.find((r) => r.reportId === reportId && r.workspaceId === workspaceId);
    if (report) {
      Object.assign(report, { name, categoryId: category.id, category: category.name });
      counts.reportsUpdated += 1;
    } else {
      report = {
        id: newId(),
        name,
        categoryId: category.id,
        category: category.name,
        description: '',
        workspaceId,
        reportId,
        rls: false,
        kind: 'powerbi',
        createdAt: now,
      };
      data.reports.push(report);
      counts.reportsCreated += 1;
    }

    const key = clientKey(clientName);
    let client = clientsByKey.get(key);
    if (!client) {
      client = { id: newId(), name: clientName, rlsUsername: '', rlsRoles: [], reportIds: [], tagIds: [], ccvFarms: [], active: true, createdAt: now };
      data.clients.push(client);
      clientsByKey.set(key, client);
      counts.clientsCreated += 1;
    }
    if (!client.reportIds.includes(report.id)) {
      client.reportIds.push(report.id);
      counts.assignments += 1;
    }
  }

  await save();
  res.json(counts);
}));

// ---------- Clientes (empresas) ----------

const farmList = (list) => [...new Set(list.map((f) => text(f, 120)).filter(Boolean))].slice(0, 200);

function readClient(body) {
  const known = new Set(db().reports.map((r) => r.id));
  const client = {
    name: text(body.name, 120),
    rlsUsername: text(body.rlsUsername, 200),
    rlsRoles: (Array.isArray(body.rlsRoles) ? body.rlsRoles : String(body.rlsRoles || '').split(','))
      .map((r) => text(r, 100))
      .filter(Boolean),
    reportIds: (Array.isArray(body.reportIds) ? body.reportIds : []).filter((id) => known.has(id)),
    active: body.active !== false,
  };
  // Só mexe nas tags quando o formulário as envia (assim outras telas não apagam as tags).
  if (Array.isArray(body.tagIds)) {
    const tagIds = new Set(db().tags.map((t) => t.id));
    client.tagIds = [...new Set(body.tagIds)].filter((id) => tagIds.has(id));
  }
  // Fazendas do painel CCV (nomes exatamente como estão no modelo). Mesma regra das tags.
  if (Array.isArray(body.ccvFarms)) client.ccvFarms = farmList(body.ccvFarms);
  // Participa do Benchmarking (só muda quando o formulário envia o campo) e o responsável por ele
  // (Time ou Canais Cargill; define quem enxerga a fazenda pela equipe, ver src/bmkTeam.js).
  if (typeof body.benchmark === 'boolean') client.benchmark = body.benchmark;
  if (body.bmkOwner !== undefined) {
    const owner = body.bmkOwner && db().users.find((u) => u.id === body.bmkOwner && u.role !== 'admin' && ['cargill', 'canal'].includes(u.kind));
    if (body.bmkOwner && !owner) fail('O responsável no Benchmarking precisa ser do Time ou de Canais Cargill.');
    client.bmkOwner = owner ? owner.id : null;
  }
  if (!client.name) fail('Informe o nome do cliente.');
  if (client.rlsRoles.length && !client.rlsUsername) fail('Informe o usuário RLS junto com as funções.');
  return client;
}

adminRouter.get('/clients', (_req, res) => res.json({ clients: db().clients.map((c) => ({ ...c, tagIds: c.tagIds || [] })) }));

// ---------- Tags dos clientes ----------

const TAG_COLORS = 8;

function readTag(body, existing) {
  const tag = {
    name: text(body.name, 40),
    group: text(body.group, 40),
    color: Math.min(TAG_COLORS - 1, Math.max(0, Number.parseInt(body.color, 10) || 0)),
  };
  if (!tag.name) fail('Informe o nome da tag.');
  const same = (t) => t.name.toLowerCase() === tag.name.toLowerCase() && (t.group || '').toLowerCase() === tag.group.toLowerCase();
  const twin = db().tags.find((t) => t.id !== existing?.id && same(t));
  if (twin) fail(`Já existe a tag "${twin.group ? `${twin.group}: ` : ''}${twin.name}".`);
  return tag;
}

// Define de uma vez quais clientes têm a tag.
function applyTagClients(tagId, clientIds) {
  if (!Array.isArray(clientIds)) return;
  const wanted = new Set(clientIds);
  for (const c of db().clients) {
    const has = (c.tagIds || []).includes(tagId);
    if (wanted.has(c.id) && !has) c.tagIds = [...(c.tagIds || []), tagId];
    if (!wanted.has(c.id) && has) c.tagIds = c.tagIds.filter((id) => id !== tagId);
  }
}

adminRouter.get('/tags', (_req, res) => {
  const { tags, clients } = db();
  res.json({
    tags: [...tags]
      .sort((a, b) => (a.group || '').localeCompare(b.group || '', 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR'))
      .map((t) => ({ ...t, clients: clients.filter((c) => (c.tagIds || []).includes(t.id)).length })),
  });
});

adminRouter.post('/tags', route(async (req, res) => {
  const tag = { id: newId(), ...readTag(req.body || {}), createdAt: new Date().toISOString() };
  db().tags.push(tag);
  applyTagClients(tag.id, req.body?.clientIds);
  await save();
  res.status(201).json({ tag });
}));

adminRouter.put('/tags/:id', route(async (req, res) => {
  const tag = findOr404(db().tags, req.params.id, 'Tag');
  Object.assign(tag, readTag(req.body || {}, tag));
  applyTagClients(tag.id, req.body?.clientIds);
  await save();
  res.json({ tag });
}));

adminRouter.delete('/tags/:id', route(async (req, res) => {
  const data = db();
  const tag = findOr404(data.tags, req.params.id, 'Tag');
  data.tags = data.tags.filter((t) => t.id !== tag.id);
  for (const c of data.clients) c.tagIds = (c.tagIds || []).filter((id) => id !== tag.id);
  await save();
  res.json({ ok: true });
}));

adminRouter.post('/clients', route(async (req, res) => {
  const client = { id: newId(), tagIds: [], ccvFarms: [], benchmark: false, ...readClient(req.body || {}), createdAt: new Date().toISOString() };
  db().clients.push(client);
  await save();
  res.status(201).json({ client });
}));

adminRouter.put('/clients/:id', route(async (req, res) => {
  const client = findOr404(db().clients, req.params.id, 'Cliente');
  Object.assign(client, readClient(req.body || {}));
  await save();
  res.json({ client });
}));

adminRouter.delete('/clients/:id', route(async (req, res) => {
  const data = db();
  const client = findOr404(data.clients, req.params.id, 'Cliente');
  // Usuários que só têm este cliente ficariam sem acesso a nada: peça para resolver antes.
  const orphans = data.users.filter((u) => u.role === 'client' && u.clientIds.length === 1 && u.clientIds[0] === client.id);
  if (orphans.length) {
    const names = orphans.slice(0, 3).map((u) => u.name).join(', ');
    fail(`${orphans.length === 1 ? 'O usuário' : 'Os usuários'} ${names}${orphans.length > 3 ? ' e outros' : ''} só ${orphans.length === 1 ? 'tem' : 'têm'} acesso a este cliente. Exclua ou mova esses usuários antes.`);
  }
  for (const u of data.users) u.clientIds = u.clientIds.filter((id) => id !== client.id);
  data.clients = data.clients.filter((c) => c.id !== client.id);
  await save();
  res.json({ ok: true });
}));

// ---------- Usuários ----------

// Nunca devolve senha nem a chave da Anthropic; só diz se o usuário tem assistente ativo.
// gerenciaEfetiva: a gerência do Time Cargill ou a herdada de quem cadastrou (ver gerenciaOf).
const safeUser = ({ passwordHash, sessionVersion, anthropicKey, savedViews, ...rest }) => ({ ...rest, hasAssistant: Boolean(anthropicKey), savedViewCount: savedViews?.length || 0, gerenciaEfetiva: gerenciaOf(rest) });

function readUser(body, existing) {
  const user = {
    email: text(body.email, 200).toLowerCase(),
    name: text(body.name, 120),
    role: body.role === 'admin' ? 'admin' : 'client',
    clientIds: body.role === 'admin' ? [] : [...new Set((Array.isArray(body.clientIds) ? body.clientIds : []).map((id) => text(id, 36)))],
    phone: cleanPhoneInput(body.phone),
    whatsappNotify: Boolean(body.whatsappNotify),
    // Painel CCV: só estas fazendas (dentre as dos clientes dele); vazio = todas as dos clientes.
    ccvFarms: body.role === 'admin' || !Array.isArray(body.ccvFarms) ? [] : farmList(body.ccvFarms),
    active: body.active !== false,
  };
  // Benchmarking (src/bmkTeam.js): perfil, a quem responde e os poderes do Time Cargill.
  if (user.role !== 'admin') {
    const kind = KINDS[body.kind] ? body.kind : 'cliente';
    const cargill = kind === 'cargill';
    Object.assign(user, {
      kind,
      reportsTo: kind === 'cliente' ? null : checkReportsTo(existing?.id, text(body.reportsTo, 36) || null),
      bmkGestor: cargill && Boolean(body.bmkGestor),
      bmkValidator: cargill && Boolean(body.bmkValidator),
      bmkCreateTeam: cargill && Boolean(body.bmkGestor) && Boolean(body.bmkCreateTeam),
      // Gerência (só do Time Cargill; Canais e Cliente herdam de quem os cadastrou).
      gerencia: cargill ? text(body.gerencia, 80) || null : null,
      // Só Benchmarking: sem relatórios, CCV nem ferramentas (ver userClients em src/auth.js).
      bmkOnly: Boolean(body.bmkOnly),
    });
  } else {
    Object.assign(user, { kind: undefined, reportsTo: null, bmkGestor: false, bmkValidator: false, bmkCreateTeam: false, bmkOnly: false, gerencia: null });
  }
  if (user.phone && (user.phone.length < 12 || user.phone.length > 15)) fail('Telefone inválido. Use DDD + número, ex.: (61) 99999-8888.');
  const phoneOwner = user.phone && db().users.find((u) => u.id !== existing?.id && samePhone(u.phone, user.phone));
  if (phoneOwner) fail(`Este telefone já está no usuário ${phoneOwner.name}.`);
  if (!EMAIL.test(user.email)) fail('Informe um e-mail válido.');
  if (!user.name) fail('Informe o nome do usuário.');
  if (db().users.some((u) => u.email === user.email && u.id !== existing?.id)) fail('Já existe um usuário com este e-mail.');
  const known = new Set(db().clients.map((c) => c.id));
  user.clientIds = user.clientIds.filter((id) => known.has(id));
  // Sem cliente é válido: a pessoa só usa as ferramentas (4M, 3P), liberadas uma a uma, ou é do
  // Time/Canais Cargill e vê as fazendas do benchmarking pela equipe.
  return user;
}

function remainingAdmins(exceptId) {
  return db().users.filter((u) => u.role === 'admin' && u.active && u.id !== exceptId).length;
}

adminRouter.get('/users', (_req, res) => res.json({ users: db().users.map(safeUser) }));

adminRouter.post('/users', route(async (req, res) => {
  const body = req.body || {};
  const fields = readUser(body);
  const password = body.password ? String(body.password) : generatePassword();
  const problem = validatePassword(password);
  if (problem) fail(problem);
  const user = {
    id: newId(),
    ...fields,
    confinamento: { status: 'none', requestedAt: null, decidedAt: null },
    pasto: { status: 'none', requestedAt: null, decidedAt: null },
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    sessionVersion: 1,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  };
  db().users.push(user);
  await save();
  res.status(201).json({ user: safeUser(user), password: body.password ? undefined : password });
}));

adminRouter.put('/users/:id', route(async (req, res) => {
  const user = findOr404(db().users, req.params.id, 'Usuário');
  const fields = readUser(req.body || {}, user);
  const losesAdmin = user.role === 'admin' && (fields.role !== 'admin' || !fields.active);
  if (losesAdmin && remainingAdmins(user.id) === 0) fail('É preciso manter pelo menos um administrador ativo.');
  // Mudança de clientes vale na hora (o acesso é conferido a cada pedido); só papel e situação derrubam a sessão.
  const revoke = fields.active !== user.active || fields.role !== user.role;
  Object.assign(user, fields);
  if (revoke) user.sessionVersion += 1;
  await save();
  res.json({ user: safeUser(user) });
}));

// "Entrar como": o admin passa a ver o portal exatamente como o usuário, sem a senha dele.
// Só para usuários de cliente; cada uso fica registrado (data.audit, últimos 1000).
adminRouter.post('/users/:id/impersonate', route(async (req, res) => {
  const data = db();
  const user = findOr404(data.users, req.params.id, 'Usuário');
  if (user.role !== 'client') fail('Só é possível entrar como usuários de cliente.');
  if (!user.active) fail('Este usuário está desativado. Ative-o antes de entrar como ele.');
  data.audit = [...(data.audit || []), { at: new Date().toISOString(), action: 'impersonate', adminId: req.user.id, userId: user.id }].slice(-1000);
  await save();
  console.log(`[auditoria] ${req.user.email} entrou como ${user.email}`);
  req.session = { uid: user.id, sv: user.sessionVersion, imp: req.user.id, isv: req.user.sessionVersion };
  res.json({ ok: true });
}));

adminRouter.post('/users/:id/reset-password', route(async (req, res) => {
  const user = findOr404(db().users, req.params.id, 'Usuário');
  const password = generatePassword();
  user.passwordHash = await hashPassword(password);
  user.mustChangePassword = true;
  user.sessionVersion += 1;
  await save();
  res.json({ password });
}));

// Libera, nega ou revoga o acesso à calculadora 4M Confinamento.
adminRouter.post('/users/:id/confinamento', route(async (req, res) => {
  const user = findOr404(db().users, req.params.id, 'Usuário');
  const action = req.body?.action;
  const status = { approve: 'approved', deny: 'denied', revoke: 'none' }[action];
  if (!status) fail('Ação inválida.');
  user.confinamento = { ...(user.confinamento || {}), status, decidedAt: new Date().toISOString() };
  await save();
  res.json({ user: safeUser(user) });
}));

// Libera, nega ou revoga o acesso à 3P · Desempenho a Pasto.
adminRouter.post('/users/:id/pasto', route(async (req, res) => {
  const user = findOr404(db().users, req.params.id, 'Usuário');
  const status = { approve: 'approved', deny: 'denied', revoke: 'none' }[req.body?.action];
  if (!status) fail('Ação inválida.');
  user.pasto = { ...(user.pasto || {}), status, decidedAt: new Date().toISOString() };
  await save();
  res.json({ user: safeUser(user) });
}));

adminRouter.delete('/users/:id', route(async (req, res) => {
  const data = db();
  const user = findOr404(data.users, req.params.id, 'Usuário');
  if (user.id === req.user.id) fail('Você não pode excluir o próprio usuário.');
  if (user.role === 'admin' && remainingAdmins(user.id) === 0) fail('É preciso manter pelo menos um administrador ativo.');
  data.users = data.users.filter((u) => u.id !== user.id);
  forgetChat(user.id);
  await save();
  res.json({ ok: true });
}));

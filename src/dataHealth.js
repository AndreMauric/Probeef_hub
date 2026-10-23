// Saúde dos dados: de quando são os dados de cada relatório e se a atualização está funcionando.
// Fontes, por ordem de confiança:
//   1. Uma coluna de data de atualização dentro do modelo (ex.: tabela "Última Atualização").
//   2. A última atualização concluída no Power BI.
// A varredura roda em segundo plano (na partida e a cada 6 horas) e o resultado fica guardado,
// para o painel abrir na hora.
import { db, save } from './store.js';
import { datasetRefreshes, datasetSchedule, executeDax, isConfigured, reportDataset } from './powerbi.js';

const SCAN_EVERY_MS = 6 * 60 * 60 * 1000;
const CONCURRENCY = 4;
const DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_STALE_DAYS = 7;

export function settings() {
  const s = db().settings || {};
  return {
    staleDays: Number.isFinite(s.staleDays) && s.staleDays > 0 ? s.staleDays : DEFAULT_STALE_DAYS,
    showDataDate: s.showDataDate !== false,
  };
}

// Erros comuns de atualização do Power BI, em português.
const ERRORS = {
  ModelRefreshDisabled_CredentialNotSpecified: 'As credenciais da fonte de dados não estão configuradas no Power BI.',
  ModelRefresh_ShortMessage_CredentialsNotSpecified: 'As credenciais da fonte de dados não estão configuradas no Power BI.',
  DM_GWPipeline_Gateway_DataSourceAccessError: 'O gateway não conseguiu acessar a fonte de dados.',
  DMTS_DatasourceHasNoCredentialError: 'A fonte de dados está sem credenciais.',
  DM_GWPipeline_Gateway_MashupDataAccessError: 'Erro ao ler a fonte de dados pelo gateway.',
};

function describeFailure(refresh) {
  if (!refresh) return null;
  if (refresh.status === 'Disabled') return 'A atualização agendada foi desativada (o Power BI desliga após falhas seguidas ou por falta de capacidade).';
  let code = '';
  try {
    code = JSON.parse(refresh.serviceExceptionJson || '{}').errorCode || '';
  } catch {
    code = '';
  }
  return ERRORS[code] || (code ? `Falha na atualização (${code}).` : 'Falha na última atualização.');
}

// Maior data plausível entre as colunas cujo nome fala em atualização.
function dataDateFromColumns(columns) {
  const now = Date.now() + DAY;
  let best = null;
  for (const c of columns) {
    const table = c['[Table Name]'] || '';
    if (/^(LocalDateTable|DateTableTemplate)_/.test(table)) continue;
    if (!/atualiza|update|refresh/i.test(`${table} ${c['[Column Name]']}`)) continue;
    // Datas do modelo vêm sem fuso: são horário de Brasília (sem horário de verão desde 2019).
    const raw = String(c['[Max]'] ?? '');
    const t = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(raw) || !raw.includes('T') ? raw : `${raw}-03:00`);
    if (!Number.isFinite(t) || t < Date.UTC(2000, 0, 1) || t > now) continue;
    if (!best || t > best.t) best = { t, column: `'${table}'[${c['[Column Name]']}]` };
  }
  return best;
}

async function checkDataset(workspaceId, datasetId) {
  const [refreshes, schedule, columns] = await Promise.all([
    datasetRefreshes(workspaceId, datasetId).catch(() => []),
    datasetSchedule(workspaceId, datasetId),
    executeDax(workspaceId, datasetId, 'EVALUATE COLUMNSTATISTICS()').catch(() => []),
  ]);
  const lastSuccess = refreshes.find((r) => r.status === 'Completed' && r.endTime);
  const lastAttempt = refreshes.find((r) => r.status !== 'Unknown'); // "Unknown" = em andamento
  const fromColumn = dataDateFromColumns(columns);
  const dataDate = fromColumn ? new Date(fromColumn.t).toISOString() : lastSuccess?.endTime || null;
  // Uma falha só vale se for a novidade mais recente: se o relatório foi republicado com dados
  // mais novos depois dela, a situação é dada pela data dos dados.
  const attemptAt = Date.parse(lastAttempt?.endTime || lastAttempt?.startTime || '');
  const failedLast = lastAttempt && ['Failed', 'Disabled'].includes(lastAttempt.status);
  const failing = failedLast && !(dataDate && Date.parse(dataDate) > attemptAt + DAY) ? lastAttempt : null;
  return {
    dataDate,
    source: fromColumn ? `coluna ${fromColumn.column}` : lastSuccess ? 'última atualização no Power BI' : null,
    lastRefresh: lastSuccess?.endTime || null,
    lastAttempt: lastAttempt ? { status: lastAttempt.status, at: lastAttempt.endTime || lastAttempt.startTime || null, type: lastAttempt.refreshType } : null,
    failure: failing ? describeFailure(failing) : null,
    scheduleEnabled: schedule ? Boolean(schedule.enabled) : null,
  };
}

// Situação do relatório a partir do que foi encontrado e do limite de dias.
export function statusOf(health, staleDays = settings().staleDays) {
  if (!health || health.error) return 'erro';
  if (health.failure) return 'falha';
  if (!health.dataDate) return 'sem-info';
  return Date.now() - Date.parse(health.dataDate) > staleDays * DAY ? 'desatualizado' : 'ok';
}

let running = null;
const progress = { done: 0, total: 0 };

// Relatórios que importam: os liberados para algum cliente ativo.
function reportsToCheck() {
  const { reports, clients } = db();
  const active = clients.filter((c) => c.active);
  return reports.filter((r) => active.some((c) => c.reportIds.includes(r.id)));
}

export function scanState() {
  return { running: Boolean(running), ...progress, checkedAt: db().dataHealthCheckedAt || null };
}

export function scanDataHealth() {
  if (running) return running;
  if (!isConfigured()) return Promise.resolve();
  running = (async () => {
    const reports = reportsToCheck();
    const byDataset = new Map(); // o mesmo conjunto de dados pode servir vários relatórios
    const results = {};
    progress.done = 0;
    progress.total = reports.length;
    const queue = [...reports];
    const worker = async () => {
      while (queue.length) {
        const report = queue.shift();
        try {
          const { datasetId, datasetWorkspaceId } = await reportDataset(report.workspaceId, report.reportId);
          if (!datasetId) throw new Error('Relatório sem conjunto de dados.');
          const key = `${datasetWorkspaceId}/${datasetId}`;
          if (!byDataset.has(key)) byDataset.set(key, checkDataset(datasetWorkspaceId, datasetId));
          results[report.id] = { ...(await byDataset.get(key)), checkedAt: new Date().toISOString() };
        } catch (err) {
          results[report.id] = { error: err.message, checkedAt: new Date().toISOString() };
        }
        progress.done += 1;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    const data = db();
    data.dataHealth = results;
    data.dataHealthCheckedAt = new Date().toISOString();
    await save();
  })()
    .catch((err) => console.error('Falha na verificação da saúde dos dados:', err.message))
    .finally(() => {
      running = null;
    });
  return running;
}

export function startDataHealthWatcher() {
  setTimeout(() => scanDataHealth(), 30 * 1000).unref();
  setInterval(() => scanDataHealth(), SCAN_EVERY_MS).unref();
}

// Visão para o painel do admin.
export function dataHealthSummary() {
  const { reports, clients } = db();
  const health = db().dataHealth || {};
  const { staleDays } = settings();
  const rows = reportsToCheck()
    .map((r) => {
      const h = health[r.id] || null;
      const status = h ? statusOf(h, staleDays) : 'pendente';
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        clients: clients.filter((c) => c.active && c.reportIds.includes(r.id)).map((c) => c.name),
        status,
        dataDate: h?.dataDate || null,
        ageDays: h?.dataDate ? Math.floor((Date.now() - Date.parse(h.dataDate)) / DAY) : null,
        source: h?.source || null,
        lastAttempt: h?.lastAttempt || null,
        failure: h?.failure || h?.error || null,
        scheduleEnabled: h?.scheduleEnabled ?? null,
      };
    })
    .sort((a, b) => {
      const order = { falha: 0, erro: 1, desatualizado: 2, 'sem-info': 3, pendente: 4, ok: 5 };
      return order[a.status] - order[b.status] || (b.ageDays ?? -1) - (a.ageDays ?? -1) || a.name.localeCompare(b.name, 'pt-BR');
    });
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    settings: settings(),
    scan: scanState(),
    totals: { total: rows.length, ok: count('ok'), desatualizado: count('desatualizado'), falha: count('falha') + count('erro'), semInfo: count('sem-info') + count('pendente') },
    reports: rows,
    unassigned: reports.length - rows.length,
  };
}

// Selo para o cliente no portal: de quando são os dados e se estão em dia.
export function reportFreshness(reportId) {
  const s = settings();
  if (!s.showDataDate) return null;
  const h = (db().dataHealth || {})[reportId];
  if (!h?.dataDate) return null;
  return { dataDate: h.dataDate, stale: Date.now() - Date.parse(h.dataDate) > s.staleDays * DAY };
}

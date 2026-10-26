// Integração com a API REST do Power BI no modelo "app owns data":
// o servidor autentica como service principal e gera tokens de embed de curta duração.
import { ConfidentialClientApplication } from '@azure/msal-node';
import { config } from './config.js';

const API = 'https://api.powerbi.com/v1.0/myorg';
const SCOPE = 'https://analysis.windows.net/powerbi/api/.default';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPORT_CACHE_MS = 10 * 60 * 1000;

export class PowerBIError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const isGuid = (value) => typeof value === 'string' && GUID.test(value);

export function isConfigured() {
  const { tenantId, clientId, clientSecret } = config.powerbi;
  return Boolean(tenantId && clientId && clientSecret);
}

let msal;
function msalApp() {
  if (!isConfigured()) {
    throw new PowerBIError('Power BI não configurado: preencha PBI_TENANT_ID, PBI_CLIENT_ID e PBI_CLIENT_SECRET no .env.', 503);
  }
  msal ??= new ConfidentialClientApplication({
    auth: {
      clientId: config.powerbi.clientId,
      clientSecret: config.powerbi.clientSecret,
      authority: `https://login.microsoftonline.com/${config.powerbi.tenantId}`,
    },
  });
  return msal;
}

async function azureToken() {
  try {
    const result = await msalApp().acquireTokenByClientCredential({ scopes: [SCOPE] });
    if (!result?.accessToken) throw new Error('resposta sem token');
    return result.accessToken;
  } catch (err) {
    if (err instanceof PowerBIError) throw err;
    throw new PowerBIError(`Falha ao autenticar no Azure: ${err.errorMessage || err.message}`, 502);
  }
}

async function call(path, { method = 'GET', body } = {}) {
  const token = await azureToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new PowerBIError(describeError(res.status, text), res.status === 404 ? 404 : 502);
  }
  return res.status === 204 ? null : res.json();
}

function describeError(status, text) {
  let detail = '';
  try {
    const parsed = JSON.parse(text);
    detail = parsed?.error?.message || parsed?.error?.code || parsed?.message || '';
    // Erros de consulta DAX trazem a explicação útil em "pbi.error.details".
    const extra = (parsed?.error?.['pbi.error']?.details || []).map((d) => d?.detail?.value).filter(Boolean);
    if (extra.length) detail = `${detail} ${extra.join(' ')}`.trim();
  } catch {
    detail = text.slice(0, 200);
  }
  if (status === 401) return 'O Power BI recusou o service principal. Confira se ele está liberado nas configurações do locatário do Power BI.';
  if (status === 403) return 'O service principal não tem acesso a este workspace. Adicione-o como Membro ou Administrador do workspace.';
  if (status === 404) return 'Relatório ou workspace não encontrado. Confira os IDs cadastrados.';
  return `Erro do Power BI (${status})${detail ? `: ${detail}` : ''}`;
}

export async function listWorkspaceReports(workspaceId) {
  if (!isGuid(workspaceId)) throw new PowerBIError('ID de workspace inválido.', 400);
  const result = await call(`/groups/${workspaceId}/reports`);
  return (result?.value || []).map((r) => ({
    reportId: r.id,
    name: r.name,
    datasetId: r.datasetId || null,
    reportType: r.reportType || 'PowerBIReport',
  }));
}

const reportCache = new Map();

async function getReport(workspaceId, reportId) {
  const key = `${workspaceId}/${reportId}`;
  const cached = reportCache.get(key);
  if (cached && Date.now() - cached.at < REPORT_CACHE_MS) return cached.report;
  const report = await call(`/groups/${workspaceId}/reports/${reportId}`);
  reportCache.set(key, { at: Date.now(), report });
  return report;
}

// ---------- Exportação para PDF (API "Export To File") ----------

// Páginas do relatório, na ordem das abas: [{ name, displayName, order }].
export async function listReportPages(workspaceId, reportId) {
  if (!isGuid(workspaceId) || !isGuid(reportId)) throw new PowerBIError('IDs do relatório inválidos.', 400);
  const result = await call(`/groups/${workspaceId}/reports/${reportId}/pages`);
  return (result?.value || []).sort((a, b) => a.order - b.order).map((p) => ({ name: p.name, displayName: p.displayName, order: p.order }));
}

// Inicia a exportação. pageName: só aquela página (ou todas, se vazio); bookmarkState: filtros
// e segmentações que o usuário aplicou na tela; identity: RLS, igual ao embed; filter: filtro
// de relatório no formato da URL do Power BI (ex.: "Consulta1/fazenda eq 'X'"), aplicado a todas as páginas.
export async function startExport({ workspaceId, reportId, pageName, bookmarkState, identity, filter }) {
  if (!isGuid(workspaceId) || !isGuid(reportId)) throw new PowerBIError('IDs do relatório inválidos.', 400);
  const report = await getReport(workspaceId, reportId);
  const configuration = {};
  if (pageName) configuration.pages = [{ pageName }];
  if (bookmarkState) configuration.defaultBookmark = { state: bookmarkState };
  if (filter) configuration.reportLevelFilters = [{ filter }];
  if (identity) {
    configuration.identities = [{ username: identity.username, roles: identity.roles, datasets: [report.datasetId] }];
  }
  const result = await call(`/groups/${workspaceId}/reports/${reportId}/ExportTo`, {
    method: 'POST',
    body: { format: 'PDF', powerBIReportConfiguration: configuration },
  });
  return result.id;
}

// status: NotStarted | Running | Succeeded | Failed; percentComplete de 0 a 100.
export async function getExportStatus(workspaceId, reportId, exportId) {
  const result = await call(`/groups/${workspaceId}/reports/${reportId}/exports/${encodeURIComponent(exportId)}`);
  return { status: result.status, percentComplete: result.percentComplete || 0, error: result.error?.message || null };
}

// Devolve a resposta HTTP com o arquivo, para ser repassada ao navegador sem carregar tudo na memória.
export async function getExportFile(workspaceId, reportId, exportId) {
  const token = await azureToken();
  const res = await fetch(`${API}/groups/${workspaceId}/reports/${reportId}/exports/${encodeURIComponent(exportId)}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new PowerBIError(describeError(res.status, await res.text().catch(() => '')), 502);
  return res;
}

// Gera o PDF (do relatório inteiro ou de uma página) e devolve o arquivo (bot do WhatsApp, alertas CCV).
// Espera até 6 minutos, consultando o andamento a cada 3 segundos.
export async function exportPdfBuffer({ workspaceId, reportId, identity, pageName, filter }) {
  const exportId = await startExport({ workspaceId, reportId, identity, pageName, filter });
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const status = await getExportStatus(workspaceId, reportId, exportId);
    if (status.status === 'Succeeded') break;
    if (status.status === 'Failed') throw new PowerBIError(status.error || 'O Power BI não conseguiu gerar o PDF.', 502);
    if (Date.now() - started > 6 * 60 * 1000) throw new PowerBIError('O PDF demorou demais para ficar pronto.', 504);
  }
  const file = await getExportFile(workspaceId, reportId, exportId);
  return Buffer.from(await file.arrayBuffer());
}

// ---------- Saúde dos dados ----------

// Últimas tentativas de atualização do conjunto de dados (mais recente primeiro).
export async function datasetRefreshes(workspaceId, datasetId, top = 5) {
  const result = await call(`/groups/${workspaceId}/datasets/${datasetId}/refreshes?$top=${top}`);
  return result?.value || [];
}

// Agendamento de atualização (null quando o conjunto de dados não tem, ex.: DirectQuery).
export async function datasetSchedule(workspaceId, datasetId) {
  try {
    return await call(`/groups/${workspaceId}/datasets/${datasetId}/refreshSchedule`);
  } catch {
    return null;
  }
}

// ---------- Consultas DAX (perguntas sobre os dados) ----------

// Conjunto de dados (dataset) por trás de um relatório.
export async function reportDataset(workspaceId, reportId) {
  const report = await getReport(workspaceId, reportId);
  return { datasetId: report.datasetId || null, datasetWorkspaceId: report.datasetWorkspaceId || workspaceId };
}

// Executa uma consulta DAX somente leitura e devolve as linhas da primeira tabela.
export async function executeDax(workspaceId, datasetId, query) {
  if (!isGuid(workspaceId) || !isGuid(datasetId)) throw new PowerBIError('Conjunto de dados inválido.', 400);
  const result = await call(`/groups/${workspaceId}/datasets/${datasetId}/executeQueries`, {
    method: 'POST',
    body: { queries: [{ query }], serializerSettings: { includeNulls: true } },
  });
  const first = result?.results?.[0];
  if (first?.error) throw new PowerBIError(first.error.message || 'Erro na consulta.', 400);
  return first?.tables?.[0]?.rows || [];
}

const refreshCache = new Map();
const REFRESH_CACHE_MS = 5 * 60 * 1000;

// Data e hora da última atualização concluída do conjunto de dados, ou null quando não há histórico
// (ex.: DirectQuery) ou a consulta falha. Nunca impede o relatório de abrir.
async function getLastRefresh(workspaceId, datasetId) {
  if (!isGuid(workspaceId) || !isGuid(datasetId)) return null;
  const key = `${workspaceId}/${datasetId}`;
  const cached = refreshCache.get(key);
  if (cached && Date.now() - cached.at < REFRESH_CACHE_MS) return cached.value;
  let value = null;
  try {
    const result = await call(`/groups/${workspaceId}/datasets/${datasetId}/refreshes?$top=10`);
    const done = (result?.value || []).find((r) => r.status === 'Completed' && r.endTime);
    value = done?.endTime || null;
  } catch {
    value = null;
  }
  refreshCache.set(key, { at: Date.now(), value });
  return value;
}

// Última atualização concluída dos dados de um relatório (usada nos avisos automáticos).
export async function lastRefreshForReport(workspaceId, reportId) {
  const report = await getReport(workspaceId, reportId);
  return getLastRefresh(report.datasetWorkspaceId || workspaceId, report.datasetId);
}

// identity: { username, roles } para aplicar RLS (segurança em nível de linha), ou null.
export async function getEmbedConfig({ workspaceId, reportId, identity }) {
  if (!isGuid(workspaceId) || !isGuid(reportId)) {
    throw new PowerBIError('IDs do relatório inválidos. Confira o cadastro.', 400);
  }
  const report = await getReport(workspaceId, reportId);
  const body = { reports: [{ id: report.id }] };
  if (report.datasetId) body.datasets = [{ id: report.datasetId }];
  if (identity) {
    if (!report.datasetId) throw new PowerBIError('Este relatório não tem conjunto de dados para aplicar RLS.', 400);
    body.identities = [{ username: identity.username, roles: identity.roles, datasets: [report.datasetId] }];
  }
  const [token, lastRefresh] = await Promise.all([
    call('/GenerateToken', { method: 'POST', body }),
    getLastRefresh(report.datasetWorkspaceId || workspaceId, report.datasetId),
  ]);
  return {
    reportId: report.id,
    embedUrl: report.embedUrl,
    accessToken: token.token,
    expiration: token.expiration,
    lastRefresh,
  };
}

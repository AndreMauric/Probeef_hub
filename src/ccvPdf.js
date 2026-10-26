// PDF do relatório "Ferramenta CCV" anexado aos alertas/resumos que o admin envia (aba Alertas CCV).
//
// O relatório junta todas as fazendas e não tem RLS: o PDF sai SEMPRE com um filtro de relatório na
// fazenda do alerta (reportLevelFilters da API ExportTo, vale para todas as páginas), e a fazenda
// precisa existir no modelo. Gerar leva de 30 s a 1 min, então vira um "pedido" que o navegador
// acompanha; o arquivo fica na memória por 1 hora. Ao enviar pelo portal, o PDF é gravado na pasta
// "files" ao lado do db.json e vira anexo da mensagem (ver chat.js).
import { AccessError } from './access.js';
import { listFarms } from './ccv.js';
import { exportPdfBuffer, listReportPages } from './powerbi.js';
import { newId } from './store.js';

const JOB_TTL_MS = 60 * 60 * 1000;
const PAGES_CACHE_MS = 30 * 60 * 1000;
const MAX_RUNNING = 2;

const jobs = new Map();
const pagesCache = new Map();

// Filtro na sintaxe de URL do Power BI: aspas simples são dobradas.
const farmFilter = (farm) => `Consulta1/fazenda eq '${farm.replace(/'/g, "''")}'`;

// Nome do arquivo sem acentos (vai em cabeçalho HTTP e no WhatsApp).
const safeName = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9 .-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80);

function sweep() {
  for (const [id, job] of jobs) if (Date.now() - job.createdAt > JOB_TTL_MS) jobs.delete(id);
}

export async function ccvPages(report) {
  const hit = pagesCache.get(report.id);
  if (hit && Date.now() - hit.at < PAGES_CACHE_MS) return hit.pages;
  const pages = await listReportPages(report.workspaceId, report.reportId);
  pagesCache.set(report.id, { at: Date.now(), pages });
  return pages;
}

// O que o navegador vê de um pedido (sem o arquivo).
export const publicJob = (job) => ({
  id: job.id,
  status: job.status,
  farm: job.farm,
  page: job.page,
  fileName: job.fileName,
  size: job.buffer?.length || null,
  error: job.error,
  createdAt: new Date(job.createdAt).toISOString(),
});

export async function startCcvPdf(report, farm, pageName) {
  sweep();
  if (!(await listFarms(report)).some((f) => f.name === farm)) throw new AccessError('Fazenda não encontrada no modelo do CCV.', 404);
  const page = (await ccvPages(report)).find((p) => p.name === pageName);
  if (!page) throw new AccessError('Página do relatório não encontrada.', 404);
  // Mesmo pedido feito há pouco (ainda gerando ou pronto há menos de 10 min): reaproveita.
  for (const job of jobs.values()) {
    const fresh = job.status === 'running' || (job.status === 'ready' && Date.now() - job.createdAt < 10 * 60 * 1000);
    if (job.reportId === report.id && job.farm === farm && job.pageName === pageName && fresh) return job;
  }
  if ([...jobs.values()].filter((j) => j.status === 'running').length >= MAX_RUNNING) {
    throw new AccessError('Já há PDFs sendo gerados. Aguarde um pouco e tente de novo.', 429);
  }
  const day = new Date().toISOString().slice(0, 10);
  const job = {
    id: newId(),
    reportId: report.id,
    farm,
    pageName,
    page: page.displayName,
    fileName: `${safeName(`CCV ${farm} ${page.displayName} ${day}`)}.pdf`,
    status: 'running',
    error: null,
    buffer: null,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  exportPdfBuffer({ workspaceId: report.workspaceId, reportId: report.reportId, pageName, filter: farmFilter(farm) })
    .then((buffer) => {
      job.buffer = buffer;
      job.status = 'ready';
    })
    .catch((err) => {
      console.error(`PDF do CCV (${farm}) falhou:`, err.message);
      job.status = 'failed';
      job.error = err.message;
    });
  return job;
}

export function ccvPdfJob(id) {
  sweep();
  const job = jobs.get(id);
  if (!job) throw new AccessError('PDF expirado. Gere de novo.', 404);
  return job;
}

// Ferramenta CCV (leitura de cocho): painel nativo do portal, lido direto do modelo semântico
// "Ferramenta CCV" no Power BI via consultas DAX, em vez do relatório incorporado.
//
// O modelo junta TODAS as fazendas numa tabela só e não tem RLS. Por isso quem decide o que cada
// pessoa vê é o portal: o admin escolhe as fazendas de cada cliente (client.ccvFarms) e, se quiser,
// restringe por usuário (user.ccvFarms). Toda consulta filtra pela fazenda no servidor, e a fazenda
// pedida precisa estar na lista liberada (falha fechada). O relatório incorporado do CCV nunca é
// aberto/exportado para clientes (ver access.js), porque mostraria as outras fazendas.
//
// As medidas usadas aqui são as do próprio modelo (mesmos números do relatório no Power BI). O
// filtro de período do relatório age na coluna Consulta1[data], que guarda data E hora.
import { AccessError } from './access.js';
import { userClients } from './auth.js';
import { executeDax, reportDataset } from './powerbi.js';
import { db } from './store.js';

const DAY = 24 * 60 * 60 * 1000;
const CACHE_MS = 5 * 60 * 1000;
const FARMS_CACHE_MS = 60 * 60 * 1000;

// ---------- Consultas ----------

// Texto dentro de "..." no DAX: aspas são dobradas; limita o tamanho para não aceitar lixo.
const str = (value) => `"${String(value).slice(0, 120).replace(/"/g, '""')}"`;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const daxDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `DATE(${y}, ${m}, ${d})`;
};
export const isoDay = (date) => new Date(date).toISOString().slice(0, 10);
const addDays = (iso, n) => isoDay(Date.parse(`${iso}T00:00:00Z`) + n * DAY);

const cache = new Map();

async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return value;
}

export function clearCcvCache() {
  cache.clear();
}

async function datasetOf(report) {
  return cached(`ds:${report.id}`, FARMS_CACHE_MS, async () => {
    const { datasetId, datasetWorkspaceId } = await reportDataset(report.workspaceId, report.reportId);
    if (!datasetId) throw new AccessError('O relatório CCV não tem conjunto de dados consultável.', 502);
    return { workspaceId: datasetWorkspaceId, datasetId };
  });
}

async function run(report, query) {
  const ds = await datasetOf(report);
  return executeDax(ds.workspaceId, ds.datasetId, query);
}

// O executeQueries devolve as colunas como "Tabela[coluna]" ou "[nome]"; aqui viram só "nome".
const plain = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/^.*\[|\]$/g, ''), v])));

// Filtros do painel como variáveis DAX: fazenda e período sempre; curral e lote quando escolhidos.
function filterVars({ farm, from, to, curral, lote }) {
  const vars = [
    `VAR __farm = TREATAS({${str(farm)}}, Consulta1[fazenda])`,
    `VAR __period = FILTER(ALL(Consulta1[data]), Consulta1[data] >= ${daxDate(from)} && Consulta1[data] < ${daxDate(addDays(to, 1))})`,
  ];
  const names = ['__farm', '__period'];
  if (curral) {
    vars.push(`VAR __curral = TREATAS({${str(curral)}}, Consulta1[curral])`);
    names.push('__curral');
  }
  if (lote) {
    vars.push(`VAR __lote = TREATAS({${str(lote)}}, Consulta1[lote])`);
    names.push('__lote');
  }
  return { define: `DEFINE\n${vars.join('\n')}`, filters: names.join(', ') };
}

// Fazendas do modelo, com a data da última leitura de cada uma.
export function listFarms(report) {
  return cached(`farms:${report.id}`, FARMS_CACHE_MS, async () => {
    const rows = plain(await run(report, 'EVALUATE SUMMARIZECOLUMNS(Consulta1[fazenda], "first", MIN(Consulta1[data]), "last", MAX(Consulta1[data]))'));
    return rows
      .filter((r) => r.fazenda)
      .map((r) => ({ name: r.fazenda, first: r.first ? isoDay(r.first) : null, last: r.last ? isoDay(r.last) : null }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  });
}

// ---------- Quem vê quais fazendas ----------

// Fazendas que o usuário pode ver no relatório CCV, no contexto de um cliente.
// Admin vê todas. Cliente: as fazendas do cliente; se o usuário tiver uma lista própria, só a interseção.
export async function allowedFarms(user, report, clientId) {
  const all = await listFarms(report);
  if (user.role === 'admin') return all;
  const client = userClients(user).find((c) => c.id === clientId && c.reportIds.includes(report.id));
  if (!client) return [];
  const own = new Set(client.ccvFarms || []);
  const personal = user.ccvFarms?.length ? new Set(user.ccvFarms) : null;
  return all.filter((f) => own.has(f.name) && (!personal || personal.has(f.name)));
}

// Valida os parâmetros do painel. A fazenda tem que estar na lista liberada; datas em AAAA-MM-DD.
export function readFilters(query, farms) {
  const farm = farms.find((f) => f.name === query.farm) || null;
  if (!farm) throw new AccessError('Fazenda não encontrada ou sem permissão.', 403);
  const to = ISO_DAY.test(query.to || '') ? query.to : farm.last || isoDay(Date.now());
  const from = ISO_DAY.test(query.from || '') ? query.from : addDays(to, -27);
  if (from > to) throw new AccessError('A data inicial é depois da final.', 400);
  if (Date.parse(to) - Date.parse(from) > 366 * DAY) throw new AccessError('Escolha um período de até 1 ano.', 400);
  const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : null);
  return { farm: farm.name, from, to, curral: clean(query.curral), lote: clean(query.lote) };
}

// ---------- Painel ----------

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const STATUS_ORDER = { 'Crítico': 0, 'Atenção': 1, 'Não conforme': 1, 'Conforme': 2 };

async function cardsQuery(report, f) {
  const { define, filters } = filterVars(f);
  const [row] = plain(
    await run(
      report,
      `${define}
EVALUATE CALCULATETABLE(ROW(
  "rebanho", [Rebanho Médio], "ibc", [IBC Médio], "ibcVar", [IBC Var pts],
  "inconsistencias", [Total Inconsistências], "inconsistenciasVar", [Inconsistências Var %], "alertas", [Qtd Alertas], "criticas", [Qtd Críticas],
  "conformidade", [Conformidade %], "conformidadeVar", [Conformidade Var pts],
  "curraisAbaixo", [Currais Abaixo Meta], "curraisAbaixoTexto", [Texto Currais Abaixo Meta], "metaIbc", [Meta IBC],
  "lotesConforme", [Lotes Conforme], "lotesAtencao", [Lotes Atenção], "lotesNaoConforme", [Lotes Não Conforme],
  "ultimaLeitura", MAX(Consulta1[data])
), ${filters})`,
    ),
  );
  return {
    ...Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [k, typeof v === 'string' ? v : num(v)])),
    ultimaLeitura: row?.ultimaLeitura || null,
  };
}

// Distribuição das leituras por farol (Crítico, Alerta, Observação, Normal) em cada lote ativo.
async function inconsistenciaQuery(report, f) {
  const { define, filters } = filterVars(f);
  const rows = plain(
    await run(report, `${define}\nEVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Consulta1[lote], Consulta1[Farol Legenda], "n", [Leituras Farol]), ${filters}, Consulta1[lote_ativo] = TRUE())`),
  );
  const byLote = new Map();
  for (const r of rows) {
    if (!r.lote || !r.n) continue;
    if (!byLote.has(r.lote)) byLote.set(r.lote, { lote: r.lote, Crítico: 0, Alerta: 0, Observação: 0, Normal: 0, total: 0 });
    const item = byLote.get(r.lote);
    if (r['Farol Legenda'] in item) item[r['Farol Legenda']] += r.n;
    item.total += r.n;
  }
  const pct = (item, key) => (item.total ? item[key] / item.total : 0);
  return [...byLote.values()].sort((a, b) => pct(b, 'Crítico') - pct(a, 'Crítico') || pct(b, 'Alerta') - pct(a, 'Alerta') || a.lote.localeCompare(b.lote));
}

async function ibcDiaQuery(report, f) {
  const { define, filters } = filterVars(f);
  const rows = plain(
    await run(report, `${define}\nEVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Consulta1[dia_semana_num], Consulta1[Dia Semana Curto], "media", [Média IBC], "ultimaSemana", [IBC Última Semana]), ${filters})`),
  );
  return rows
    .map((r) => ({ ordem: r.dia_semana_num, dia: r['Dia Semana Curto'], media: num(r.media), ultimaSemana: num(r.ultimaSemana) }))
    .sort((a, b) => a.ordem - b.ordem);
}

// Conformidade da leitura por dia (a matriz do relatório).
async function conformidadeQuery(report, f) {
  const { define, filters } = filterVars(f);
  const rows = plain(
    await run(
      report,
      `${define}\nEVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Consulta1[dia], "faixa", [Faixa Sobra (detalhe)], "leitura", [Leitura (detalhe)], "decisao", [Decisão (detalhe)], "status", [Status Matriz]), ${filters})`,
    ),
  );
  return rows
    .filter((r) => r.dia)
    .map((r) => ({ dia: isoDay(r.dia), faixa: r.faixa || '', leitura: r.leitura || '', decisao: typeof r.decisao === 'string' ? r.decisao : '', status: r.status || '' }))
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.dia.localeCompare(b.dia));
}

// Lotes ativos com maior proporção de leituras críticas (mesma ordem do "Alerta prioritário" do relatório).
async function alertasQuery(report, f, top = 5) {
  const { define, filters } = filterVars(f);
  const rows = plain(
    await run(
      report,
      `${define}
VAR __lotes = CALCULATETABLE(SUMMARIZECOLUMNS(Consulta1[lote],
  "nivel", [Alerta Nível], "resumo", [Alerta Resumo], "leituras", [Leituras Farol],
  "criticas", CALCULATE([Leituras Farol], Consulta1[Farol Legenda] = "Crítico"),
  "ultimaCritica", CALCULATE(MAX(Consulta1[data]), Consulta1[Farol Legenda] = "Crítico"),
  "ibc", [Média IBC], "curral", [Curral Atual]), ${filters}, Consulta1[lote_ativo] = TRUE())
EVALUATE TOPN(${Number(top)}, FILTER(__lotes, [criticas] > 0), DIVIDE([criticas], [leituras]), DESC, [criticas], DESC, Consulta1[lote], ASC)`,
    ),
  );
  return rows
    .map((r) => ({
      lote: r.lote,
      curral: r.curral || '',
      ibc: num(r.ibc),
      criticas: num(r.criticas) || 0,
      leituras: num(r.leituras) || 0,
      nivel: (String(r.nivel || '').match(/●/g) || []).length,
      resumo: r.resumo || '',
      ultimaCritica: r.ultimaCritica ? isoDay(r.ultimaCritica) : null,
    }))
    .sort((a, b) => b.criticas / (b.leituras || 1) - a.criticas / (a.leituras || 1) || b.criticas - a.criticas || a.lote.localeCompare(b.lote, 'pt-BR', { numeric: true }));
}

// Currais e lotes da fazenda no período (para os filtros do painel).
async function opcoesQuery(report, f) {
  const { define, filters } = filterVars({ ...f, curral: null, lote: null });
  const rows = plain(await run(report, `${define}\nEVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Consulta1[curral], Consulta1[lote]), ${filters})`));
  const sort = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  return { currais: sort(rows.map((r) => r.curral)), lotes: sort(rows.map((r) => r.lote)) };
}

export function painel(report, f) {
  const key = `painel:${report.id}:${JSON.stringify(f)}`;
  return cached(key, CACHE_MS, async () => {
    const [cards, inconsistencia, ibcDia, conformidade, alertas, opcoes] = await Promise.all([
      cardsQuery(report, f),
      inconsistenciaQuery(report, f),
      ibcDiaQuery(report, f),
      conformidadeQuery(report, f),
      alertasQuery(report, f),
      opcoesQuery(report, f),
    ]);
    return { filters: f, cards, inconsistencia, ibcDia, conformidade, alertas, opcoes, geradoEm: new Date().toISOString() };
  });
}

// Currais de um dia da matriz de conformidade (o "+" ao lado do dia).
export function diaDetalhe(report, f, dia) {
  if (!ISO_DAY.test(dia || '')) throw new AccessError('Dia inválido.', 400);
  return cached(`dia:${report.id}:${JSON.stringify(f)}:${dia}`, CACHE_MS, async () => {
    const { define, filters } = filterVars({ ...f, from: dia, to: dia });
    const rows = plain(
      await run(
        report,
        `${define}\nEVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Consulta1[curral], "lote", MAX(Consulta1[lote]), "faixa", [Faixa Sobra (detalhe)], "leitura", [Leitura (detalhe)], "decisao", MAX(Consulta1[decisao_tipo]), "status", [Status Matriz], "diasCocho", [Dias Cocho / Animais]), ${filters})`,
      ),
    );
    return rows
      .filter((r) => r.curral)
      .map((r) => ({ curral: r.curral, lote: r.lote || '', faixa: r.faixa || '', leitura: r.leitura || '', decisao: r.decisao || '', status: r.status || '', diasCocho: r.diasCocho || '' }))
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.curral.localeCompare(b.curral, 'pt-BR', { numeric: true }));
  });
}

// ---------- Alertas para o admin (todas as fazendas ligadas a clientes) ----------

// Regras: a semana mais recente (7 dias até a última leitura do modelo) contra a semana anterior.
// Os limites ficam aqui em cima para ajustar fácil.
export const RULES = {
  days: 7,
  staleDays: 2, // sem leitura nova há mais que isso → dados parados
  conformidadeBaixa: 0.3, // abaixo → prioridade alta
  conformidadeQueda: 0.1, // queda de 10 pontos ou mais → atenção
  ibcBaixo: 8, // IBC médio abaixo → prioridade alta
  ibcQueda: 0.3, // queda de 0,3 ou mais → atenção
  inconsistenciasAlta: 0.25, // aumento de 25% ou mais (e pelo menos 20 a mais) → atenção
  semLeituraAtencao: 0.3, // mais de 30% dos currais sem leitura → atenção
  lotesCriticos: 3, // lotes com 3+ leituras críticas na semana entram na lista
};

const pct = (v) => `${Math.round(v * 100)}%`;
const dec1 = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// Indicadores da semana de todas as fazendas numa consulta só (é a mais pesada: ~8 s, fica em cache).
async function semanaFazendas(report, from, to) {
  return cached(`semana:${report.id}:${from}:${to}`, 30 * 60 * 1000, async () => {
    const period = `FILTER(ALL(Consulta1[data]), Consulta1[data] >= ${daxDate(from)} && Consulta1[data] < ${daxDate(addDays(to, 1))})`;
    const [kpis, lotes] = await Promise.all([
      run(
        report,
        `EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Consulta1[fazenda],
  "rebanho", [Rebanho Médio], "ibc", [IBC Médio], "ibcAnt", [IBC Anterior],
  "inconsistencias", [Total Inconsistências], "inconsistenciasAnt", [Total Inconsistências Anterior], "criticas", [Qtd Críticas],
  "conformidade", [Conformidade %], "conformidadeAnt", [Conformidade % Anterior], "semLeitura", [% Currais sem Leitura],
  "curraisAbaixo", [Currais Abaixo Meta], "lotes", [Nº Lotes]), ${period})`,
      ),
      run(
        report,
        `DEFINE VAR __lotes = CALCULATETABLE(SUMMARIZECOLUMNS(Consulta1[fazenda], Consulta1[lote],
  "pontuacao", [Alerta Pontuação], "resumo", [Alerta Resumo], "curral", [Curral Atual],
  "criticas", CALCULATE([Leituras Farol], Consulta1[Farol Legenda] = "Crítico")), ${period}, Consulta1[lote_ativo] = TRUE())
EVALUATE FILTER(__lotes, [criticas] >= ${RULES.lotesCriticos})`,
      ),
    ]);
    return { kpis: plain(kpis), lotes: plain(lotes) };
  });
}

// Uma entrada por fazenda ligada a algum cliente, com os sinais encontrados e a gravidade geral.
export async function computeCcvAlerts(report, { refresh = false } = {}) {
  if (refresh) clearCcvCache();
  const farms = await listFarms(report);
  const end = farms.reduce((max, f) => (f.last && f.last > max ? f.last : max), '');
  if (!end) return { report: { id: report.id, name: report.name }, period: null, farms: [], unlinked: [] };
  const from = addDays(end, -(RULES.days - 1));
  const { kpis, lotes } = await semanaFazendas(report, from, end);
  const { clients, users } = db();

  const linked = new Map();
  for (const c of clients.filter((c) => c.active !== false && c.reportIds.includes(report.id))) {
    for (const name of c.ccvFarms || []) {
      if (!linked.has(name)) linked.set(name, []);
      linked.get(name).push(c);
    }
  }

  const out = [];
  for (const farm of farms) {
    const owners = linked.get(farm.name);
    if (!owners) continue;
    const k = kpis.find((r) => r.fazenda === farm.name) || {};
    const signals = [];
    const add = (type, severity, text) => signals.push({ type, severity, text });

    const stale = farm.last ? Math.floor((Date.parse(end) - Date.parse(farm.last)) / DAY) : null;
    if (stale === null || stale > RULES.staleDays) add('parado', 'alta', farm.last ? `Sem leituras novas desde ${fmtDay(farm.last)} (${stale} dias).` : 'Nenhuma leitura no modelo.');

    // Fazendas que não fazem leitura de sobra (todos os currais sem leitura) não geram alertas de conformidade.
    const fazLeitura = num(k.semLeitura) !== null && k.semLeitura < 0.9 && num(k.conformidade) !== null;
    if (fazLeitura) {
      if (k.conformidade < RULES.conformidadeBaixa) add('conformidade', 'alta', `Conformidade de leitura em ${pct(k.conformidade)}${num(k.conformidadeAnt) !== null ? ` (semana anterior: ${pct(k.conformidadeAnt)})` : ''}.`);
      else if (num(k.conformidadeAnt) !== null && k.conformidadeAnt - k.conformidade >= RULES.conformidadeQueda) add('conformidade', 'media', `Conformidade caiu de ${pct(k.conformidadeAnt)} para ${pct(k.conformidade)}.`);
      if (k.semLeitura > RULES.semLeituraAtencao) add('cobertura', 'media', `${pct(k.semLeitura)} dos currais ficaram sem leitura na semana.`);
      const inc = num(k.inconsistencias) || 0;
      const incAnt = num(k.inconsistenciasAnt);
      if (incAnt && inc - incAnt >= 20 && inc / incAnt - 1 >= RULES.inconsistenciasAlta) add('inconsistencias', 'media', `Inconsistências de ajuste subiram ${pct(inc / incAnt - 1)} (${incAnt} → ${inc}).`);
    }
    if (num(k.ibc) !== null) {
      if (k.ibc < RULES.ibcBaixo) add('ibc', 'alta', `IBC médio de ${dec1(k.ibc)} na semana${num(k.ibcAnt) !== null ? ` (anterior: ${dec1(k.ibcAnt)})` : ''}.`);
      else if (num(k.ibcAnt) !== null && k.ibcAnt - k.ibc >= RULES.ibcQueda) add('ibc', 'media', `IBC médio caiu de ${dec1(k.ibcAnt)} para ${dec1(k.ibc)}.`);
    }
    const lotesFazenda = lotes
      .filter((l) => l.fazenda === farm.name)
      .sort((a, b) => b.criticas - a.criticas || (b.pontuacao ?? 0) - (a.pontuacao ?? 0))
      .map((l) => ({ lote: l.lote, curral: l.curral || '', criticas: l.criticas, resumo: l.resumo || '' }));
    if (lotesFazenda.length) add('lotes', lotesFazenda.length >= 10 ? 'alta' : 'media', `${lotesFazenda.length} ${lotesFazenda.length === 1 ? 'lote' : 'lotes'} com ${RULES.lotesCriticos}+ leituras críticas na semana.`);

    const severity = signals.some((s) => s.severity === 'alta') ? 'alta' : signals.length ? 'media' : 'ok';
    const clientIds = owners.map((c) => c.id);
    const recipients = users
      .filter((u) => u.active && u.role === 'client' && !u.bmkOnly && u.clientIds.some((id) => clientIds.includes(id)))
      .filter((u) => !u.ccvFarms?.length || u.ccvFarms.includes(farm.name))
      .map((u) => ({ id: u.id, name: u.name, phone: u.phone || null }));
    out.push({
      key: `${farm.name}|${end}`,
      farm: farm.name,
      clients: owners.map((c) => ({ id: c.id, name: c.name })),
      lastReading: farm.last,
      severity,
      signals,
      lotes: lotesFazenda.slice(0, 10),
      kpis: {
        rebanho: num(k.rebanho),
        ibc: num(k.ibc),
        ibcAnt: num(k.ibcAnt),
        conformidade: fazLeitura ? k.conformidade : null,
        conformidadeAnt: fazLeitura ? num(k.conformidadeAnt) : null,
        inconsistencias: num(k.inconsistencias),
        inconsistenciasAnt: num(k.inconsistenciasAnt),
        semLeitura: num(k.semLeitura),
        curraisAbaixo: num(k.curraisAbaixo),
      },
      recipients,
    });
  }
  const order = { alta: 0, media: 1, ok: 2 };
  out.sort((a, b) => order[a.severity] - order[b.severity] || a.farm.localeCompare(b.farm, 'pt-BR'));
  return {
    report: { id: report.id, name: report.name },
    period: { from, to: end },
    farms: out,
    unlinked: farms.filter((f) => !linked.has(f.name)).map((f) => f.name),
  };
}

// ---------- Uso da ferramenta por fazenda (aba Alertas CCV → Uso da ferramenta) ----------

// O que cada fazenda realmente faz no CCV, com números: voo (drone), leitura da manhã, decisão de
// trato e leitura noturna, por dia, nos últimos USAGE_DAYS dias. No modelo:
// - leitura_manha: "crumb" | "dry" | "inventory" quando lida, vazio quando não;
// - decisao_tipo: "Aumentou" | "Manteve" | "Reduziu"; "Sem decisão" quando não decidiu;
// - primeira/segunda/terceira_leitura (noturnas): "True" (com comida) | "False" (cocho vazio), vazio
//   quando não lida. O aplicativo grava "True" por padrão: fazenda que nunca registra cocho vazio
//   em 7 dias provavelmente não faz a leitura noturna de verdade (ex.: Roncador, out/2026).
export const USAGE_DAYS = 7;
// etapa "em uso": feita em 70% dos dias de voo, cobrindo metade dos currais. ibcMeta = [Meta IBC] do modelo.
const USAGE = { emUso: 0.7, cobertura: 0.5, paradoDias: 3, ibcMeta: 9.5 };

export function ccvUsage(report, { refresh = false } = {}) {
  return cached(`uso:${report.id}`, refresh ? 0 : 30 * 60 * 1000, async () => {
    const farms = await listFarms(report);
    const end = farms.reduce((max, f) => (f.last && f.last > max ? f.last : max), '');
    if (!end) return { period: null, farms: [] };
    const from = addDays(end, -(USAGE_DAYS - 1));
    const rows = plain(
      await run(
        report,
        `DEFINE VAR __period = FILTER(ALL(Consulta1[data]), Consulta1[data] >= ${daxDate(from)} && Consulta1[data] < ${daxDate(addDays(end, 1))})
EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(Consulta1[fazenda], Consulta1[dia],
  "ultimo", MAX(Consulta1[data]),
  "currais", DISTINCTCOUNT(Consulta1[curral]),
  "manha", CALCULATE(DISTINCTCOUNT(Consulta1[curral]), Consulta1[leitura_manha] IN {"crumb", "dry", "inventory"}),
  "dec", CALCULATE(DISTINCTCOUNT(Consulta1[curral]), Consulta1[decisao_tipo] IN {"Aumentou", "Manteve", "Reduziu"}),
  "up", CALCULATE(COUNTROWS(Consulta1), Consulta1[decisao_tipo] = "Aumentou"),
  "eq", CALCULATE(COUNTROWS(Consulta1), Consulta1[decisao_tipo] = "Manteve"),
  "down", CALCULATE(COUNTROWS(Consulta1), Consulta1[decisao_tipo] = "Reduziu"),
  "noite", CALCULATE(DISTINCTCOUNT(Consulta1[curral]), Consulta1[primeira_leitura] IN {"True", "False"} || Consulta1[segunda_leitura] IN {"True", "False"} || Consulta1[terceira_leitura] IN {"True", "False"}),
  "vazio", CALCULATE(DISTINCTCOUNT(Consulta1[curral]), Consulta1[primeira_leitura] = "False" || Consulta1[segunda_leitura] = "False" || Consulta1[terceira_leitura] = "False"),
  "ibcSum", SUM(Consulta1[metricas.ibc]),
  "ibcN", COUNT(Consulta1[metricas.ibc]),
  "ibcCurrais", CALCULATE(DISTINCTCOUNT(Consulta1[curral]), NOT ISBLANK(Consulta1[metricas.ibc])),
  "ibcAbaixo", CALCULATE(DISTINCTCOUNT(Consulta1[curral]), NOT ISBLANK(Consulta1[metricas.ibc]) && Consulta1[metricas.ibc] < ${USAGE.ibcMeta})), __period)`,
      ),
    );
    const linked = new Map();
    for (const c of db().clients.filter((c) => c.reportIds.includes(report.id))) for (const f of c.ccvFarms || []) linked.set(f, [...(linked.get(f) || []), c.name]);

    const byFarm = new Map();
    for (const r of rows) {
      if (!r.fazenda || !r.dia) continue;
      if (!byFarm.has(r.fazenda)) byFarm.set(r.fazenda, []);
      byFarm.get(r.fazenda).push({ dia: isoDay(r.dia), ultimo: r.ultimo, currais: r.currais || 0, manha: r.manha || 0, dec: r.dec || 0, up: r.up || 0, eq: r.eq || 0, down: r.down || 0, noite: r.noite || 0, vazio: r.vazio || 0, ibcSum: r.ibcSum || 0, ibcN: r.ibcN || 0, ibcCurrais: r.ibcCurrais || 0, ibcAbaixo: r.ibcAbaixo || 0 });
    }

    const out = farms.map((farm) => {
      const days = (byFarm.get(farm.name) || []).sort((a, b) => a.dia.localeCompare(b.dia));
      const flights = days.filter((d) => d.currais > 0);
      const lastFlight = flights.at(-1) || null;
      const daysSince = farm.last ? Math.round((Date.parse(end) - Date.parse(farm.last)) / DAY) : null;
      const step = (key) => {
        const done = days.filter((d) => d[key] > 0);
        const last = done.at(-1) || null;
        // Dia "feito" quando cobre pelo menos metade dos currais sobrevoados naquele dia.
        const covered = done.filter((d) => d[key] / Math.max(1, d.currais) >= USAGE.cobertura).length;
        return {
          lastDay: last?.dia || null,
          currais: last ? last[key] : 0,
          total: last ? last.currais : 0,
          dias: done.length,
          diasVoo: flights.length,
          emUso: flights.length > 0 && covered / flights.length >= USAGE.emUso,
        };
      };
      const manha = step('manha');
      const decisao = step('dec');
      const noturna = step('noite');
      const lastDec = days.filter((d) => d.dec > 0).at(-1);
      decisao.mix = lastDec ? { up: lastDec.up, eq: lastDec.eq, down: lastDec.down } : null;
      const totDec = days.reduce((s, d) => s + d.up + d.eq + d.down, 0);
      decisao.pctManteve = totDec ? days.reduce((s, d) => s + d.eq, 0) / totDec : null;
      decisao.suspeita = totDec >= 20 && decisao.pctManteve === 1; // só "Manteve": pode ser o valor padrão
      const totNoite = days.reduce((s, d) => s + d.noite, 0);
      noturna.pctVazio = totNoite ? days.reduce((s, d) => s + d.vazio, 0) / totNoite : null;
      noturna.lastVazio = days.filter((d) => d.noite > 0).at(-1)?.vazio ?? null;
      // Nunca registrou cocho vazio em 7 dias: o "True" é o padrão do aplicativo, não leitura feita.
      noturna.suspeita = totNoite >= 20 && noturna.pctVazio === 0;
      if (noturna.suspeita) noturna.emUso = false;

      // IBC (vem do voo, mas nem todo dia): último dia com IBC, o anterior (tendência) e a média dos 7 dias.
      const ibcDays = days.filter((d) => d.ibcN > 0);
      const lastIbc = ibcDays.at(-1);
      const prevIbc = ibcDays.at(-2);
      const ibcN = ibcDays.reduce((s, d) => s + d.ibcN, 0);
      const ibc = lastIbc
        ? {
            lastDay: lastIbc.dia,
            valor: lastIbc.ibcSum / lastIbc.ibcN,
            anterior: prevIbc ? prevIbc.ibcSum / prevIbc.ibcN : null,
            media: ibcDays.reduce((s, d) => s + d.ibcSum, 0) / ibcN,
            currais: lastIbc.ibcCurrais,
            abaixo: lastIbc.ibcAbaixo,
            total: lastIbc.currais,
            dias: ibcDays.length,
            diasVoo: flights.length,
          }
        : null;

      const etapas = [manha.emUso, decisao.emUso, noturna.emUso].filter(Boolean).length;
      const algum = [manha, decisao, noturna].some((s) => s.dias > 0 && !(s === noturna && noturna.suspeita));
      const nivel = daysSince === null || daysSince > USAGE.paradoDias ? 'parado' : etapas === 3 ? 'completo' : etapas > 0 ? 'parcial' : algum ? 'baixo' : 'so_voo';
      return {
        farm: farm.name,
        clients: linked.get(farm.name) || [],
        lastFlight: lastFlight?.ultimo || (farm.last ? `${farm.last}T00:00:00` : null),
        lastFlightDay: farm.last,
        curraisVoo: lastFlight?.currais || 0,
        diasVoo: flights.length,
        daysSince,
        manha,
        decisao,
        noturna,
        ibc,
        nivel,
      };
    });
    const order = { completo: 0, parcial: 1, baixo: 2, so_voo: 3, parado: 4 };
    out.sort((a, b) => order[a.nivel] - order[b.nivel] || a.farm.localeCompare(b.farm, 'pt-BR'));
    return { period: { from, to: end, days: USAGE_DAYS }, rules: USAGE, farms: out, checkedAt: new Date().toISOString() };
  });
}

// Textos prontos para o admin revisar antes de enviar. "alerta": só os sinais; "relatorio": resumo da semana.
export function messageFor(entry, kind, { link } = {}) {
  const period = `${fmtDay(entry.periodFrom)} a ${fmtDay(entry.periodTo)}`;
  const k = entry.kpis;
  if (kind === 'alerta') {
    const lines = [`⚠️ *Alerta CCV · ${entry.farm}*`, `Semana de ${period}`, '', ...entry.signals.map((s) => `• ${s.text}`)];
    if (entry.lotes.length) lines.push('', '*Lotes para olhar primeiro:*', ...entry.lotes.slice(0, 5).map((l) => `• Lote ${l.lote}${l.curral ? ` (${l.curral})` : ''}: ${l.resumo || `${l.criticas} críticas`}`));
    if (link) lines.push('', `Ver no painel: ${link}`);
    return lines.join('\n');
  }
  const delta = (cur, ant, fmt) => (cur === null ? '—' : `${fmt(cur)}${ant !== null && ant !== undefined ? ` (antes ${fmt(ant)})` : ''}`);
  const lines = [
    `📊 *Resumo CCV · ${entry.farm}*`,
    `Semana de ${period}`,
    '',
    k.rebanho !== null ? `• Rebanho médio: ${Math.round(k.rebanho).toLocaleString('pt-BR')} cabeças` : null,
    `• IBC médio: ${delta(k.ibc, k.ibcAnt, dec1)}`,
    k.conformidade !== null ? `• Conformidade de leitura: ${delta(k.conformidade, k.conformidadeAnt, pct)}` : null,
    k.inconsistencias !== null ? `• Inconsistências de ajuste: ${delta(k.inconsistencias, k.inconsistenciasAnt, (v) => String(v))}` : null,
    k.curraisAbaixo !== null ? `• Currais abaixo da meta de IBC: ${k.curraisAbaixo}` : null,
  ].filter((l) => l !== null);
  if (entry.signals.length) lines.push('', '*Pontos de atenção:*', ...entry.signals.map((s) => `• ${s.text}`));
  if (link) lines.push('', `Painel completo: ${link}`);
  return lines.join('\n');
}

// Uma linha só (modelos de mensagem do WhatsApp não aceitam quebra de linha nos parâmetros).
export function oneLine(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/\*/g, '').trim())
    .filter(Boolean)
    .slice(1)
    .join(' · ')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 900);
}

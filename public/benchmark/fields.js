// Benchmarking Confinamento Probeef: campos, validações, questionário e resultado.
// Tradução da planilha "Benchmarking Confinamento Probeef 2026 Feed Manager.xlsb": abas
// BD_Zootec_Feed / BD_Econom_Feed / BD_Zootec_Feed_ Recria_Conf (lotes), Configurações (limites),
// Formulário/Q1 (questionário) e FINAL / FINAL RECRIA (resultado por categoria).
// Puro (sem DOM): o navegador valida enquanto a pessoa digita e o servidor usa as mesmas regras.

// ---------- Limites e listas (aba Configurações; editáveis no admin) ----------

export const DEFAULT_SETTINGS = {
  ano: 2026,
  prazo: null, // AAAA-MM-DD, opcional
  // Diferença máxima entre o valor informado e o recalculado a partir dos dados brutos.
  tolerancias: { pesoCarc: 10, gpd: 0.1, ganhoArroba: 0.5, rc: 1, eficAlim: 5, convAlim: 0.5, diasTrato: 2 },
  // Faixas plausíveis dos indicadores econômicos de cada lote.
  faixas: {
    pesoEntradaArroba: [5, 18],
    pesoSaidaArroba: [11, 26],
    custoArrobaEntrada: [150, 400],
    valorArrobaVenda: [180, 450],
    custoAlimentarDia: [5, 25],
    custoOperacional: [0.5, 50],
    lucroCab: [-1000, 2000],
  },
  listas: {
    racas: ['Nelore', 'Anelorado', 'Angus(Puro)', 'Cruz.Industrial(Angus)', 'Cruz.Industrial(Outras Raças)', 'Cruz.Leiteiro', 'Outro'],
    categorias: ['Macho de Engorda', 'Fêmea de Engorda', 'Vaca de Descarte'],
    origens: ['Recria Pasto', 'Recria Confinada', 'Compra Direta'],
    tiposEntrada: ['Boi Próprio', 'Arroba Produzida', 'Parceria', 'Boitel', 'Kg de Ms de Dieta'],
  },
};

export const TOLERANCIA_LABELS = {
  pesoCarc: ['Peso de carcaça', 'kg'],
  gpd: ['GPD', 'kg/dia'],
  ganhoArroba: ['Ganho @/cab', '@'],
  rc: ['Rendimento de carcaça', 'pontos %'],
  eficAlim: ['Eficiência alimentar', 'kgMS/@'],
  convAlim: ['Conversão alimentar', 'kgMS/kgPV'],
  diasTrato: ['Dias de trato', 'dias'],
};

export const FAIXA_LABELS = {
  pesoEntradaArroba: ['Peso de entrada', '@'],
  pesoSaidaArroba: ['Peso de saída (carcaça)', '@'],
  custoArrobaEntrada: ['Custo da @ de entrada', 'R$/@'],
  valorArrobaVenda: ['Valor da @ de venda', 'R$/@'],
  custoAlimentarDia: ['Custo alimentar diário', 'R$/cab/dia'],
  custoOperacional: ['Custo operacional', 'R$/cab/dia'],
  lucroCab: ['Lucro', 'R$/cab'],
};

export const LIST_LABELS = { racas: 'Raças', categorias: 'Categorias', origens: 'Origem dos animais', tiposEntrada: 'Tipos de entrada' };

// Junta o que está salvo com o padrão (campos novos ganham o valor padrão).
export function mergeSettings(saved = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    tolerancias: { ...DEFAULT_SETTINGS.tolerancias, ...(saved.tolerancias || {}) },
    faixas: { ...DEFAULT_SETTINGS.faixas, ...(saved.faixas || {}) },
    listas: { ...DEFAULT_SETTINGS.listas, ...(saved.listas || {}) },
  };
}

// ---------- Campos de um lote ----------

// col: letra da coluna na planilha original (para colar do Excel e importar o arquivo).
// req: obrigatório na engorda; reqRecria: obrigatório na recria.
export const ZOO_FIELDS = [
  { key: 'lote', label: 'Lote', type: 'text', col: 'A', req: true, reqRecria: true, w: 90 },
  { key: 'curral', label: 'Curral', type: 'text', col: 'B', w: 70 },
  { key: 'tipoEntrada', label: 'Tipo de entrada', type: 'list', list: 'tiposEntrada', col: 'C', req: true, reqRecria: true, w: 130 },
  { key: 'raca', label: 'Raça', type: 'list', list: 'racas', col: 'D', req: true, reqRecria: true, w: 150 },
  { key: 'categoria', label: 'Categoria', type: 'list', list: 'categorias', col: 'E', req: true, reqRecria: true, w: 165 },
  // Origem não existe por lote na planilha (era classificada por macro): opcional.
  { key: 'origem', label: 'Origem', type: 'list', list: 'origens', w: 140 },
  { key: 'saida', label: 'Saída', type: 'date', col: 'F', req: true, reqRecria: true, w: 120 },
  { key: 'qtAnm', label: 'Animais', unit: 'cab', type: 'int', col: 'G', req: true, reqRecria: true, w: 70 },
  { key: 'mortes', label: 'Mortes', unit: 'cab', type: 'int', col: 'H', w: 65 },
  { key: 'retPasto', label: 'Ret. pasto', unit: 'cab', type: 'int', col: 'J', w: 70 },
  { key: 'pvEntrada', label: 'PV entrada', unit: 'kg/cab', type: 'num', col: 'L', req: true, reqRecria: true, w: 80 },
  { key: 'pvSaida', label: 'PV saída', unit: 'kg/cab', type: 'num', col: 'M', req: true, reqRecria: true, w: 80 },
  { key: 'pesoCarc', label: 'Peso carcaça', unit: 'kg/cab', type: 'num', col: 'N', req: true, w: 85 },
  { key: 'gpd', label: 'GPD', unit: 'kg/dia', type: 'num', col: 'O', w: 65 },
  { key: 'rc', label: 'Rend. carcaça', unit: '%', type: 'num', col: 'P', req: true, w: 80 },
  { key: 'ganhoArroba', label: 'Ganho', unit: '@/cab', type: 'num', col: 'Q', w: 65 },
  { key: 'diasConf', label: 'Dias conf.', type: 'num', col: 'R', w: 65 },
  { key: 'diasTrato', label: 'Dias trato', type: 'num', col: 'S', req: true, reqRecria: true, w: 65 },
  { key: 'totalDiarias', label: 'Total diárias', type: 'num', col: 'T', w: 80 },
  { key: 'consMO', label: 'Cons. MO', unit: 'kg/cab/d', type: 'num', col: 'U', w: 70 },
  { key: 'consMS', label: 'Cons. MS', unit: 'kg/cab/d', type: 'num', col: 'V', req: true, reqRecria: true, w: 70 },
  { key: 'consMSpctPV', label: 'Cons. MS', unit: '%PV', type: 'num', col: 'W', w: 65 },
  { key: 'eficAlim', label: 'Efic. alim.', unit: 'kgMS/@', type: 'num', col: 'X', w: 75 },
  { key: 'convAlim', label: 'Conv. alim.', unit: 'kgMS/kgPV', type: 'num', col: 'Y', w: 75 },
];

// Parte econômica (aba BD_Econom_Feed): só o que não se repete da parte zootécnica.
export const ECO_FIELDS = [
  { key: 'valorEntradaCab', label: 'Valor de entrada', unit: 'R$/cab', type: 'num', col: 'C', w: 95 },
  { key: 'freteCab', label: 'Frete', unit: 'R$/cab', type: 'num', col: 'F', w: 70 },
  { key: 'comissaoCab', label: 'Comissão', unit: 'R$/cab', type: 'num', col: 'G', w: 75 },
  { key: 'valorSaidaCab', label: 'Valor de saída', unit: 'R$/cab', type: 'num', col: 'H', w: 95 },
  { key: 'custoTotalTrato', label: 'Custo total trato', unit: 'R$', type: 'num', col: 'Q', w: 110 },
  { key: 'custoTotalManejo', label: 'Custo total manejo', unit: 'R$', type: 'num', col: 'R', w: 110 },
  { key: 'custoTotalExtra', label: 'Custo total extra', unit: 'R$', type: 'num', col: 'S', w: 105 },
  { key: 'custoTotalLote', label: 'Custo total do lote', unit: 'R$', type: 'num', col: 'T', w: 115 },
  { key: 'valorTotalVenda', label: 'Valor total de venda', unit: 'R$', type: 'num', col: 'U', w: 120 },
];

export const ALL_FIELDS = [...ZOO_FIELDS, ...ECO_FIELDS];
const FIELD = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, f]));
export const fieldLabel = (key) => (FIELD[key] ? `${FIELD[key].label}${FIELD[key].unit ? ` (${FIELD[key].unit})` : ''}` : key);

// "1.234,5", "1234.5", 1234.5 → número; vazio → null; texto inválido → NaN.
export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const raw = String(v).trim().replace(/\s/g, '').replace(/%$/, '');
  if (!raw) return null;
  const thousandsOnly = /^-?\d{1,3}(\.\d{3})+$/.test(raw);
  return Number(raw.includes(',') || thousandsOnly ? raw.replace(/\./g, '').replace(',', '.') : raw);
}

// Data como AAAA-MM-DD (o formato do campo de data). O que não dá para ler fica como veio e a
// validação acusa.
export function toIsoDate(v) {
  return parseDate(v) ?? String(v).trim().slice(0, 10);
}

const MESES = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const isoFrom = (y, m, d) => {
  if (y < 100) y += 2000;
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return validIsoDate(s) ? s : null;
};

// Lê a data do jeito que ela chega do Excel ou do software, mesmo quando a célula não estava
// formatada como data: número de série do Excel (46096, também como texto "46096" ou "46.096"),
// Date, dd/mm/aaaa ou dd/mm/aa (separador /, -, . ou espaço), AAAA-MM-DD, AAAAMMDD,
// mês por nome ("15-mar-2026", "15 de março de 2026") e hora no fim ("15/03/2026 00:00").
// Dia/mês ambíguo é lido como brasileiro (dd/mm); só vira mm/dd quando o "mês" passa de 12.
// Devolve AAAA-MM-DD ou null.
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : isoFrom(v.getFullYear(), v.getMonth() + 1, v.getDate());
  const serial = (n) => (n > 20000 && n < 80000 ? new Date(EXCEL_EPOCH + Math.floor(n) * 86400000).toISOString().slice(0, 10) : null);
  if (typeof v === 'number') return Number.isFinite(v) ? serial(v) : null;
  const s = String(v)
    .trim()
    .toLowerCase()
    .replace(/[\sT]+\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(z|[ap]\.?m\.?)?$/i, '') // hora no fim
    .replace(/\s+de\s+/g, ' ')
    .trim();
  if (/^\d{2}\.?\d{3}([.,]\d+)?$/.test(s)) return serial(Number(s.replace(/\.(?=\d{3}($|,))/, '').replace(',', '.')));
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return isoFrom(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return isoFrom(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/);
  if (m) {
    const [a, b, y] = [+m[1], +m[2], +m[3]];
    return b > 12 && a <= 12 ? isoFrom(y, a, b) : isoFrom(y, b, a);
  }
  m = s.normalize('NFD').replace(/\p{M}/gu, '').match(/^(\d{1,2})[-/. ]*([a-z]{3})[a-z]*\.?[-/. ]*(\d{2}|\d{4})$/);
  if (m && MESES[m[2]]) return isoFrom(+m[3], MESES[m[2]], +m[1]);
  return null;
}

function validIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Limpa um lote vindo do navegador/importação: só campos conhecidos, números como número.
export function cleanLote(raw = {}) {
  const lote = {};
  for (const f of ALL_FIELDS) {
    const v = raw[f.key];
    if (v === null || v === undefined || v === '') continue;
    if (f.type === 'num' || f.type === 'int') {
      const n = toNumber(v);
      lote[f.key] = Number.isFinite(n) ? n : String(v).slice(0, 30);
    } else if (f.type === 'date') {
      lote[f.key] = toIsoDate(v);
    } else {
      lote[f.key] = String(v).trim().slice(0, 80);
    }
  }
  return lote;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt = (v, d = 2) => (v === null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));

// ---------- Período do lote (águas ou seca) ----------

// Águas: dezembro a maio; seca: junho a novembro. O lote é "Águas" quando mais de 70% dos dias
// no confinamento caíram nas águas. Entrada = saída − dias (Dias conf.; sem ele, Dias de trato).
export const MESES_AGUAS = [12, 1, 2, 3, 4, 5];
export const LIMITE_AGUAS = 0.7;
const DIA_MS = 24 * 60 * 60 * 1000;

export function periodoLote(l) {
  if (!validIsoDate(l.saida || '')) return null;
  const dias = Math.round(num(l.diasConf) ?? num(l.diasTrato) ?? 0);
  if (dias <= 0 || dias > 1000) return null;
  const saida = Date.parse(`${l.saida}T00:00:00Z`);
  const inicio = saida - dias * DIA_MS;
  let aguas = 0;
  for (let k = 0; k < dias; k++) if (MESES_AGUAS.includes(new Date(inicio + k * DIA_MS).getUTCMonth() + 1)) aguas += 1;
  const pctAguas = (aguas / dias) * 100;
  return { entrada: new Date(inicio).toISOString().slice(0, 10), dias, diasAguas: aguas, pctAguas, periodo: aguas / dias > LIMITE_AGUAS ? 'Águas' : 'Seca' };
}

// Indicadores recalculados de um lote (colunas Z–AF da aba zootécnica e AC–AI da econômica).
export function calcLote(l) {
  const v = (k) => num(l[k]);
  const pvE = v('pvEntrada');
  const pvS = v('pvSaida');
  const carc = v('pesoCarc');
  const rc = v('rc');
  const dias = v('diasTrato');
  const ms = v('consMS');
  const qt = v('qtAnm');
  const gpd = v('gpd');
  const ganhoInf = v('ganhoArroba');
  const ganhoPV = pvE !== null && pvS !== null ? pvS - pvE : null;
  const div = (a, b) => (a !== null && b !== null && b !== 0 ? a / b : null);
  const c = {
    pesoCarc: pvS !== null && rc !== null ? pvS * (rc / 100) : null,
    gpd: div(ganhoPV, dias),
    ganhoArroba: carc !== null && pvE !== null ? carc / 15 - pvE / 30 : null,
    rc: div(carc, pvS) !== null ? div(carc, pvS) * 100 : null,
    eficAlim: ms !== null && dias !== null ? div(ms * dias, ganhoInf ?? (carc !== null && pvE !== null ? carc / 15 - pvE / 30 : null)) : null,
    convAlim: ms !== null && dias !== null ? div(ms * dias, ganhoPV) : null,
    diasTrato: div(ganhoPV, gpd),
    mortesPct: div(v('mortes'), qt) !== null ? div(v('mortes'), qt) * 100 : null,
    retPastoPct: div(v('retPasto'), qt) !== null ? div(v('retPasto'), qt) * 100 : null,
    consMSpctPV: ms !== null && pvE !== null && pvS !== null ? (ms / ((pvE + pvS) / 2)) * 100 : null,
    // Econômicos (aba BD_Econom_Feed, colunas AC–AI).
    pesoEntradaArroba: div(pvE, 30),
    pesoSaidaArroba: div(carc, 15),
    custoArrobaEntrada: div(v('valorEntradaCab'), div(pvE, 30)),
    valorArrobaVenda: div(v('valorSaidaCab'), div(carc, 15)),
    custoAlimentarDia: div(div(v('custoTotalTrato'), qt), dias),
  };
  // Como na planilha: custo operacional = custo total de manejo por cab/dia menos o alimentar.
  const manejoDia = div(div(v('custoTotalManejo'), qt), dias);
  c.custoOperacional = manejoDia !== null && c.custoAlimentarDia !== null ? manejoDia - c.custoAlimentarDia : null;
  c.lucroCab = v('valorTotalVenda') !== null && v('custoTotalLote') !== null && qt ? (v('valorTotalVenda') - v('custoTotalLote')) / qt : null;
  const p = periodoLote(l);
  c.entrada = p?.entrada ?? null;
  c.pctAguas = p?.pctAguas ?? null;
  c.periodo = p?.periodo ?? null;
  return c;
}

// Problemas de um lote: "erro" impede enviar; "alerta" precisa de conferência/justificativa.
export function validateLote(l, settings, { recria = false, duplicateIds = new Set() } = {}) {
  const s = mergeSettings(settings);
  const issues = [];
  const add = (level, field, msg) => issues.push({ level, field, msg });
  for (const f of ZOO_FIELDS.concat(recria ? [] : ECO_FIELDS)) {
    const v = l[f.key];
    const required = recria ? f.reqRecria : f.req;
    if (v === undefined || v === null || v === '') {
      if (required) add('erro', f.key, `${f.label}: preencha.`);
      continue;
    }
    if ((f.type === 'num' || f.type === 'int') && !Number.isFinite(v)) add('erro', f.key, `${f.label}: "${v}" não é um número.`);
    else if (f.type === 'int' && (v < 0 || !Number.isInteger(v))) add('erro', f.key, `${f.label}: use um número inteiro.`);
    else if (f.type === 'num' && v < 0 && f.key !== 'lucro') add('erro', f.key, `${f.label}: não pode ser negativo.`);
    if (f.type === 'list' && !s.listas[f.list].includes(v)) add('erro', f.key, `${f.label}: "${v}" não está na lista (${s.listas[f.list].join(', ')}).`);
    if (f.type === 'date' && !validIsoDate(v)) add('erro', f.key, `${f.label}: "${v}" não é uma data válida (use dd/mm/aaaa).`);
  }
  if (l.lote && duplicateIds.has(String(l.lote))) add('erro', 'lote', `Lote "${l.lote}" aparece mais de uma vez.`);
  const n = (k) => num(l[k]);
  if (n('qtAnm') !== null && n('mortes') !== null && n('mortes') > n('qtAnm')) add('erro', 'mortes', 'Mortes maiores que o número de animais.');
  if (n('qtAnm') !== null && n('retPasto') !== null && n('retPasto') > n('qtAnm')) add('erro', 'retPasto', 'Retorno a pasto maior que o número de animais.');
  if (n('pvEntrada') !== null && n('pvSaida') !== null && n('pvSaida') <= n('pvEntrada')) add('erro', 'pvSaida', 'PV de saída precisa ser maior que o de entrada.');
  if (n('rc') !== null && (n('rc') < 1 || n('rc') > 100)) add('erro', 'rc', 'Rendimento de carcaça em %, entre 1 e 100 (ex.: 55).');

  // Coerência: valor informado contra o recalculado (mesmas tolerâncias da planilha).
  const c = calcLote(l);
  const t = s.tolerancias;
  // Campo com erro (ex.: rendimento 0,55 em vez de 55) não entra nas contas de coerência.
  const comErro = new Set(issues.filter((i) => i.level === 'erro').map((i) => i.field));
  const deps = { pesoCarc: ['pvSaida', 'rc'], gpd: ['pvSaida', 'pvEntrada', 'diasTrato'], ganhoArroba: ['pesoCarc', 'pvEntrada'], rc: ['pesoCarc', 'pvSaida'], eficAlim: ['consMS', 'diasTrato', 'ganhoArroba'], convAlim: ['consMS', 'diasTrato', 'pvSaida', 'pvEntrada'], diasTrato: ['pvSaida', 'pvEntrada', 'gpd'] };
  const check = (field, calc, informed, tol, label, d = 2) => {
    if (calc === null || informed === null || !Number.isFinite(calc)) return;
    if ([field, ...(deps[field] || [])].some((k) => comErro.has(k))) return;
    if (Math.abs(calc - informed) >= tol) add('alerta', field, `${label}: informado ${fmt(informed, d)}, mas os dados dão ${fmt(calc, d)} (tolerância ${fmt(tol, d)}).`);
  };
  check('pesoCarc', c.pesoCarc, n('pesoCarc'), t.pesoCarc, 'Peso de carcaça (PV saída × rendimento)', 1);
  check('gpd', c.gpd, n('gpd'), t.gpd, 'GPD ((PV saída − entrada) ÷ dias de trato)', 3);
  check('ganhoArroba', c.ganhoArroba, n('ganhoArroba'), t.ganhoArroba, 'Ganho @/cab (carcaça ÷ 15 − PV entrada ÷ 30)');
  check('rc', c.rc, n('rc'), t.rc, 'Rendimento de carcaça (carcaça ÷ PV saída)', 1);
  check('eficAlim', c.eficAlim, n('eficAlim'), t.eficAlim, 'Eficiência alimentar (MS × dias ÷ @ ganhas)', 1);
  check('convAlim', c.convAlim, n('convAlim'), t.convAlim, 'Conversão alimentar (MS × dias ÷ kg ganhos)');
  check('diasTrato', c.diasTrato, n('diasTrato'), t.diasTrato, 'Dias de trato ((PV saída − entrada) ÷ GPD)', 0);

  // Faixas econômicas (só na engorda, quando os valores existem).
  if (!recria) {
    const f = s.faixas;
    const range = (field, key, label, d = 2) => {
      const v = c[key];
      if (v === null || !Number.isFinite(v)) return;
      const [min, max] = f[key];
      if (v <= min || v > max) add('alerta', field, `${label} de ${fmt(v, d)} fora da faixa esperada (${fmt(min, d)} a ${fmt(max, d)}).`);
    };
    range('pvEntrada', 'pesoEntradaArroba', 'Peso de entrada em @');
    range('pesoCarc', 'pesoSaidaArroba', 'Peso de saída em @');
    range('valorEntradaCab', 'custoArrobaEntrada', 'Custo da @ de entrada');
    range('valorSaidaCab', 'valorArrobaVenda', 'Valor da @ de venda');
    range('custoTotalTrato', 'custoAlimentarDia', 'Custo alimentar diário');
    range('custoTotalManejo', 'custoOperacional', 'Custo operacional diário');
    range('valorTotalVenda', 'lucroCab', 'Lucro por cabeça');
    if (ECO_FIELDS.every((e) => l[e.key] === undefined)) add('alerta', 'valorEntradaCab', 'Sem dados econômicos neste lote: o resultado usará os custos do questionário.');
  }
  return issues;
}

// Valida todos os lotes de uma lista; devolve { porLote: [issues], erros, alertas }.
export function validateLotes(lotes, settings, opts = {}) {
  const seen = new Map();
  for (const l of lotes) if (l.lote) seen.set(String(l.lote), (seen.get(String(l.lote)) || 0) + 1);
  const duplicateIds = new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
  const porLote = lotes.map((l) => validateLote(l, settings, { ...opts, duplicateIds }));
  return {
    porLote,
    erros: porLote.reduce((s, i) => s + i.filter((x) => x.level === 'erro').length, 0),
    alertas: porLote.reduce((s, i) => s + i.filter((x) => x.level === 'alerta').length, 0),
    lotesComErro: porLote.filter((i) => i.some((x) => x.level === 'erro')).length,
  };
}

// ---------- Questionário (aba Formulário / Q1) ----------
// type: text | email | uf | int | num | pct | sn (sim/não) | choice | multi | textarea.
// {ano} = ano do benchmarking; {anoDados} = ano dos dados (ano anterior).

const SN = ['Sim', 'Não'];
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const ESCOLARIDADE = ['Fundamental', 'Médio', 'Técnico', 'Nível superior', 'Pós-graduação'];
const INDICADORES = [
  'Quebra de transporte (kg)',
  'Coeficientes de variação de consumo (%)',
  'Coeficientes de variação de peso vivo de entrada (%)',
  'Período de descanso antes do processamento (dias)',
  'Conformidade de fabricação (%)',
  'Conformidade de trato (%)',
  'Leitura de cocho (escore)',
  'Mortalidade (%)',
  'Morbidade (%)',
  'Ágio de compra (%)',
  'Valor de compra(R$/@)',
  'Ganho diário de carcaça(kg/cab/dia)',
  'Ganho médio diário (kg/cab/dia)',
  'Eficiência biológica(kgMS/@)',
  'Valor de venda (R$/@)',
  'Consumo/PV(%)',
  'Custo de tonelada de matéria seca da dieta (R$/ton)',
  'Custo da diária (R$/cab/dia)',
  'Rendimento de carcaça (%)',
  'Lucratividade (Lucro líquido/Receita bruta)',
  'Rentabilidade (Lucro/Capital investido)',
  'Margem por cabeça (R$/cab)',
  'Custo da arroba produzida (R$/@)',
];

export const QUESTIONARIO = [
  {
    id: 'identificacao',
    title: 'Identificação',
    questions: [
      { id: 'q1', n: 1, text: 'Nome da empresa + unidade do confinamento', type: 'text', req: true },
      { id: 'q2', n: 2, text: 'Cidade', type: 'text', req: true },
      { id: 'q3', n: 3, text: 'Estado', type: 'uf', req: true },
      { id: 'q4', n: 4, text: 'Nome do funcionário do cliente responsável pela validação dos dados', type: 'text', req: true },
      { id: 'q5', n: 5, text: 'Nome de quem está respondendo o formulário', type: 'text', req: true },
      { id: 'q6', n: 6, text: 'E-mail de quem está respondendo o formulário', type: 'email', req: true },
      { id: 'q7', n: 7, text: 'Coordenador Cargill responsável pelo envio e validação dos dados', type: 'text', req: true },
    ],
  },
  {
    id: 'sistema',
    title: 'Sistema produtivo',
    questions: [
      { id: 'q8', n: 8, text: 'Capacidade estática do confinamento', unit: 'cab', type: 'int', req: true, min: 1 },
      { id: 'q9', n: 9, text: 'Sistema produtivo', type: 'choice', options: ['Engorda', 'Recria + Engorda', 'Cria + Recria + Engorda', 'Boitel'], other: true, req: true },
      { id: 'q10', n: 10, text: 'Qual(is) modelo(s) de reposição de boi magro?', type: 'multi', options: ['Recria a pasto na fazenda', 'Recria confinada na fazenda', 'Compra', 'Parceria'], other: true, req: true },
      { id: 'q11', n: 11, text: 'Número de currais', type: 'int', min: 1, req: true },
      { id: 'q12', n: 12, text: 'Área média dos currais', unit: 'm²', type: 'num', req: true },
      { id: 'q13', n: 13, text: 'Área média por boi nas águas', unit: 'm²/boi', type: 'num', req: true },
      { id: 'q14', n: 14, text: 'Área média por boi nas secas', unit: 'm²/boi', type: 'num', req: true },
    ],
  },
  {
    id: 'cocho',
    title: 'Manejo de cocho',
    questions: [
      { id: 'q15', n: 15, text: 'Tipo de manejo de cocho', type: 'choice', options: ['Manejo de Cocho Cargill (Manejo de Cocho Limpo)', 'Cocho com sobra', 'Outro manejo de cocho limpo'], other: true, req: true },
      { id: 'q16', n: 16, text: 'Tipo de adaptação', type: 'choice', options: ['Blend de duas dietas', 'Escada (várias dietas)', 'Restrição de consumo', 'Pasto + suplemento'], other: true, req: true },
      { id: 'q17', n: 17, text: 'Tempo de adaptação', unit: 'dias', type: 'int', req: true },
      { id: 'q18', n: 18, text: 'Número de tratos por dia nas secas', type: 'int', req: true },
      { id: 'q19', n: 19, text: 'Número de tratos por dia nas águas', type: 'int', req: true },
      {
        id: 'q20',
        n: 20,
        text: 'Quais tecnologias estão presentes no confinamento?',
        type: 'multi',
        options: ['Software de gestão de operação de confinamento', 'Rastreabilidade individual', 'ERP - Software de gestão empresarial', 'Análise de dados e consultoria de gestão', 'Balança de pesagem individual', 'Automação de fábrica de ração', 'Monitoramento de cocho por câmera/sensor'],
        other: true,
      },
      { id: 'q21', n: 21, text: 'Faz leitura de cocho noturna?', type: 'sn', req: true },
      { id: 'q22', n: 22, text: 'Se sim, quantas vezes na noite faz a leitura noturna?', type: 'int', showIf: ['q21', 'Sim'], req: true },
      { id: 'q23', n: 23, text: 'Energia líquida da dieta de terminação', unit: 'Mcal/kg MS', type: 'num', hint: 'Preencher com auxílio do coordenador da conta.', min: 0.8, max: 2.2, req: true },
      { id: 'q24', n: 24, text: 'Energia líquida da dieta da recria confinada', unit: 'Mcal/kg MS', type: 'num', hint: 'Preencher com auxílio do coordenador da conta.', min: 0.8, max: 2.2, req: true },
      { id: 'q25', n: 25, text: 'Utiliza dieta sem volumoso?', type: 'sn', req: true },
    ],
  },
  {
    id: 'saude',
    title: 'Saúde animal',
    questions: [
      { id: 'q26', n: 26, text: 'Mortalidade de machos', unit: '%', type: 'pct', hint: 'Porcentagem de machos que morreram em relação aos que entraram ao longo de {anoDados}.', req: true },
      { id: 'q27', n: 27, text: 'Mortalidade de fêmeas', unit: '%', type: 'pct', hint: 'Porcentagem de fêmeas que morreram em relação às que entraram ao longo de {anoDados}.', req: true },
      { id: 'q28', n: 28, text: 'Prevenção de doenças respiratórias na entrada do confinamento', type: 'multi', options: ['Vacinação', 'Metafilaxia', 'Nenhuma'], other: true, req: true },
      { id: 'q29', n: 29, text: 'Quais enfermidades estão presentes no confinamento?', type: 'multi', options: ['Doença respiratória', 'Laminite', 'Acidentes', 'Timpanismo', 'Acidose', 'Clostridiose', 'Tristeza parasitária'], other: true },
      { id: 'q30', n: 30, text: 'Quem determina o diagnóstico da causa da morte?', type: 'multi', options: ['Veterinário do confinamento', 'Veterinário consultor', 'Gerente/encarregado', 'Ninguém'], other: true, req: true },
      { id: 'q31', n: 31, text: 'Faz necrópsia?', type: 'choice', options: ['Total', 'Parcial', 'Não faz'], req: true },
      { id: 'q32', n: 32, text: 'Realiza acompanhamento de abate?', type: 'sn', req: true },
      { id: 'q33', n: 33, text: 'Porcentagem de carcaças condenadas', unit: '%', type: 'pct', req: true },
    ],
  },
  {
    id: 'rh',
    title: 'Recursos humanos',
    questions: [
      { id: 'q34', n: 34, text: 'Funcionários no administrativo', unit: 'pessoas', type: 'int', hint: 'Financeiro, RH, controladoria, almoxarifado.', req: true },
      { id: 'q35', n: 35, text: 'Funcionários no comercial', unit: 'pessoas', type: 'int', hint: 'Originação, venda de animais e acompanhamento de abate.', req: true },
      { id: 'q36', n: 36, text: 'Funcionários na operação/campo', unit: 'pessoas', type: 'int', hint: 'Tratador, vaqueiro, pazeiro, serviços gerais, ronda sanitária, rastreabilidade, supervisores de operação, oficina.', req: true },
      { id: 'q37', n: 37, text: 'Salário médio de vaqueiro', unit: 'R$/mês', type: 'num', req: true },
      { id: 'q38', n: 38, text: 'Salário médio de tratador', unit: 'R$/mês', type: 'num', req: true },
      { id: 'q39', n: 39, text: 'Salário médio de pazeiro', unit: 'R$/mês', type: 'num', req: true },
      { id: 'q40a', n: 40, text: 'Escolaridade do supervisor de trato', type: 'choice', options: ESCOLARIDADE, req: true },
      { id: 'q40b', n: 40, text: 'Escolaridade do administrativo', type: 'choice', options: ESCOLARIDADE, req: true },
      { id: 'q40c', n: 40, text: 'Escolaridade do gerente', type: 'choice', options: ESCOLARIDADE, req: true },
    ],
  },
  {
    id: 'gestao',
    title: 'Foco gerencial',
    questions: [
      { id: 'q41', n: 41, text: 'Quais são os CINCO indicadores mais relevantes para a sua OPERAÇÃO?', type: 'multi', options: INDICADORES, min: 5, max: 5, other: true, req: true },
      { id: 'q42', n: 42, text: 'Quais são os SETE indicadores mais relevantes na TÁTICA do seu negócio?', type: 'multi', options: INDICADORES, min: 7, max: 7, other: true, req: true },
      { id: 'q43', n: 43, text: 'Qual o indicador ESTRATÉGICO mais relevante para a sua empresa?', type: 'choice', options: INDICADORES, other: true, req: true },
    ],
  },
  {
    id: 'comercial',
    title: 'Comercialização e custo de produção',
    note: 'Os valores abaixo, quando preenchidos, são usados no resultado no lugar das médias dos lotes.',
    questions: [
      { id: 'q44', n: 44, text: 'As informações de comercialização estão presentes na base produtiva?', type: 'sn', req: true },
      { id: 'q45', n: 45, text: 'Custo médio anual do boi magro na entrada do confinamento', unit: 'R$/@', type: 'num', hint: 'Apenas o custo do boi, sem embutir outros custos.', range: [150, 400] },
      { id: 'q46', n: 46, text: 'Custo médio anual de compra da fêmea de engorda', unit: 'R$/@', type: 'num', hint: 'Apenas o custo da fêmea de engorda. Não considerar vaca de descarte.', range: [150, 400] },
      { id: 'q47', n: 47, text: 'Custo do frete de compra', unit: 'R$/cab', type: 'num' },
      { id: 'q48', n: 48, text: 'Custo da comissão de compra', unit: 'R$/cab', type: 'num' },
      { id: 'q49', n: 49, text: 'Custo de rastreabilidade', unit: 'R$/cab', type: 'num' },
      { id: 'q50', n: 50, text: 'Custo médio de tratamento de doenças', unit: 'R$/cab', type: 'num', hint: 'Durante o período de engorda.' },
      { id: 'q51', n: 51, text: 'Custo da diária operacional', unit: 'R$/cab/dia', type: 'num', hint: 'Considerar custo fixo + despesas administrativas.', range: [0.5, 50] },
      { id: 'q52', n: 52, text: 'Custo da matéria seca da dieta', unit: 'R$/ton', type: 'num' },
      { id: 'q53', n: 53, text: 'Preço médio anual de venda da arroba do boi gordo', unit: 'R$/@', type: 'num', hint: 'Receita bruta total, incluindo bonificação/premiação. Não incluir imposto sobre venda.', range: [180, 450] },
      { id: 'q54', n: 54, text: 'Preço médio anual de venda da arroba da fêmea de engorda', unit: 'R$/@', type: 'num', hint: 'Receita bruta total, incluindo bonificação/premiação. Não incluir imposto sobre venda.', range: [180, 450] },
      { id: 'q55', n: 55, text: 'Utiliza mecanismo de proteção de preços da B3?', type: 'sn', req: true },
      { id: 'q56', n: 56, text: 'Para quais mercados realizou venda neste ano?', type: 'multi', options: ['Mercado interno', 'Mercado China', 'Mercado Europeu (Cota Hilton/Lista Trace)', 'Outros mercados de exportação'], other: true, req: true },
    ],
  },
  {
    id: 'sustentabilidade',
    title: 'Sustentabilidade',
    questions: [
      { id: 'q57', n: 57, text: 'Principal(is) fonte(s) de água utilizada(s) na propriedade', type: 'multi', options: ['Poço artesiano', 'Poço semiartesiano', 'Rio/córrego', 'Represa/açude', 'Nascente'], other: true, req: true },
      { id: 'q58', n: 58, text: 'Medida(s) tomada(s) para evitar a contaminação das fontes de água', type: 'multi', options: ['Manutenção de áreas de preservação permanente (APPs)', 'Controle de erosão do solo', 'Uso adequado de fertilizantes e pesticidas', 'Cercamento das nascentes', 'Tratamento de efluentes'], other: true, req: true },
      { id: 'q59', n: 59, text: 'Medidas tomadas para evitar o desperdício de água', type: 'multi', options: ['Manutenção regular dos bebedouros', 'Controle de erosão do solo', 'Treinamento dos funcionários', 'Uso de hidrômetro', 'Bebedouros com boia'], other: true, req: true },
      { id: 'q60', n: 60, text: 'Frequência da manutenção hidráulica dos bebedouros', type: 'choice', options: ['Diariamente', 'Semanalmente', 'Mensalmente', 'Quando apresenta problema'], req: true },
      { id: 'q61', n: 61, text: 'Existem práticas de reuso de água na propriedade?', type: 'choice', options: ['Não', 'Sim, para irrigação', 'Sim, para limpeza', 'Sim, outros usos'], req: true },
      { id: 'q62', n: 62, text: 'Manejo(s) de dejetos realizado(s) na fazenda', type: 'multi', options: ['Lagoa de dejetos', 'Compostagem', 'Biodigestor', 'Esterqueira', 'Nenhum'], other: true, req: true },
      { id: 'q62b', n: 62, text: 'É realizado enriquecimento na compostagem?', type: 'sn', showIf: ['q62', 'Compostagem'] },
      { id: 'q63', n: 63, text: 'Destino dos dejetos', type: 'multi', options: ['Adubo orgânico', 'Fertirrigação', 'Comercialização', 'Descarte'], other: true, req: true },
      { id: 'q63b', n: 63, text: 'Valor por tonelada de esterco vendido', unit: 'R$/t', type: 'num', showIf: ['q63', 'Comercialização'] },
      { id: 'q63c', n: 63, text: 'Valor por tonelada de esterco ou composto tratado vendido', unit: 'R$/t', type: 'num', showIf: ['q63', 'Comercialização'] },
      { id: 'q64', n: 64, text: 'Estratégias nutricionais utilizadas para mitigar a emissão de metano', type: 'multi', options: ['Uso de aditivos', 'Processamento de grão úmido', 'Dietas de alta energia', 'Nenhuma'], other: true, req: true },
      { id: 'q65', n: 65, text: 'Há gerenciamento da quilometragem percorrida para a compra de insumos?', type: 'sn', req: true },
      { id: 'q66', n: 66, text: 'Quilometragem média na COMPRA dos animais', type: 'choice', options: ['Até 80 km', '81 - 120 km', '121 - 180 km', '181 -210 km', 'Acima de 210 km'], req: true },
      { id: 'q66b', n: 66, text: 'Quilometragem média na compra de insumos', unit: 'km', type: 'num', req: true, showIf: ['q65', 'Sim'] },
      { id: 'q67', n: 67, text: 'Quilometragem média na VENDA dos animais', type: 'choice', options: ['Até 80 km', '81 - 120 km', '121 - 180 km', '181 -210 km', 'Acima de 210 km'], req: true },
      { id: 'q68', n: 68, text: 'Tipo(s) de energia utilizado(s) na fazenda', type: 'multi', options: ['Energia elétrica - Companhia', 'Motor a diesel', 'Gerador à diesel', 'Biodigestor', 'Hídrica (turbina hidráulica)', 'Solar (placa solar)'], other: true, req: true },
      { id: 'q69a', n: 69, text: 'Participação do biodigestor na energia', unit: '%', type: 'pct', req: true },
      { id: 'q69b', n: 69, text: 'Participação da energia elétrica', unit: '%', type: 'pct', req: true },
      { id: 'q69c', n: 69, text: 'Participação do motor a diesel', unit: '%', type: 'pct', req: true },
      { id: 'q69d', n: 69, text: 'Participação hídrica (turbina hidráulica)', unit: '%', type: 'pct', req: true },
      { id: 'q69e', n: 69, text: 'Participação solar (placa solar)', unit: '%', type: 'pct', req: true },
      { id: 'q70', n: 70, text: 'Participa de algum programa de frigoríficos relacionado à sustentabilidade?', type: 'sn', req: true },
    ],
  },
  {
    id: 'bemestar',
    title: 'Bem-estar animal',
    questions: [
      { id: 'q71', n: 71, text: 'Há boa estrutura no curral de manejo racional?', type: 'sn', req: true },
      { id: 'q72', n: 72, text: 'Porcentagem de currais com calçamento', type: 'choice', options: ['Nenhum', 'Até 20%', '21% a 50%', '51% a 80%', 'Maior que 80%'], req: true },
      { id: 'q73', n: 73, text: 'Presença de irrigação', type: 'sn', req: true },
      { id: 'q74', n: 74, text: 'Quantos currais são irrigados', type: 'int', showIf: ['q73', 'Sim'], req: true },
      { id: 'q75', n: 75, text: 'Presença de sombra (3 m²/animal)', type: 'sn', req: true },
      { id: 'q76', n: 76, text: 'Quantos currais são sombreados', type: 'int', showIf: ['q75', 'Sim'], req: true },
      { id: 'q77', n: 77, text: 'Número de bebedouros por curral', type: 'num', req: true },
      { id: 'q78', n: 78, text: 'Metragem linear média dos bebedouros', unit: 'm', type: 'num', req: true },
      { id: 'q79', n: 79, text: 'Há estação meteorológica na propriedade?', type: 'sn', req: true },
      { id: 'q80', n: 80, text: 'Há acompanhamento de THI ou onda de calor no confinamento?', type: 'sn', req: true },
      { id: 'q81', n: 81, text: 'Como é realizada a identificação dos animais?', type: 'multi', options: ['Brinco', 'Brinco eletrônico (RFID)', 'Bolus', 'Marcação a fogo'], other: true, req: true },
      { id: 'q82', n: 82, text: 'Frequência de limpeza dos bebedouros', type: 'choice', options: ['Diariamente', '3 vezes por semana', 'Semanalmente', 'Quinzenalmente', 'Mensalmente'], other: true, req: true },
      { id: 'q83', n: 83, text: 'Como é realizado o gerenciamento do comportamento animal?', type: 'multi', options: ['Avaliação visual', 'Sensores/colares', 'Câmeras', 'Não é realizado'], other: true, req: true },
      { id: 'q84', n: 84, text: 'Há equipe que realiza ronda sanitária no confinamento?', type: 'sn', req: true },
      { id: 'q85', n: 85, text: 'Horas por ano de treinamento técnico por funcionário', type: 'choice', options: ['Nenhuma', 'Menos de 5 horas', 'Entre 5 e 10 horas', 'Entre 10 e 20 horas', 'Mais de 20 horas'], req: true },
      { id: 'q86', n: 86, text: 'Há política de remuneração variável baseada no desempenho dos funcionários?', type: 'choice', options: ['Não', 'Sim, e o bônus é pago mensalmente', 'Sim, e o bônus é pago semestralmente', 'Sim, e o bônus é pago anualmente'], req: true },
    ],
  },
  {
    id: 'expectativas',
    title: 'Expectativas',
    questions: [
      { id: 'q87', n: 87, text: 'Quais serão os maiores desafios para {ano}?', type: 'multi', options: ['Custo de reposição', 'Mão de obra', 'Custo de capital', 'Custo de insumos', 'Preço do boi gordo', 'Clima', 'Sanidade'], other: true, req: true },
      { id: 'q88', n: 88, text: 'Quais serão as principais oportunidades para {ano}?', type: 'multi', options: ['Oferta de boi magro', 'Custo de insumos', 'Gestão de risco na comercialização de gado', 'Mercado de exportação', 'Tecnologia e gestão'], other: true, req: true },
      { id: 'q89', n: 89, text: 'Expectativas para {ano} em relação a {anoDados}', type: 'choice', options: ['Melhores', 'Iguais', 'Piores'], req: true },
    ],
  },
  {
    id: 'comentarios',
    title: 'Comentários',
    questions: [{ id: 'q90', n: 90, text: 'Espaço aberto para depoimentos e comentários', type: 'textarea' }],
  },
];

export const QUESTIONS = QUESTIONARIO.flatMap((s) => s.questions);
export const questionText = (q, settings) => q.text.replaceAll('{ano}', settings.ano).replaceAll('{anoDados}', settings.ano - 1);

export function questionVisible(q, respostas) {
  if (!q.showIf) return true;
  const [dep, val] = q.showIf;
  const a = respostas[dep];
  return Array.isArray(a) ? a.includes(val) : a === val;
}

// Uma resposta: valida o tipo e devolve o valor limpo (ou um erro).
export function cleanAnswer(q, raw) {
  if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && !raw.length)) return { value: null };
  if (['int', 'num', 'pct'].includes(q.type)) {
    const n = toNumber(raw);
    if (!Number.isFinite(n)) return { error: 'Informe um número.' };
    if (q.type === 'int' && !Number.isInteger(n)) return { error: 'Use um número inteiro.' };
    if (n < (q.min ?? 0)) return { error: `Mínimo ${q.min ?? 0}.` };
    if (q.type === 'pct' && n > 100) return { error: 'Porcentagem entre 0 e 100.' };
    if (q.max !== undefined && n > q.max) return { error: `Máximo ${q.max}.` };
    return { value: n };
  }
  if (q.type === 'multi') {
    const list = (Array.isArray(raw) ? raw : String(raw).split(';')).map((x) => String(x).trim().slice(0, 200)).filter(Boolean);
    if (q.max && list.length > q.max) return { error: `Escolha no máximo ${q.max}.` };
    return { value: [...new Set(list)] };
  }
  const text = String(raw).trim().slice(0, q.type === 'textarea' ? 3000 : 300);
  if (q.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { error: 'E-mail inválido.' };
  if (q.type === 'uf' && !UFS.includes(text.toUpperCase())) return { error: 'Use a sigla do estado (ex.: MG).' };
  if (q.type === 'sn' && !SN.includes(text)) return { error: 'Responda Sim ou Não.' };
  return { value: q.type === 'uf' ? text.toUpperCase() : text };
}

export const OPTIONS = { SN, UFS };

// Situação do questionário: obrigatórias faltando (ou incompletas, com o motivo) e respostas que
// fogem da faixa esperada. As obrigatórias e as regras são as dos formulários da planilha.
export function validateQuestionario(respostas = {}) {
  const faltando = [];
  const alertas = [];
  const motivos = {}; // id → por que a resposta ainda não vale (ex.: marcou 3 de 5 indicadores)
  let respondidas = 0;
  let visiveis = 0;
  for (const q of QUESTIONS) {
    if (!questionVisible(q, respostas)) continue;
    visiveis += 1;
    const v = respostas[q.id];
    const vazio = v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
    if (!vazio) respondidas += 1;
    if (vazio && q.req) faltando.push(q.id);
    if (!vazio && q.type === 'multi' && q.min && Array.isArray(v) && v.length < q.min) {
      faltando.push(q.id);
      motivos[q.id] = `Escolha ${q.min === q.max ? 'exatamente' : 'pelo menos'} ${q.min} (marcou ${v.length}).`;
    }
    if (!vazio && q.range && typeof v === 'number' && v !== 0 && (v < q.range[0] || v > q.range[1])) alertas.push({ id: q.id, msg: `Valor fora do esperado (${q.range[0]} a ${q.range[1]}).` });
  }
  // Participações de energia: como no formulário, precisam somar 100%.
  const pctMix = ['q69a', 'q69b', 'q69c', 'q69d', 'q69e'].map((id) => respostas[id]).filter((v) => typeof v === 'number');
  const soma = pctMix.reduce((a, b) => a + b, 0);
  if (pctMix.length && Math.abs(soma - 100) > 0.5) {
    if (!faltando.includes('q69a')) faltando.push('q69a');
    motivos.q69a = `As participações de energia precisam somar 100% (hoje somam ${fmt(soma, 1)}%).`;
  }
  return { faltando, alertas, motivos, respondidas, visiveis };
}

// ---------- Resultado por categoria (abas FINAL e FINAL RECRIA) ----------

// Média ponderada pelo número de animais, só entre os lotes que têm o valor.
function weighted(lotes, f) {
  let s = 0;
  let w = 0;
  for (const l of lotes) {
    const v = f(l);
    const q = num(l.qtAnm);
    if (v === null || !Number.isFinite(v) || !q) continue;
    s += v * q;
    w += q;
  }
  return w ? s / w : null;
}

// Resposta do questionário usada no lugar da média dos lotes (0 ou vazio = não informado).
const informed = (v) => (typeof v === 'number' && v > 0 ? v : null);

export function resultadoEngorda(lotes, respostas = {}, categoria) {
  const ls = lotes.filter((l) => l.categoria === categoria);
  const animais = ls.reduce((s, l) => s + (num(l.qtAnm) || 0), 0);
  if (!animais) return null;
  const calc = (l) => calcLote(l);
  const rcLote = (l) => num(l.rc) ?? calc(l).rc;
  const z = {};
  z.animais = animais;
  z.lotes = ls.length;
  z.pesoEntradaKg = weighted(ls, (l) => num(l.pvEntrada));
  z.rc = weighted(ls, rcLote);
  const saidaArroba = weighted(ls, (l) => num(l.pesoCarc) !== null ? l.pesoCarc / 15 : null);
  z.pesoSaidaKg = saidaArroba !== null && z.rc ? (saidaArroba * 15) / (z.rc / 100) : null;
  z.dias = weighted(ls, (l) => num(l.diasTrato));
  z.gpd = z.pesoSaidaKg !== null && z.pesoEntradaKg !== null && z.dias ? (z.pesoSaidaKg - z.pesoEntradaKg) / z.dias : null;
  z.gdc = z.pesoSaidaKg !== null && z.rc && z.dias ? (z.pesoSaidaKg * (z.rc / 100) - z.pesoEntradaKg * 0.5) / z.dias : null;
  z.arrobasProduzidas = z.pesoSaidaKg !== null && z.rc ? (z.pesoSaidaKg * (z.rc / 100)) / 15 - (z.pesoEntradaKg * 0.5) / 15 : null;
  z.consMS = weighted(ls, (l) => num(l.consMS));
  z.consMSpct = z.consMS !== null && z.pesoEntradaKg !== null && z.pesoSaidaKg !== null ? (z.consMS / ((z.pesoEntradaKg + z.pesoSaidaKg) / 2)) * 100 : null;
  z.eficiencia = z.consMS !== null && z.dias && z.arrobasProduzidas ? (z.consMS * z.dias) / z.arrobasProduzidas : null;
  z.conversao = z.consMS !== null && z.gpd ? z.consMS / z.gpd : null;

  const femea = categoria !== 'Macho de Engorda';
  const r = respostas;
  const e = {};
  const fonte = {};
  const pick = (key, answer, fallback) => {
    const a = informed(answer);
    fonte[key] = a !== null ? 'questionário' : 'lotes';
    return a ?? fallback;
  };
  e.custoArrobaMagro = pick('custoArrobaMagro', femea ? r.q46 : r.q45, weighted(ls, (l) => calc(l).custoArrobaEntrada));
  e.pesoEntradaArroba = z.pesoEntradaKg !== null ? z.pesoEntradaKg / 30 : null;
  e.custoBoiMagro = e.custoArrobaMagro !== null && e.pesoEntradaArroba !== null ? e.custoArrobaMagro * e.pesoEntradaArroba : null;
  e.custoOperacionalDia = pick('custoOperacionalDia', r.q51, weighted(ls, (l) => calc(l).custoOperacional));
  e.dias = z.dias;
  e.custoOperacionalTotal = e.custoOperacionalDia !== null && e.dias ? e.custoOperacionalDia * e.dias : null;
  const custoAlimDia = weighted(ls, (l) => calc(l).custoAlimentarDia);
  e.custoMSkg = pick('custoMSkg', informed(r.q52) !== null ? r.q52 / 1000 : null, custoAlimDia !== null && z.consMS ? custoAlimDia / z.consMS : null);
  e.consMS = z.consMS;
  e.custoAlimentarTotal = e.custoMSkg !== null && e.consMS !== null && e.dias ? e.consMS * e.custoMSkg * e.dias : null;
  e.frete = informed(r.q47) ?? 0;
  e.comissao = informed(r.q48) ?? 0;
  e.sanitario = informed(r.q50) ?? 0;
  e.rastreabilidade = informed(r.q49) ?? 0;
  e.mortalidade = (informed(femea ? r.q27 : r.q26) ?? 0) / 100;
  const base = (e.custoAlimentarTotal ?? 0) + (e.custoOperacionalTotal ?? 0);
  e.custoMortalidade = (base * 0.5 + (e.custoBoiMagro ?? 0) + e.frete + e.comissao + e.sanitario + e.rastreabilidade) * e.mortalidade;
  e.custoTotal = (e.custoBoiMagro ?? 0) + (e.custoOperacionalTotal ?? 0) + (e.custoAlimentarTotal ?? 0) + e.frete + e.comissao + e.sanitario + e.rastreabilidade + e.custoMortalidade;
  e.valorArroba = pick('valorArroba', femea ? r.q54 : r.q53, weighted(ls, (l) => calc(l).valorArrobaVenda));
  e.pesoSaidaArroba = z.pesoSaidaKg !== null && z.rc ? (z.pesoSaidaKg * (z.rc / 100)) / 15 : null;
  e.receita = e.valorArroba !== null && e.pesoSaidaArroba !== null ? e.valorArroba * e.pesoSaidaArroba : null;
  const ganhoArroba = e.pesoSaidaArroba !== null && e.pesoEntradaArroba !== null ? e.pesoSaidaArroba - e.pesoEntradaArroba : null;
  e.diariaAlimentar = e.custoAlimentarTotal !== null && e.dias ? e.custoAlimentarTotal / e.dias : null;
  e.diariaTotal = e.dias ? (e.custoTotal - (e.custoBoiMagro ?? 0)) / e.dias : null;
  e.custoArrobaAlimentar = e.custoAlimentarTotal !== null && ganhoArroba ? e.custoAlimentarTotal / ganhoArroba : null;
  e.custoTotalArroba = ganhoArroba ? (e.custoTotal - (e.custoBoiMagro ?? 0)) / ganhoArroba : null;
  e.lucro = e.receita !== null ? e.receita - e.custoTotal : null;
  e.rentabilidadeMensal = e.lucro !== null && e.custoTotal && e.dias ? ((1 + e.lucro / e.custoTotal) ** (1 / (e.dias / 30.4)) - 1) * 100 : null;
  e.foraPorteira = e.pesoEntradaArroba !== null && e.valorArroba !== null && e.custoBoiMagro !== null ? e.pesoEntradaArroba * e.valorArroba - e.custoBoiMagro : null;
  e.dentroPorteira = ganhoArroba !== null && e.valorArroba !== null ? ganhoArroba * e.valorArroba - (e.custoTotal - (e.custoBoiMagro ?? 0)) : null;
  e.pctForaPorteira = e.foraPorteira !== null && e.lucro ? e.foraPorteira / e.lucro : null;
  e.pctDentroPorteira = e.dentroPorteira !== null && e.lucro ? e.dentroPorteira / e.lucro : null;
  return { categoria, zootecnico: z, economico: e, fonte };
}

export function resultadoRecria(lotes, categoria) {
  const ls = lotes.filter((l) => l.categoria === categoria);
  const animais = ls.reduce((s, l) => s + (num(l.qtAnm) || 0), 0);
  if (!animais) return null;
  const z = { animais, lotes: ls.length };
  z.pesoEntradaKg = weighted(ls, (l) => num(l.pvEntrada));
  z.pesoSaidaKg = weighted(ls, (l) => num(l.pvSaida));
  z.dias = weighted(ls, (l) => num(l.diasTrato));
  z.rc = weighted(ls, (l) => num(l.rc) ?? calcLote(l).rc);
  z.gpd = z.pesoSaidaKg !== null && z.pesoEntradaKg !== null && z.dias ? (z.pesoSaidaKg - z.pesoEntradaKg) / z.dias : null;
  z.gdc = z.rc && z.dias ? (z.pesoSaidaKg * (z.rc / 100) - z.pesoEntradaKg * 0.5) / z.dias : null;
  z.arrobasProduzidas = z.rc ? (z.pesoSaidaKg * (z.rc / 100)) / 15 - (z.pesoEntradaKg * 0.5) / 15 : null;
  z.consMS = weighted(ls, (l) => num(l.consMS));
  z.consMSpct = z.consMS !== null && z.pesoEntradaKg !== null && z.pesoSaidaKg !== null ? (z.consMS / ((z.pesoEntradaKg + z.pesoSaidaKg) / 2)) * 100 : null;
  z.eficiencia = z.consMS !== null && z.dias && z.arrobasProduzidas ? (z.consMS * z.dias) / z.arrobasProduzidas : null;
  z.conversao = z.consMS !== null && z.gpd ? z.consMS / z.gpd : null;
  return { categoria, zootecnico: z };
}

export const ZOO_RESULT_ROWS = [
  ['animais', 'Número de animais', 0],
  ['lotes', 'Número de lotes', 0],
  ['pesoEntradaKg', 'Peso de entrada (kg)', 1],
  ['pesoSaidaKg', 'Peso de saída (kg)', 1],
  ['dias', 'Dias de cocho', 0],
  ['gpd', 'Ganho de peso diário (kg/dia)', 3],
  ['gdc', 'Ganho diário de carcaça (kg/dia)', 3],
  ['rc', 'Rendimento de carcaça (%)', 2],
  ['arrobasProduzidas', 'Arrobas produzidas', 2],
  ['consMS', 'Consumo de matéria seca (kg/dia)', 2],
  ['consMSpct', 'Consumo de matéria seca (% PV)', 2],
  ['eficiencia', 'Eficiência biológica (kgMS/@)', 1],
  ['conversao', 'Conversão alimentar (kg/kg)', 2],
];

export const ECO_RESULT_ROWS = [
  ['custoArrobaMagro', 'Custo da @ do boi magro (R$)', 2, 'custoArrobaMagro'],
  ['pesoEntradaArroba', 'Peso de entrada (@)', 2],
  ['custoBoiMagro', 'Custo total do boi magro (R$)', 2],
  ['custoOperacionalDia', 'Custo operacional (R$/cab/dia)', 2, 'custoOperacionalDia'],
  ['custoOperacionalTotal', 'Custo operacional total (R$)', 2],
  ['custoMSkg', 'Custo da matéria seca (R$/kg)', 3, 'custoMSkg'],
  ['custoAlimentarTotal', 'Custo alimentar total (R$)', 2],
  ['frete', 'Frete (R$/cab)', 2],
  ['comissao', 'Comissão (R$/cab)', 2],
  ['sanitario', 'Protocolo sanitário (R$/cab)', 2],
  ['rastreabilidade', 'Rastreabilidade (R$/cab)', 2],
  ['custoMortalidade', 'Custo da mortalidade (R$/cab)', 2],
  ['custoTotal', 'Custo total (R$/cab)', 2],
  ['valorArroba', 'Valor da @ de venda (R$)', 2, 'valorArroba'],
  ['pesoSaidaArroba', 'Peso de saída (@)', 2],
  ['receita', 'Receita bruta (R$/cab)', 2],
  ['diariaAlimentar', 'Custo da diária alimentar (R$)', 2],
  ['diariaTotal', 'Custo da diária total (R$)', 2],
  ['custoArrobaAlimentar', 'Custo da @ alimentar (R$)', 2],
  ['custoTotalArroba', 'Custo total da @ produzida (R$)', 2],
  ['lucro', 'Lucro (R$/cab)', 2],
  ['rentabilidadeMensal', 'Rentabilidade mensal (%)', 2],
  ['foraPorteira', 'Fora da porteira (R$/cab)', 2],
  ['dentroPorteira', 'Dentro da porteira (R$/cab)', 2],
];

// ---------- TGC: relatório por animal → lotes ----------
// O TGC exporta uma linha por animal (aba BD_TGC_Conf da planilha). A planilha juntava os
// animais por LOTE_SAIDA numa tabela dinâmica (BD_Zootec_TGC / BD_Econom_TGC): contagem de
// animais e MÉDIA de cada coluna. Aqui é a mesma conta. As colunas são achadas pelo nome do
// cabeçalho (sem acento, espaço ou símbolo), então a ordem da exportação não importa.

export const tgcHeader = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

// Campo do lote ← coluna do TGC. media: média dos animais; moda: valor mais comum;
// totalLote: média por cabeça × animais (os campos econômicos do lote são totais, como no Feed Manager).
const TGC_MAP = [
  ['curral', 'ULTIMOCURRAL', 'moda'],
  ['raca', 'RACA', 'moda'],
  ['categoria', 'CATEGORIA', 'moda'],
  ['saida', 'DATADESAIDA', 'data'],
  ['pvEntrada', 'PESOENTRADAKG', 'media', 1],
  ['pvSaida', 'PESOSAIDAKG', 'media', 1],
  ['pesoCarc', 'PESOSAIDACARCACA', 'media', 1],
  ['rc', 'RENDIMENTOCARCACASAIDA', 'rc', 2],
  ['gpd', 'GANHODEPESODIAKG', 'media', 3],
  ['ganhoArroba', 'PRODUZIDACAB', 'media', 2],
  ['diasConf', 'DIASCONFCAB', 'media', 0],
  // A tabela dinâmica usa os dias de confinamento como dias de trato (GPD e conversão).
  ['diasTrato', 'DIASCONFCAB', 'media', 0],
  ['totalDiarias', 'DIARIASALIMENTARTOTAL', 'media', 1],
  ['consMO', 'CONSUMOMNCABDIA', 'media', 2],
  ['consMS', 'CONSUMOMSCABDIA', 'media', 2],
  ['consMSpctPV', 'IMSPV', 'media', 2],
  ['eficAlim', 'EFICIENCIABIOLOGICA', 'media', 1],
  ['convAlim', 'CONVERSAOALIMENTAR', 'media', 2],
  ['valorEntradaCab', 'CUSTOCOMPRABOIMAGROCAB', 'media', 2],
  ['freteCab', 'CUSTOFRETECAB', 'media', 2],
  ['valorSaidaCab', 'RECEITACAB', 'media', 2],
  ['custoTotalTrato', 'CUSTOALIMENTARCABPERIODO', 'totalLote', 2],
  ['custoTotalLote', 'CUSTOTOTALCABPERIODO', 'totalLote', 2],
  ['valorTotalVenda', 'RECEITACAB', 'totalLote', 2],
];
export const TGC_LOTE = 'LOTESAIDA';

// Data do TGC (qualquer formato que parseDate lê) → milissegundos UTC.
function tgcDateMs(v) {
  const iso = parseDate(v);
  return iso ? Date.parse(`${iso}T00:00:00Z`) : null;
}

// animais: linhas do relatório com as chaves já normalizadas por tgcHeader.
// Devolve { lotes, animais, semLote, faltando: colunas esperadas que não vieram }.
export function lotesFromTgc(animais) {
  const presentes = new Set(animais.flatMap((a) => Object.keys(a)));
  const faltando = [...new Set(TGC_MAP.map(([, col]) => col))].filter((c) => !presentes.has(c));
  const grupos = new Map();
  let semLote = 0;
  for (const a of animais) {
    const lote = String(a[TGC_LOTE] ?? '').trim();
    if (!lote) {
      semLote += 1;
      continue;
    }
    if (!grupos.has(lote)) grupos.set(lote, []);
    grupos.get(lote).push(a);
  }
  const round = (v, d) => (v === null ? null : Number(v.toFixed(d)));
  const lotes = [...grupos].map(([lote, rows]) => {
    const qt = rows.length;
    const media = (col) => {
      const vals = rows.map((r) => toNumber(r[col])).filter((v) => v !== null && Number.isFinite(v));
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    };
    const l = { lote, qtAnm: qt };
    for (const [key, col, how, d] of TGC_MAP) {
      if (how === 'moda') {
        const count = new Map();
        for (const r of rows) {
          const v = String(r[col] ?? '').trim();
          if (v) count.set(v, (count.get(v) || 0) + 1);
        }
        const top = [...count].sort((a, b) => b[1] - a[1])[0];
        if (top) l[key] = top[0];
      } else if (how === 'data') {
        const ms = rows.map((r) => tgcDateMs(r[col])).filter((v) => v !== null);
        if (ms.length) l[key] = new Date(Math.round(ms.reduce((s, v) => s + v, 0) / ms.length / 86400000) * 86400000).toISOString().slice(0, 10);
      } else {
        let v = media(col);
        // Rendimento às vezes vem em fração (0,55): no lote é em % (55).
        if (how === 'rc' && v !== null && v <= 1.5) v *= 100;
        if (how === 'totalLote' && v !== null) v *= qt;
        if (v !== null) l[key] = round(v, d);
      }
    }
    // Custo total de manejo = alimentar + fixo do período (o custo operacional da tabela dinâmica é o fixo).
    const alim = media('CUSTOALIMENTARCABPERIODO');
    const fixo = media('CUSTOFIXOCABPERIODO');
    if (alim !== null || fixo !== null) l.custoTotalManejo = round(((alim ?? 0) + (fixo ?? 0)) * qt, 2);
    return l;
  });
  return { lotes, animais: animais.length - semLote, semLote, faltando };
}

// ---------- Cargill Feed Manager: relatório de fechamento individual → lotes ----------
// O Cargill Feed Manager (o novo, não o Feed Manager antigo das abas BD_Zootec_Feed) exporta o
// "Relatório de fechamento individual": um animal por linha, cabeçalho depois de 3 linhas de título.
// Diferenças para o TGC: traz os animais mortos (coluna "Causa da morte conf") e rendimento e
// IMS vêm em fração (0,558). Cada lote (coluna "LOTE Saída confinamento") vira:
//   - animais = todas as linhas; mortes = linhas com causa de morte;
//   - zootécnico = média dos animais vendidos (carcaça, rendimento, @ produzida e eficiência só
//     dos que têm peso de carcaça: alguns vendidos vêm com carcaça 0, sem abate registrado);
//   - eficiência e conversão alimentar no lote: consumo total de MS ÷ @ produzidas (ou kg ganhos),
//     como num relatório por lote (a média das razões de cada animal se afasta do recalculado);
//   - econômico por cabeça = média; totais do lote = soma de todos os animais (os mortos também
//     custaram). Custo de manejo = alimentar + fixo, como no TGC;
//   - "lotes" só com animais mortos (o programa põe os mortos num lote de saída próprio) não viram
//     lote: são contados à parte (soMortes) para a tela avisar.
export const CFM_LOTE = 'LOTESAIDACONFINAMENTO';
const CFM_CAUSA = 'CAUSADAMORTECONF';
// Colunas usadas na conta (cabeçalhos normalizados por tgcHeader).
const CFM_COLS = {
  categoria: 'CATEGORIA',
  raca: 'RACA',
  cadastro: 'TIPODECADASTRO',
  saida: 'DATADESAIDACONF',
  pvEntrada: ['PESOPROCESSAMENTOKG', 'PESOBALANCAOKG'],
  pvSaida: 'PESOSAIDACONFKG',
  pesoCarc: 'PESOSAIDACARCACAKG',
  rc: 'RENDIMENTOCARCACASAIDACONF',
  ganhoArroba: 'PRODUZIDACABCONF',
  dias: 'DIASCONFCAB',
  totalDiarias: 'DIARIASALIMENTARTOTAL',
  gpd: 'GANHODEPESODIAKG',
  consMO: 'CONSUMOMNKGCABDIA',
  consMS: 'CONSUMOMSKGCABDIA',
  ims: 'IMSPV',
  msTotal: 'CONSUMOMSTOTALKGCABPERIODO',
  entrada: 'CUSTODEENTRADAANIMALRCAB',
  frete: 'CUSTOFRETERCAB',
  comissao: 'COMISSAOCOMPRARCAB',
  receita: 'RECEITARCAB',
  alimentar: 'CUSTOALIMENTARRCABPERIODO',
  fixo: 'CUSTOFIXORCABPERIODO',
  sanidade: 'CUSTOSANIDADERCABPERIODOCONF',
  outros: 'OUTROSCUSTOSRCABPERIODOCONF',
  total: 'CUSTOTOTALRCABPERIODOCONF',
};
// "Tipo de Cadastro" → origem do lote (só quando dá para saber: "Da fazenda" pode ser recria a pasto ou confinada).
const CFM_ORIGEM = { compra: 'Compra Direta' };

export function lotesFromCfm(animais) {
  const presentes = new Set(animais.flatMap((a) => Object.keys(a)));
  const faltando = [CFM_CAUSA, ...Object.values(CFM_COLS).map((c) => (Array.isArray(c) ? c[0] : c))].filter((c) => !presentes.has(c) && !(c === 'PESOPROCESSAMENTOKG' && presentes.has('PESOBALANCAOKG')));
  const col = (k) => {
    const c = CFM_COLS[k];
    return Array.isArray(c) ? c.find((x) => presentes.has(x)) || c[0] : c;
  };
  const val = (r, k) => {
    const n = toNumber(r[col(k)]);
    return n !== null && Number.isFinite(n) ? n : null;
  };
  const grupos = new Map();
  let semLote = 0;
  for (const a of animais) {
    const lote = String(a[CFM_LOTE] ?? '').trim();
    if (!lote || lote === '-') {
      semLote += 1;
      continue;
    }
    if (!grupos.has(lote)) grupos.set(lote, []);
    grupos.get(lote).push(a);
  }
  const round = (v, d) => (v === null ? null : Number(v.toFixed(d)));
  const mean = (rows, k, keep = () => true) => {
    const vals = rows.map((r) => val(r, k)).filter((v) => v !== null && keep(v));
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const sum = (rows, ...ks) => {
    let any = false;
    const total = rows.reduce((s, r) => s + ks.reduce((t, k) => {
      const v = val(r, k);
      if (v !== null) any = true;
      return t + (v ?? 0);
    }, 0), 0);
    return any ? total : null;
  };
  const moda = (rows, key) => {
    const count = new Map();
    for (const r of rows) {
      const v = String(r[key] ?? '').trim();
      if (v && v !== '0' && v !== '-') count.set(v, (count.get(v) || 0) + 1);
    }
    return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const pct = (v) => (v !== null && v <= 1.5 ? v * 100 : v); // fração → %
  let mortesTotal = 0;
  const soMortes = { lotes: 0, animais: 0 };
  const isMorte = (r) => /MORTE/i.test(String(r[CFM_CAUSA] ?? ''));
  const lotes = [...grupos].flatMap(([lote, rows]) => {
    const mortos = rows.filter(isMorte);
    const vendidos = rows.filter((r) => !isMorte(r));
    if (!vendidos.length) {
      soMortes.lotes += 1;
      soMortes.animais += rows.length;
      return [];
    }
    const abatidos = vendidos.filter((r) => (val(r, 'pesoCarc') ?? 0) > 0);
    mortesTotal += mortos.length;
    const l = { lote, qtAnm: rows.length };
    if (presentes.has(CFM_CAUSA)) l.mortes = mortos.length;
    const set = (key, v, d) => {
      if (v !== null && v !== undefined && Number.isFinite(v)) l[key] = round(v, d);
    };
    const categoria = moda(rows, col('categoria'));
    const raca = moda(rows, col('raca'));
    if (categoria) l.categoria = categoria;
    if (raca) l.raca = raca;
    const origem = CFM_ORIGEM[String(moda(rows, col('cadastro')) || '').toLowerCase()];
    if (origem) l.origem = origem;
    const ms = vendidos.map((r) => tgcDateMs(r[col('saida')])).filter((v) => v !== null);
    if (ms.length) l.saida = new Date(Math.round(ms.reduce((s, v) => s + v, 0) / ms.length / 86400000) * 86400000).toISOString().slice(0, 10);
    set('pvEntrada', mean(vendidos, 'pvEntrada', (v) => v > 0), 1);
    set('pvSaida', mean(vendidos, 'pvSaida', (v) => v > 0), 1);
    set('pesoCarc', mean(abatidos, 'pesoCarc'), 1);
    set('rc', pct(mean(abatidos, 'rc', (v) => v > 0)), 2);
    set('ganhoArroba', mean(abatidos, 'ganhoArroba'), 2);
    set('gpd', mean(vendidos, 'gpd'), 3);
    const dias = mean(vendidos, 'dias', (v) => v > 0);
    set('diasConf', dias, 0);
    set('diasTrato', dias, 0); // como no TGC: os dias de confinamento são os dias de trato
    set('totalDiarias', mean(vendidos, 'totalDiarias', (v) => v > 0), 1);
    set('consMO', mean(vendidos, 'consMO', (v) => v > 0), 2);
    set('consMS', mean(vendidos, 'consMS', (v) => v > 0), 2);
    const ims = mean(vendidos, 'ims', (v) => v > 0);
    set('consMSpctPV', ims !== null && ims < 1 ? ims * 100 : ims, 2);
    const ratio = (rows2, num, den) => {
      const n = rows2.reduce((t, r) => t + (num(r) ?? 0), 0);
      const d = rows2.reduce((t, r) => t + (den(r) ?? 0), 0);
      return n > 0 && d > 0 ? n / d : null;
    };
    set('eficAlim', ratio(abatidos, (r) => val(r, 'msTotal'), (r) => val(r, 'ganhoArroba')), 1);
    set('convAlim', ratio(vendidos, (r) => val(r, 'msTotal'), (r) => (val(r, 'pvSaida') > 0 && val(r, 'pvEntrada') > 0 ? val(r, 'pvSaida') - val(r, 'pvEntrada') : null)), 2);
    // Econômico.
    set('valorEntradaCab', mean(rows, 'entrada'), 2);
    set('freteCab', mean(rows, 'frete'), 2);
    set('comissaoCab', mean(rows, 'comissao'), 2);
    set('valorSaidaCab', mean(vendidos, 'receita', (v) => v > 0), 2);
    set('custoTotalTrato', sum(rows, 'alimentar'), 2);
    set('custoTotalManejo', sum(rows, 'alimentar', 'fixo'), 2);
    const extra = sum(rows, 'sanidade', 'outros');
    if (extra) set('custoTotalExtra', extra, 2);
    set('custoTotalLote', sum(rows, 'total'), 2);
    set('valorTotalVenda', sum(rows, 'receita'), 2);
    return [l];
  });
  return { lotes, animais: animais.length - semLote, semLote, mortes: mortesTotal + soMortes.animais, soMortes, faltando };
}

// Ordem das colunas da planilha original (para colar do Excel / importar o arquivo).
export const COLUNAS_ZOO = ZOO_FIELDS.filter((f) => f.col).sort((a, b) => colIndex(a.col) - colIndex(b.col));
export const COLUNAS_ECO = [{ key: 'lote', col: 'A' }, ...ECO_FIELDS].sort((a, b) => colIndex(a.col) - colIndex(b.col));
export function colIndex(col) {
  return [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

export const STATUS = {
  rascunho: { label: 'Em preenchimento', cls: 'neutral' },
  enviado: { label: 'Enviado para validação', cls: 'warn' },
  correcao: { label: 'Devolvido para correção', cls: 'crit' },
  aprovado: { label: 'Aprovado', cls: 'ok' },
};
export const editableStatus = (status) => status === 'rascunho' || status === 'correcao';

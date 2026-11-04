// 4M Fornecedores: importa a planilha de desempenho por fornecedor (média e CV de cada medida),
// calcula o desvio padrão, o resultado econômico nos quatro modelos do 4M e o risco (Monte Carlo).
// Cálculo em model.js; a planilha é lida no navegador com SheetJS (/vendor/xlsx.full.min.js).
import { api, h, toast } from '/js/common.js';
import { initNps } from '/js/nps.js';
import { initTicker } from '/js/ticker.js';
import { MEASURES, MODELS, alertasDe, defaultEcon, defaultRisk, econ, meanZ, parseSheet, sdOf, simulate, weighted } from './model.js';

const dialog = document.getElementById('dialog');
const panel = (name) => document.querySelector(`[data-panel="${name}"]`);

const state = {
  tab: 'planilha',
  fileName: '',
  sheets: [], // [{ unidade, hasCms, cmsPctPV }]
  suppliers: [],
  excluded: new Set(),
  unidade: 'todas',
  E: defaultEcon(),
  R: defaultRisk(),
  model: 'bp',
  persp: 'confinamento',
  risk: null, // { key, results: Map(id → simulação) }
  sel: null, // fornecedor em detalhe no Risco
  busca: '', // filtro por nome nas abas Econômico e Risco
  sim: null, // análise salva aberta
};

// ---------- Formatação ----------

const nf = (dec) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmt = (v, dec = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : nf(dec).format(v));
const brl = (v) => fmt(v, 2);
const parseNum = (s) => {
  const t = String(s ?? '').trim().replace(/\s/g, '');
  if (!t) return NaN;
  return Number(/,/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t);
};
const modelName = (id) => MODELS.find((m) => m.id === id).name;
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- Fornecedores visíveis ----------

const inUnit = (s) => state.unidade === 'todas' || s.unidade === state.unidade;
const semAcento = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Busca por parte do nome (sem acento e sem diferenciar maiúscula); vários termos precisam aparecer todos.
const matches = (s) => semAcento(state.busca).split(/\s+/).filter(Boolean).every((t) => semAcento(`${s.nome} ${s.unidade}`).includes(t));
const included = () => state.suppliers.filter((s) => inUnit(s) && !state.excluded.has(s.id));
const hasCms = () => state.sheets.some((sh) => sh.hasCms);
const persp = () => (state.model === 'bp' ? 'confinamento' : state.persp);

// ---------- Campos ----------

// Número no campo: vírgula decimal, sem separador de milhar (para editar sem tropeçar).
const asInput = (v, dec) => fmt(v, dec ?? (Number.isInteger(v) ? 0 : 2)).replace(/\./g, '');

function numField(obj, key, label, suffix, onChange, opts = {}) {
  const input = h('input', { type: 'text', inputmode: 'decimal', value: asInput(obj[key], opts.dec) });
  input.addEventListener('change', () => {
    const v = parseNum(input.value);
    if (!Number.isFinite(v) || (opts.min !== undefined && v < opts.min) || (opts.max !== undefined && v > opts.max)) {
      toast(`Valor inválido em "${label}".`, 'error');
      input.value = asInput(obj[key], opts.dec);
      return;
    }
    obj[key] = v;
    onChange();
  });
  return h('label', { class: 'field' }, h('span', {}, label), h('span', { class: 'fz-input' }, input, h('span', { class: 'fz-suffix' }, suffix)), opts.hint ? h('small', {}, opts.hint) : null);
}

function selectField(obj, key, label, options, onChange) {
  const sel = h(
    'select',
    { onchange: (e) => ((obj[key] = options.find((o) => String(o[0]) === e.target.value)[0]), onChange()) },
    options.map(([v, t]) => h('option', { value: String(v), selected: obj[key] === v }, t)),
  );
  return h('label', { class: 'field' }, h('span', {}, label), sel);
}

function seg(options, current, onPick, disabled = false) {
  return h(
    'div',
    { class: `fz-seg${disabled ? ' disabled' : ''}`, role: 'group' },
    options.map(([v, t]) => h('button', { type: 'button', class: v === current ? 'on' : '', disabled, 'aria-pressed': String(v === current), onclick: () => onPick(v) }, t)),
  );
}

function unitFilter(onChange) {
  if (state.sheets.length < 2) return null;
  return h(
    'label',
    { class: 'fz-inline' },
    h('span', {}, 'Unidade'),
    h(
      'select',
      { onchange: (e) => ((state.unidade = e.target.value), onChange()) },
      h('option', { value: 'todas', selected: state.unidade === 'todas' }, 'Todas'),
      state.sheets.map((sh) => h('option', { value: sh.unidade, selected: state.unidade === sh.unidade }, sh.unidade)),
    ),
  );
}

// Modelo de negócio e de qual lado olhar (compartilhado entre Econômico e Risco).
let searchTimer = null;
function modelBar(onChange, onSearch) {
  const busca = h('input', {
    type: 'search',
    value: state.busca,
    placeholder: 'Nome ou parte do nome',
    'aria-label': 'Procurar fornecedor',
    oninput: (e) => {
      state.busca = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(onSearch, 150);
    },
  });
  return h(
    'div',
    { class: 'fz-modelbar' },
    h('div', {}, h('span', { class: 'fz-label' }, 'Modelo de negócio'), seg(MODELS.map((m) => [m.id, m.name]), state.model, (v) => ((state.model = v), onChange()))),
    h(
      'div',
      {},
      h('span', { class: 'fz-label' }, 'Resultado de quem'),
      seg(
        [
          ['confinamento', 'Confinamento'],
          ['parceiro', 'Parceiro (dono do boi)'],
        ],
        persp(),
        (v) => ((state.persp = v), onChange()),
        state.model === 'bp',
      ),
    ),
    unitFilter(onChange),
    h('label', { class: 'fz-inline fz-search' }, h('span', {}, 'Procurar fornecedor'), busca),
  );
}

// ---------- 1. Planilha ----------

function emptyState(text) {
  return h('div', { class: 'fz-card fz-empty' }, h('p', {}, text), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => selectTab('planilha') }, 'Ir para a planilha'));
}

function renderPlanilha() {
  const file = h('input', { type: 'file', accept: '.xlsx,.xls,.xlsb,.csv', hidden: true, onchange: () => importFile(file) });
  const head = h(
    'div',
    { class: 'fz-card' },
    h(
      'div',
      { class: 'fz-card-head' },
      h('div', {}, h('h2', {}, 'Planilha de desempenho por fornecedor'), h('p', { class: 'muted' }, state.fileName ? `Arquivo: ${state.fileName}` : 'Uma aba por unidade, uma linha por fornecedor, com a média e o CV (%) de cada medida.')),
      h('div', { class: 'viewer-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: downloadModelo }, 'Baixar modelo'), h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => file.click() }, state.suppliers.length ? 'Importar outra planilha' : 'Importar planilha'), file),
    ),
    h(
      'p',
      { class: 'fz-note' },
      'Colunas lidas pelo nome: Fornecedor, N de Cabeças, Peso de Entrada, GMD, GDC, Rendimento de Carcaça, Arrobas Produzidas, Dias de Confinamento e CMS (kg MS/dia ou % do PV), cada uma com a coluna "CV ..." ao lado. O desvio padrão (DP) é a média × CV.',
    ),
    state.suppliers.length && !hasCms() ? h('p', { class: 'fz-callout' }, `A planilha não tem CMS: o consumo sai de ${fmt(state.E.cmsPctPV, 1)}% do peso vivo médio (ajuste em Econômico).`) : null,
  );
  if (!state.suppliers.length) return panel('planilha').replaceChildren(head);

  const list = state.suppliers.filter(inUnit);
  const shown = MEASURES.filter((m) => m.key !== 'cms' || hasCms());
  const toggle = (s, on) => {
    if (on) state.excluded.delete(s.id);
    else state.excluded.add(s.id);
    state.risk = null;
    renderPlanilha();
  };
  const cell = (s, m) => {
    const x = s[m.key];
    if (x.m === null) return h('td', { class: 'fz-num muted' }, '—');
    const unit = m.key === 'cms' && s.cmsPctPV ? '% PV' : '';
    return h('td', { class: 'fz-num' }, h('span', {}, fmt(x.m, m.dec), unit ? ` ${unit}` : ''), h('span', { class: 'sub' }, x.cv === null ? 'sem CV' : `± ${fmt(sdOf(x), m.dec)} · CV ${fmt(x.cv, 1)}%`));
  };
  const avgRow = (label, rows) =>
    h(
      'tr',
      { class: 'fz-total' },
      h('td', {}),
      h('td', { colspan: 2 }, h('strong', {}, label), h('span', { class: 'sub' }, 'média ponderada pelas cabeças')),
      h('td', { class: 'fz-num' }, fmt(rows.reduce((a, s) => a + (s.n || 0), 0), 0)),
      shown.map((m) => h('td', { class: 'fz-num' }, fmt(weighted(rows, (s) => s[m.key].m), m.dec))),
    );
  const units = state.unidade === 'todas' ? state.sheets.map((sh) => sh.unidade) : [state.unidade];
  const inc = included();
  const table = h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'fz-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Usar'), h('th', {}, 'Unidade'), h('th', {}, 'Fornecedor'), h('th', {}, 'Cab.'), shown.map((m) => h('th', {}, m.label, h('span', { class: 'fz-th-unit' }, m.key === 'cms' && state.suppliers.some((s) => s.cmsPctPV) ? '% PV' : m.unit))))),
      h(
        'tbody',
        {},
        list.map((s) =>
          h(
            'tr',
            { class: state.excluded.has(s.id) ? 'off' : '' },
            h('td', {}, h('input', { type: 'checkbox', checked: !state.excluded.has(s.id), 'aria-label': `Usar ${s.nome}`, onchange: (e) => toggle(s, e.target.checked) })),
            h('td', {}, s.unidade),
            h('td', { class: 'fz-name' }, h('strong', {}, s.nome), s.alertas.length ? h('span', { class: 'sub fz-warn' }, s.alertas.join(' · ')) : null),
            h('td', { class: 'fz-num' }, fmt(s.n, 0)),
            shown.map((m) => cell(s, m)),
          ),
        ),
        units.map((u) => {
          const rows = inc.filter((s) => s.unidade === u);
          return rows.length ? avgRow(`${u} (${rows.length} fornecedores usados)`, rows) : null;
        }),
      ),
    ),
  );
  const flagged = list.filter((s) => s.alertas.length).length;
  panel('planilha').replaceChildren(
    head,
    h(
      'div',
      { class: 'fz-card' },
      h(
        'div',
        { class: 'fz-card-head' },
        h('div', {}, h('h2', {}, `${inc.length} de ${list.length} fornecedores em uso`), flagged ? h('p', { class: 'muted' }, `${flagged} com dados fora do esperado vieram desmarcados. Marque se quiser usar mesmo assim.`) : null),
        unitFilter(renderPlanilha),
      ),
      table,
    ),
  );
}

async function importFile(input) {
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  try {
    const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const parsed = wb.SheetNames.map((n) => parseSheet(window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }), n)).filter((p) => p.suppliers.length || p.error);
    const ok = parsed.filter((p) => p.suppliers.length);
    if (!ok.length) throw new Error(parsed.map((p) => p.error).filter(Boolean)[0] || 'Nenhum fornecedor encontrado na planilha.');
    state.fileName = f.name;
    state.sheets = ok.map((p) => ({ unidade: p.unidade, hasCms: p.hasCms, cmsPctPV: p.cmsPctPV }));
    state.suppliers = ok.flatMap((p) => p.suppliers);
    state.excluded = new Set(state.suppliers.filter((s) => s.alertas.length).map((s) => s.id));
    state.unidade = 'todas';
    state.risk = null;
    state.sel = null;
    const skipped = parsed.filter((p) => p.error).map((p) => p.error);
    toast(`${state.suppliers.length} fornecedores importados${skipped.length ? `. Abas ignoradas: ${skipped.join(' ')}` : ''}.`);
    renderPlanilha();
  } catch (err) {
    toast(`Não foi possível ler a planilha: ${err.message}`, 'error');
  }
}

// Modelo com as mesmas colunas da planilha de médias ponderadas, mais o CMS.
function downloadModelo() {
  const head = ['Fornecedor', 'N de Cabeças'];
  const labels = { pe: 'Peso de Entrada (kg)', gmd: 'GMD (kg/dia)', gdc: 'GDC (kg/dia)', rc: 'Rendimento de Carcaça (%)', arrobas: 'Arrobas Produzidas (@/cab)', dias: 'Dias de Confinamento', cms: 'CMS (kg MS/dia)' };
  for (const m of MEASURES) head.push(labels[m.key], `CV ${labels[m.key]} (%)`);
  const exemplo = ['FORNECEDOR EXEMPLO', 120, 340, 12, 1.4, 22, 0.9, 21, 54.5, 3.5, 6.5, 21, 110, 5, 9.5, 10];
  const ws = window.XLSX.utils.aoa_to_sheet([head, exemplo]);
  ws['!cols'] = head.map((t, i) => ({ wch: i === 0 ? 34 : Math.max(12, t.length * 0.8) }));
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, 'Unidade 1');
  window.XLSX.writeFile(wb, 'modelo-4M-fornecedores.xlsx');
}

// ---------- 2. Econômico ----------

const QUEM = [
  ['Confinamento', 'Confinamento'],
  ['Parceiro', 'Parceiro'],
];

function econForm() {
  const E = state.E;
  const changed = () => ((state.risk = null), renderEconResults());
  const f = (key, label, suffix, opts) => numField(E, key, label, suffix, changed, opts);
  const yes = (key, label) => selectField(E, key, label, [[false, 'Não'], [true, 'Sim']], changed);
  const group = (title, ...fields) => h('div', { class: 'fz-group' }, h('h3', {}, title), h('div', { class: 'fz-fields' }, fields));
  return h(
    'div',
    { class: 'fz-card' },
    h('h2', {}, 'Valores econômicos'),
    h(
      'div',
      { class: 'fz-groups' },
      group(
        'Compra e venda',
        f('precoCompra', 'Boi magro', 'R$/@', { min: 0 }),
        f('precoVenda', 'Venda do boi gordo', 'R$/@', { min: 0 }),
        f('rci', 'Rendimento na entrada', '%', { min: 30, max: 70, hint: 'A planilha usa 50% nas @ produzidas.' }),
        f('bonus', 'Bonificação na venda', 'R$/@', { min: 0 }),
        f('minDiasBonus', 'Mínimo de dias p/ bônus', 'dias', { min: 0, dec: 0 }),
        selectField(E, 'venda', 'Recebimento da venda', [['vista', 'À vista'], ['30', '30 dias']], changed),
      ),
      group(
        'Custos de engorda',
        f('custoOperacional', 'Operacional', 'R$/dia', { min: 0 }),
        f('diasAdap', 'Dias de adaptação', 'dias', { min: 0, dec: 0 }),
        f('dietaAdap', 'Dieta de adaptação', 'R$/t MS', { min: 0 }),
        f('dietaTerm', 'Dieta de terminação', 'R$/t MS', { min: 0 }),
        hasCms() ? null : f('cmsPctPV', 'CMS (planilha sem consumo)', '% PV', { min: 0.5, max: 5, hint: 'Sobre o peso vivo médio (entrada + saída) ÷ 2.' }),
        f('sanitario', 'Sanitário', 'R$/cab.', { min: 0 }),
        f('comissao', 'Comissão de compra', 'R$/cab.', { min: 0, hint: 'Só no Boi Próprio.' }),
      ),
      group(
        'Frete, processamento e mortalidade',
        f('frete', 'Frete', 'R$/cab.', { min: 0 }),
        selectField(E, 'quemFrete', 'Frete pago por', QUEM, changed),
        f('processamento', 'Processamento', 'R$/cab.', { min: 0 }),
        selectField(E, 'quemProc', 'Processamento pago por', QUEM, changed),
        f('mortalidade', 'Mortalidade', '%', { min: 0, max: 50 }),
        f('pctAlimMortos', 'Ração perdida por morto', '% do custo', { min: 0, max: 100 }),
        selectField(E, 'quemMort', 'Mortalidade arcada por', QUEM, changed),
      ),
      group(
        'Juros e modelos com parceiro',
        yes('jurosAlim', 'Juros sobre a alimentação'),
        yes('financGado', 'Financiamento do gado (Boi Próprio)'),
        f('taxa', 'Taxa de juros', '% a.a.', { min: 0 }),
        f('diariaBoitel', 'Diária do Boitel', 'R$/dia', { min: 0 }),
        f('valorArroba', 'Valor da @ produzida', 'R$/@', { min: 0 }),
        f('bonusParceiro', 'Bônus que fica com o parceiro', '% do bônus', { min: 0, max: 100, hint: 'Na Parceria, sobre as @ de entrada.' }),
      ),
    ),
  );
}

function econRows() {
  const p = persp();
  return included().map((s) => {
    const e = econ(meanZ(s), state.E, state.model);
    return { s, e, r: e[p] };
  });
}

function renderEconResults() {
  const box = document.getElementById('econ-results');
  if (!box) return;
  const all = econRows();
  const rows = all.filter((x) => matches(x.s)).sort((a, b) => b.r.lucro - a.r.lucro);
  const filtrado = rows.length < all.length;
  const p = persp();
  const cols = [
    ['Dias', (x) => fmt(x.s.dias.m, 0)],
    ['@ entrada', (x) => fmt(x.e.arEnt, 2)],
    ['@ saída', (x) => fmt(x.e.arSai, 2)],
    ['@ produzidas', (x) => fmt(x.e.arProd, 2)],
    ['CMS (kg/dia)', (x) => fmt(x.e.cms, 2)],
    ['Custo total (R$/cab.)', (x) => brl(x.r.custoTotal)],
    ['Receita (R$/cab.)', (x) => brl(x.r.receita)],
    ['Margem (R$/cab.)', (x) => brl(x.r.lucro), (x) => (x.r.lucro < 0 ? 'fz-neg' : '')],
    ['Rent. total (%)', (x) => fmt(x.r.rent, 2)],
    ['Rent. mensal (%)', (x) => fmt(x.r.rentMensal, 2)],
    [p === 'parceiro' ? 'Custo da @ (R$/@)' : 'Custo da @ produzida (R$/@)', (x) => brl(x.r.custoArroba)],
  ];
  const w = (get) => weighted(rows.map((x) => ({ n: x.s.n, v: get(x) })), (o) => o.v);
  const units = [...new Set(rows.map((x) => x.s.unidade))];
  box.replaceChildren(
    h(
      'div',
      { class: 'fz-card' },
      h('div', { class: 'fz-card-head' }, h('div', {}, h('h2', {}, `${modelName(state.model)} · resultado ${p === 'parceiro' ? 'do parceiro' : 'do confinamento'}`), h('p', { class: 'muted' }, filtrado ? `${rows.length} de ${all.length} fornecedores com "${state.busca.trim()}". Valores por cabeça, ordenados pela margem.` : 'Valores por cabeça, com as médias de cada fornecedor. Ordenado pela margem.'))),
      rows.length
        ? h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              { class: 'fz-table' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Fornecedor'), h('th', {}, 'Cab.'), cols.map(([t]) => h('th', {}, t)))),
              h(
                'tbody',
                {},
                rows.map((x) => h('tr', {}, h('td', { class: 'fz-name' }, h('strong', {}, x.s.nome), units.length > 1 ? h('span', { class: 'sub' }, x.s.unidade) : null), h('td', { class: 'fz-num' }, fmt(x.s.n, 0)), cols.map(([, get, cls]) => h('td', { class: `fz-num ${cls ? cls(x) : ''}` }, get(x))))),
                h(
                  'tr',
                  { class: 'fz-total' },
                  h('td', {}, h('strong', {}, 'Média ponderada'), h('span', { class: 'sub' }, filtrado ? `dos ${rows.length} encontrados, pelas cabeças` : 'pelas cabeças')),
                  h('td', { class: 'fz-num' }, fmt(rows.reduce((a, x) => a + (x.s.n || 0), 0), 0)),
                  h('td', { class: 'fz-num' }, fmt(w((x) => x.s.dias.m), 0)),
                  h('td', { class: 'fz-num' }, fmt(w((x) => x.e.arEnt), 2)),
                  h('td', { class: 'fz-num' }, fmt(w((x) => x.e.arSai), 2)),
                  h('td', { class: 'fz-num' }, fmt(w((x) => x.e.arProd), 2)),
                  h('td', { class: 'fz-num' }, fmt(w((x) => x.e.cms), 2)),
                  h('td', { class: 'fz-num' }, brl(w((x) => x.r.custoTotal))),
                  h('td', { class: 'fz-num' }, brl(w((x) => x.r.receita))),
                  h('td', { class: 'fz-num' }, brl(w((x) => x.r.lucro))),
                  h('td', { class: 'fz-num' }, fmt(w((x) => x.r.rent), 2)),
                  h('td', { class: 'fz-num' }, fmt(w((x) => x.r.rentMensal), 2)),
                  h('td', { class: 'fz-num' }, brl(w((x) => x.r.custoArroba))),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, all.length ? `Nenhum fornecedor encontrado com "${state.busca.trim()}".` : 'Nenhum fornecedor em uso nesta unidade.'),
    ),
  );
}

function renderEconomico() {
  if (!state.suppliers.length) return panel('economico').replaceChildren(emptyState('Importe a planilha de desempenho primeiro.'));
  panel('economico').replaceChildren(
    h('div', { class: 'fz-card' }, modelBar(() => ((state.risk = null), renderEconomico()), renderEconResults)),
    econForm(),
    h('div', { id: 'econ-results' }),
  );
  renderEconResults();
}

// ---------- 3. Risco ----------

let riskTimer = null;
const charts = {};

function riskKey() {
  return JSON.stringify([state.E, state.R, state.model, persp(), included().map((s) => s.id)]);
}

function runRisk() {
  const key = riskKey();
  if (state.risk?.key === key) return state.risk;
  const results = new Map();
  for (const s of included()) results.set(s.id, simulate(s, state.E, state.model, { ...state.R, perspectiva: persp() }));
  state.risk = { key, results };
  return state.risk;
}

function riskForm() {
  const R = state.R;
  const changed = () => {
    clearTimeout(riskTimer);
    riskTimer = setTimeout(renderRiskResults, 150);
  };
  const f = (key, label, suffix, opts) => numField(R, key, label, suffix, changed, opts);
  return h(
    'div',
    { class: 'fz-card' },
    h('h2', {}, 'Variação econômica e simulação'),
    h('p', { class: 'muted' }, 'As medidas zootécnicas variam pelo CV de cada fornecedor (peso de entrada, GMD, rendimento, dias e CMS). Aqui entra a variação dos preços e custos.'),
    h(
      'div',
      { class: 'fz-fields' },
      f('cvVenda', 'Variação do preço de venda', 'CV %', { min: 0, max: 50 }),
      f('cvCompra', 'Variação do boi magro', 'CV %', { min: 0, max: 50 }),
      f('corrPrecos', 'Correlação compra × venda', '−1 a 1', { min: -1, max: 1, hint: 'Quanto os dois preços andam juntos.' }),
      f('cvDieta', 'Variação do custo da dieta', 'CV %', { min: 0, max: 50 }),
      f('cvOperacional', 'Variação do operacional', 'CV %', { min: 0, max: 50 }),
      f('limite', 'Resultado mínimo aceitável', 'R$/cab.', { hint: 'Mostra a chance de ficar abaixo disso.' }),
      f('nSim', 'Simulações por fornecedor', 'n', { min: 500, max: 20000, dec: 0 }),
      selectField(R, 'nivel', 'Variação de', [['animal', 'Cada animal'], ['lote', 'Média do lote']], changed),
    ),
    h('p', { class: 'fz-note' }, '"Cada animal": a faixa mostra o resultado de um boi qualquer daquele fornecedor. "Média do lote": a variação entre animais é dividida pela raiz do número de cabeças, e a faixa mostra o resultado médio do lote.'),
  );
}

function destroyCharts() {
  for (const k of Object.keys(charts)) {
    charts[k]?.destroy();
    delete charts[k];
  }
}

function chartBase() {
  const ink = cssVar('--ink');
  const muted = cssVar('--muted');
  const line = cssVar('--line');
  return { ink, muted, line, font: { family: cssVar('--font-ui') || 'system-ui', size: 12 } };
}

// Faixa P5–P95 e a média de cada fornecedor, do melhor para o pior.
function rankingChart(canvas, rows) {
  const c = chartBase();
  const bar = cssVar('--chart-bar');
  const danger = cssVar('--danger');
  return new window.Chart(canvas, {
    data: {
      labels: rows.map((x) => x.s.nome),
      datasets: [
        { type: 'bar', label: 'Faixa de 90% (P5 a P95)', data: rows.map((x) => [x.r.p5, x.r.p95]), backgroundColor: `${bar}40`, borderColor: bar, borderWidth: 1, borderRadius: 4, barPercentage: 0.7, categoryPercentage: 0.9, maxBarThickness: 16 },
        { type: 'scatter', label: 'Média', data: rows.map((x, i) => ({ x: x.r.media, y: i })), backgroundColor: bar, borderColor: cssVar('--surface'), borderWidth: 2, pointRadius: 5, pointHoverRadius: 7 },
      ],
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { labels: { color: c.ink, font: c.font, boxWidth: 12 } },
        tooltip: {
          callbacks: {
            title: (items) => rows[items[0].dataIndex].s.nome,
            label: (item) => {
              const r = rows[item.dataIndex].r;
              return item.datasetIndex === 0 ? `P5 R$ ${brl(r.p5)} · P95 R$ ${brl(r.p95)}` : `Média R$ ${brl(r.media)} · ${fmt(r.probAbaixo, 1)}% abaixo de R$ ${brl(state.R.limite)}`;
            },
          },
        },
      },
      scales: {
        x: { title: { display: true, text: 'Resultado (R$/cab.)', color: c.muted, font: c.font }, ticks: { color: c.muted, font: c.font }, grid: { color: (ctx) => (ctx.tick?.value === 0 ? danger : c.line) } },
        y: { type: 'category', ticks: { color: c.ink, font: c.font, autoSkip: false }, grid: { display: false } },
      },
    },
  });
}

function histogramChart(canvas, sim) {
  const c = chartBase();
  const bar = cssVar('--chart-bar');
  const danger = cssVar('--danger');
  const values = sim.lucro;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const bins = 40;
  const step = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - lo) / step))] += 1;
  const mids = counts.map((_, i) => lo + step * (i + 0.5));
  return new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: mids.map((m) => fmt(m, 0)),
      datasets: [{ label: 'Simulações', data: counts.map((n) => (n / values.length) * 100), backgroundColor: mids.map((m) => (m < state.R.limite ? `${danger}cc` : `${bar}cc`)), borderRadius: 2, barPercentage: 1, categoryPercentage: 0.94 }],
    },
    options: {
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => `R$ ${brl(mids[items[0].dataIndex] - step / 2)} a ${brl(mids[items[0].dataIndex] + step / 2)}`, label: (item) => `${fmt(item.raw, 1)}% das simulações` } } },
      scales: {
        x: { title: { display: true, text: `Resultado (R$/cab.) · em vermelho, abaixo de R$ ${brl(state.R.limite)}`, color: c.muted, font: c.font }, ticks: { color: c.muted, font: c.font, maxTicksLimit: 8 }, grid: { display: false } },
        y: { title: { display: true, text: '% das simulações', color: c.muted, font: c.font }, ticks: { color: c.muted, font: c.font }, grid: { color: c.line } },
      },
    },
  });
}

function sensChart(canvas, sim) {
  const c = chartBase();
  const bar = cssVar('--chart-bar');
  const danger = cssVar('--danger');
  const rows = [...sim.sens].sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  return new window.Chart(canvas, {
    type: 'bar',
    data: { labels: rows.map((x) => x.label), datasets: [{ label: 'Correlação com o resultado', data: rows.map((x) => x.r), backgroundColor: rows.map((x) => (x.r < 0 ? danger : bar)), borderRadius: 4, barPercentage: 0.7 }] },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => `r = ${fmt(item.raw, 2)} (${item.raw < 0 ? 'quanto maior, pior o resultado' : 'quanto maior, melhor o resultado'})` } } },
      scales: { x: { min: -1, max: 1, title: { display: true, text: 'Correlação com o resultado (−1 a 1)', color: c.muted, font: c.font }, ticks: { color: c.muted, font: c.font }, grid: { color: c.line } }, y: { ticks: { color: c.ink, font: c.font }, grid: { display: false } } },
    },
  });
}

function renderRiskResults() {
  const box = document.getElementById('risk-results');
  if (!box) return;
  destroyCharts();
  const t0 = performance.now();
  const { results } = runRisk();
  const all = included()
    .map((s) => ({ s, r: results.get(s.id) }))
    .filter((x) => x.r);
  const rows = all.filter((x) => matches(x.s)).sort((a, b) => b.r.media - a.r.media);
  if (!rows.length) return box.replaceChildren(h('div', { class: 'fz-card' }, h('p', { class: 'muted' }, all.length ? `Nenhum fornecedor encontrado com "${state.busca.trim()}".` : 'Nenhum fornecedor em uso nesta unidade.')));
  const filtrado = rows.length < all.length;
  if (!state.sel || !rows.some((x) => x.s.id === state.sel)) state.sel = rows[0].s.id;
  const sel = rows.find((x) => x.s.id === state.sel);
  const units = [...new Set(rows.map((x) => x.s.unidade))];
  const p = persp();

  const rankCanvas = h('canvas', { role: 'img', 'aria-label': 'Faixa de resultado por fornecedor' });
  const histCanvas = h('canvas', { role: 'img', 'aria-label': `Distribuição do resultado de ${sel.s.nome}` });
  const sensCanvas = h('canvas', { role: 'img', 'aria-label': `O que mais pesa no resultado de ${sel.s.nome}` });
  const pick = (id) => {
    state.sel = id;
    renderRiskResults();
    document.getElementById('risk-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const ms = Math.round(performance.now() - t0);

  box.replaceChildren(
    h(
      'div',
      { class: 'fz-card' },
      h('div', { class: 'fz-card-head' }, h('div', {}, h('h2', {}, `Faixa de resultado por fornecedor · ${modelName(state.model)}, ${p === 'parceiro' ? 'parceiro' : 'confinamento'}`), h('p', { class: 'muted' }, `${filtrado ? `${rows.length} de ${all.length} fornecedores com "${state.busca.trim()}". ` : ''}Barra: 90% dos resultados simulados (P5 a P95). Ponto: média. ${fmt(state.R.nSim, 0)} simulações por fornecedor (${ms} ms).`))),
      h('div', { class: 'fz-chart', style: `height: ${Math.max(220, rows.length * 22 + 70)}px` }, rankCanvas),
    ),
    h(
      'div',
      { class: 'fz-card' },
      h('h2', {}, 'Tabela do risco'),
      h('p', { class: 'muted' }, 'Clique num fornecedor para ver a distribuição e o que mais pesa no resultado dele.'),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'fz-table' },
          h(
            'thead',
            {},
            h('tr', {}, h('th', {}, 'Fornecedor'), h('th', {}, 'Cab.'), h('th', {}, 'Média (R$/cab.)'), h('th', {}, 'DP'), h('th', {}, 'P5'), h('th', {}, 'P95'), h('th', {}, `Chance < R$ ${brl(state.R.limite)}`), h('th', {}, 'CV @ prod. simulado × planilha')),
          ),
          h(
            'tbody',
            {},
            rows.map((x) =>
              h(
                'tr',
                { class: `fz-click${x.s.id === state.sel ? ' sel' : ''}`, tabindex: 0, onclick: () => pick(x.s.id), onkeydown: (e) => e.key === 'Enter' && pick(x.s.id) },
                h('td', { class: 'fz-name' }, h('strong', {}, x.s.nome), units.length > 1 ? h('span', { class: 'sub' }, x.s.unidade) : null),
                h('td', { class: 'fz-num' }, fmt(x.s.n, 0)),
                h('td', { class: `fz-num ${x.r.media < 0 ? 'fz-neg' : ''}` }, brl(x.r.media)),
                h('td', { class: 'fz-num' }, brl(x.r.dp)),
                h('td', { class: `fz-num ${x.r.p5 < 0 ? 'fz-neg' : ''}` }, brl(x.r.p5)),
                h('td', { class: 'fz-num' }, brl(x.r.p95)),
                h('td', { class: `fz-num ${x.r.probAbaixo >= 20 ? 'fz-neg' : ''}` }, `${fmt(x.r.probAbaixo, 1)}%`),
                h('td', { class: 'fz-num' }, `${fmt(state.R.nivel === 'lote' ? NaN : x.r.cvArrobasSim, 1)}${state.R.nivel === 'lote' ? '' : '%'} × ${fmt(x.s.arrobas.cv, 1)}%`),
              ),
            ),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'fz-card', id: 'risk-detail' },
      h('h2', {}, sel.s.nome),
      h('p', { class: 'muted' }, `${sel.s.unidade} · ${fmt(sel.s.n, 0)} cabeças · média R$ ${brl(sel.r.media)}, DP R$ ${brl(sel.r.dp)} · ${fmt(sel.r.probAbaixo, 1)}% de chance de ficar abaixo de R$ ${brl(state.R.limite)}`),
      h(
        'div',
        { class: 'fz-detail' },
        h('div', {}, h('h3', {}, 'Distribuição do resultado'), h('div', { class: 'fz-chart', style: 'height: 280px' }, histCanvas)),
        h('div', {}, h('h3', {}, 'O que mais pesa no resultado'), h('div', { class: 'fz-chart', style: 'height: 280px' }, sensCanvas), h('p', { class: 'fz-note' }, 'Correlação de cada fator sorteado com o resultado: perto de 1 ou de −1, ele explica boa parte do risco; perto de 0, quase não pesa.')),
      ),
    ),
  );
  charts.rank = rankingChart(rankCanvas, rows);
  charts.hist = histogramChart(histCanvas, sel.r);
  charts.sens = sensChart(sensCanvas, sel.r);
}

function renderRisco() {
  if (!state.suppliers.length) return panel('risco').replaceChildren(emptyState('Importe a planilha de desempenho primeiro.'));
  panel('risco').replaceChildren(h('div', { class: 'fz-card' }, modelBar(renderRisco, renderRiskResults)), riskForm(), h('div', { id: 'risk-results' }));
  renderRiskResults();
}

// ---------- Como funciona ----------

function renderAjuda() {
  const li = (...c) => h('li', {}, ...c);
  panel('ajuda').replaceChildren(
    h(
      'div',
      { class: 'fz-card fz-help' },
      h('h2', {}, 'Como funciona'),
      h('h3', {}, '1. Planilha'),
      h('ul', {}, li('Cada aba é uma unidade; cada linha, um fornecedor, com a média e o CV (%) de cada medida.'), li('Desvio padrão (DP) = média × CV ÷ 100.'), li('Linhas com dados fora do esperado (peso abaixo de 100 kg, dias fora de 30–300, rendimento fora de 40–70%, menos de 10 cabeças, GMD ou GDC zerados) vêm desmarcadas. Marque para usar mesmo assim.')),
      h('h3', {}, '2. Econômico (por cabeça, com as médias do fornecedor)'),
      h(
        'ul',
        {},
        li('@ de entrada = peso de entrada × rendimento na entrada ÷ 15. Peso de saída = peso de entrada + GMD × dias. @ de saída = peso de saída × rendimento ÷ 15. @ produzidas = saída − entrada.'),
        li('Alimentação = CMS × dias × preço da dieta (adaptação nos primeiros dias, terminação no resto). Sem CMS na planilha, o consumo é o % do peso vivo médio informado.'),
        li('Custo de produção = operacional × dias + alimentação + juros + sanitário + frete e processamento (de quem paga) + comissão (Boi Próprio). Mortalidade = mortos por animal vivo × (boi magro + ração perdida).'),
        li('Boi Próprio: custo total = produção + mortalidade + boi magro; receita = @ de saída × (venda + bônus).'),
        li('Boitel: o confinamento recebe a diária × dias. Arrobas Produzidas: recebe o valor da @ × @ produzidas. Parceria: recebe as @ produzidas × (venda + bônus) e a parte do bônus sobre as @ de entrada que não fica com o parceiro.'),
        li('Parceiro (dono do boi): paga ao confinamento o que está acima, arca com o que for dele (frete, processamento, mortalidade), recebe a venda inteira e desconta o boi magro.'),
        li('Rentabilidade total = margem ÷ custo total (para o parceiro, custo + boi magro). Mensal = total ÷ (dias ÷ 30) à vista, ou ÷ ((dias + 30) ÷ 30) com recebimento em 30 dias.'),
      ),
      h('p', { class: 'fz-note' }, 'As contas são as do 4M Confinamento, com três ajustes: a dieta de adaptação só vale nos dias de adaptação (no 4M, depois deles, todo o consumo passa ao preço da terminação); a ração perdida com os mortos usa o custo de alimentação do próprio fornecedor (no 4M é um valor fixo de R$ 455); e o custo do Boi Próprio não soma essa ração duas vezes.'),
      h('h3', {}, '3. Risco (Monte Carlo)'),
      h(
        'ul',
        {},
        li('Em cada simulação, sorteia peso de entrada, GMD, rendimento de carcaça, dias e CMS do fornecedor, cada um pela sua média e DP (distribuição normal, cortada em 4 DP e em valores possíveis).'),
        li('GDC e @ produzidas não são sorteados: saem da conta. Por isso a tabela compara o CV das @ produzidas simulado com o da planilha. Se ficarem próximos, as variações estão coerentes.'),
        li('Os preços de compra e de venda variam juntos conforme a correlação informada; dieta e operacional variam de forma independente.'),
        li('Resultado: média, DP, P5 e P95 (90% das simulações ficam entre eles) e a chance de ficar abaixo do resultado mínimo.'),
        li('"O que mais pesa": correlação de cada fator sorteado com o resultado.'),
        li('As medidas são sorteadas de forma independente entre si: na prática, GMD e consumo costumam andar juntos, e isso não está no modelo.'),
      ),
    ),
  );
}

// ---------- Excel ----------

function exportExcel() {
  if (!state.suppliers.length) return toast('Importe a planilha primeiro.', 'error');
  const X = window.XLSX;
  const wb = X.utils.book_new();
  const inc = included();
  const planilha = [['Unidade', 'Fornecedor', 'Cabeças', 'Usado', ...MEASURES.flatMap((m) => [`${m.label} (${m.unit})`, 'DP', 'CV (%)']), 'Alertas']];
  for (const s of state.suppliers) planilha.push([s.unidade, s.nome, s.n, state.excluded.has(s.id) ? 'Não' : 'Sim', ...MEASURES.flatMap((m) => [s[m.key].m, sdOf(s[m.key]), s[m.key].cv]), s.alertas.join('; ')]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(planilha), 'Planilha e DP');

  const p = persp();
  const econSheet = [[`${modelName(state.model)} · ${p}`], ['Unidade', 'Fornecedor', 'Cabeças', 'Dias', '@ entrada', '@ saída', '@ produzidas', 'CMS (kg/dia)', 'Custo total', 'Receita', 'Margem', 'Rent. total (%)', 'Rent. mensal (%)', 'Custo da @']];
  for (const x of econRows()) econSheet.push([x.s.unidade, x.s.nome, x.s.n, x.s.dias.m, x.e.arEnt, x.e.arSai, x.e.arProd, x.e.cms, x.r.custoTotal, x.r.receita, x.r.lucro, x.r.rent, x.r.rentMensal, x.r.custoArroba]);
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(econSheet), 'Econômico');

  const { results } = runRisk();
  const riskSheet = [[`${modelName(state.model)} · ${p} · ${state.R.nivel === 'lote' ? 'média do lote' : 'cada animal'} · ${state.R.nSim} simulações`], ['Unidade', 'Fornecedor', 'Cabeças', 'Média', 'DP', 'P5', 'Mediana', 'P95', `Chance < ${state.R.limite} (%)`, 'CV @ prod. simulado (%)', 'CV @ prod. planilha (%)']];
  for (const s of inc) {
    const r = results.get(s.id);
    if (r) riskSheet.push([s.unidade, s.nome, s.n, r.media, r.dp, r.p5, r.p50, r.p95, r.probAbaixo, r.cvArrobasSim, s.arrobas.cv]);
  }
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(riskSheet), 'Risco');

  const premissas = [['Premissa', 'Valor'], ...Object.entries(state.E).map(([k, v]) => [k, v]), ...Object.entries(state.R).map(([k, v]) => [`risco.${k}`, v])];
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(premissas), 'Premissas');
  X.writeFile(wb, `4M-fornecedores-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------- Análises salvas ----------

function showSimName() {
  document.getElementById('sim-name').textContent = state.sim ? `Análise: ${state.sim.name}` : '';
}

function snapshot() {
  // alertas são recalculados ao abrir; o resultado também.
  return { version: 1, fileName: state.fileName, sheets: state.sheets, suppliers: state.suppliers.map(({ alertas, ...s }) => s), excluded: [...state.excluded], unidade: state.unidade, E: state.E, R: state.R, model: state.model, persp: state.persp };
}

function restore(data) {
  state.fileName = data.fileName || '';
  state.sheets = data.sheets || [];
  state.suppliers = (data.suppliers || []).map((s) => ({ ...s, alertas: alertasDe(s) }));
  state.excluded = new Set(data.excluded || []);
  state.unidade = data.unidade || 'todas';
  state.E = { ...defaultEcon(), ...data.E };
  state.R = { ...defaultRisk(), ...data.R };
  state.model = data.model || 'bp';
  state.persp = data.persp || 'confinamento';
  state.risk = null;
  state.sel = null;
}

function saveDialog() {
  if (!state.suppliers.length) return toast('Importe a planilha antes de salvar.', 'error');
  const name = h('input', { type: 'text', value: state.sim?.name || '', placeholder: 'Ex.: Fornecedores Buritama · nov/2026', maxlength: 120 });
  const error = h('p', { class: 'alert', hidden: true });
  const save = async (asNew) => {
    try {
      const body = { name: name.value, data: snapshot() };
      const { simulation } = state.sim && !asNew ? await api(`/api/fornecedores/simulations/${state.sim.id}`, { method: 'PUT', body }) : await api('/api/fornecedores/simulations', { method: 'POST', body });
      state.sim = { id: simulation.id, name: simulation.name };
      showSimName();
      dialog.close();
      toast('Análise salva.');
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  };
  dialog.replaceChildren(
    h(
      'form',
      { onsubmit: (e) => (e.preventDefault(), save(false)) },
      h('h2', {}, 'Salvar análise'),
      h('p', { class: 'muted' }, 'Guarda a planilha importada, os fornecedores marcados e todos os valores.'),
      h('label', { class: 'field' }, h('span', {}, 'Nome'), name),
      error,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancelar'), state.sim ? h('button', { class: 'btn', type: 'button', onclick: () => save(true) }, 'Salvar como nova') : null, h('button', { class: 'btn btn-primary', type: 'submit' }, state.sim ? 'Atualizar' : 'Salvar')),
    ),
  );
  dialog.showModal();
  name.focus();
}

async function openDialog() {
  let list;
  try {
    ({ simulations: list } = await api('/api/fornecedores/simulations'));
  } catch (err) {
    return toast(err.message, 'error');
  }
  const load = async (s) => {
    try {
      const { simulation } = await api(`/api/fornecedores/simulations/${s.id}`);
      restore(simulation.data);
      state.sim = { id: simulation.id, name: simulation.name };
      showSimName();
      dialog.close();
      selectTab('economico');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const remove = async (s) => {
    if (!confirm(`Excluir a análise "${s.name}"?`)) return;
    await api(`/api/fornecedores/simulations/${s.id}`, { method: 'DELETE', body: {} }).catch((err) => toast(err.message, 'error'));
    if (state.sim?.id === s.id) {
      state.sim = null;
      showSimName();
    }
    openDialog();
  };
  dialog.replaceChildren(
    h(
      'div',
      { class: 'fz-sims' },
      h('h2', {}, 'Minhas análises'),
      list.length
        ? h(
            'ul',
            {},
            list.map((s) => h('li', {}, h('button', { class: 'fz-sim', type: 'button', onclick: () => load(s) }, h('strong', {}, s.name), h('span', { class: 'muted' }, `salva em ${new Date(s.updatedAt).toLocaleString('pt-BR')}`)), h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: () => remove(s) }, 'Excluir'))),
          )
        : h('p', { class: 'muted' }, 'Nenhuma análise salva ainda. Importe a planilha, preencha os valores e use "Salvar".'),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => dialog.close() }, 'Fechar')),
    ),
  );
  if (!dialog.open) dialog.showModal();
}

// ---------- Abas ----------

const RENDER = { planilha: renderPlanilha, economico: renderEconomico, risco: renderRisco, ajuda: renderAjuda };

function selectTab(name) {
  state.tab = name;
  destroyCharts();
  document.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
  history.replaceState(null, '', `#${name}`);
  RENDER[name]();
  window.scrollTo({ top: 0 });
}

// ---------- Tempo de uso (mesmo esquema do 4M e da 3P) ----------

function trackUsage(viewId) {
  if (!viewId) return;
  const post = (path, body, beacon) => {
    const payload = JSON.stringify(body);
    if (beacon && navigator.sendBeacon) return navigator.sendBeacon(path, new Blob([payload], { type: 'application/json' }));
    fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
  };
  setInterval(() => document.visibilityState === 'visible' && post('/api/usage/beat', { viewId }), 60 * 1000);
  document.addEventListener('visibilitychange', () => post('/api/usage/beat', { viewId, ...(document.visibilityState === 'visible' ? { resume: true } : {}) }, document.visibilityState === 'hidden'));
  window.addEventListener('pagehide', () => post('/api/usage/end', { viewId }, true));
}

// ---------- Início ----------

async function init() {
  const { user } = await api('/api/auth/me');
  document.getElementById('user-name').textContent = user.name;
  if (user.impersonatedBy) {
    document.getElementById('impersonation-text').textContent = `Você (${user.impersonatedBy.name}) está vendo o 4M Fornecedores como ${user.name}.`;
    document.getElementById('impersonation').hidden = false;
  }
  initTicker();
  initNps(); // pesquisa de satisfação (o servidor decide se é hora de perguntar)
  document.querySelectorAll('[data-tab]').forEach((t) => (t.onclick = () => selectTab(t.dataset.tab)));
  document.getElementById('sim-save').onclick = saveDialog;
  document.getElementById('sim-open').onclick = openDialog;
  document.getElementById('excel').onclick = exportExcel;
  const initial = location.hash.slice(1);
  selectTab(RENDER[initial] ? initial : 'planilha');
  // Tema mudou: redesenha os gráficos com as cores novas.
  new MutationObserver(() => state.tab === 'risco' && renderRiskResults()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  api('/api/fornecedores/open', { method: 'POST', body: {} })
    .then((d) => trackUsage(d.viewId))
    .catch(() => {});
}

init().catch((err) => toast(err.message, 'error'));

// 3P · Predição de Desempenho a Pasto, dentro do portal (antes: app Shiny em shinyapps.io).
// O cálculo fica em model.js (tradução fiel do app.R); aqui ficam os formulários dos dois
// cenários, o Dashboard comparativo, as simulações salvas e as exportações (Excel e relatório).
import { api, h, toast } from '/js/common.js';
import { comparar, cenarioPadrao, EPOCAS, epocasDoAno, OPCOES, PASTOS, PRODUTOS, simular, sobreposicao, validar, VARIAVEIS } from './model.js';

const state = { c1: null, c2: null, s1: null, s2: null, erros: { c1: [], c2: [] }, tab: 'c1', chart: null, sim: null };
const dialog = document.getElementById('dialog');

// replaceChildren não aceita listas nem vazios: achata e tira null/false antes.
const fill = (el, ...children) => el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));

// ---------- Formatação ----------

const nf = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const brl = (v, d = 2) => (Number.isFinite(v) ? `R$ ${nf(v, d)}` : '—');
// Casas decimais de cada indicador da tabela por época (as mesmas do app original).
const casas = (key) => ({ dias: 0, gmd: 3, consSuplDia: 3, custoSuplDia: 3, arrobasProdAcum: 1, custoArrobaProd: 1, custoArrobaProdAcum: 1 })[key] ?? 2;
const fmtDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const EPOCA_CLASS = { [EPOCAS.AGUAS1]: 'ep-aguas1', [EPOCAS.AGUAS2]: 'ep-aguas2', [EPOCAS.TRANS]: 'ep-trans', [EPOCAS.SECA]: 'ep-seca' };
const epocaClass = (ref) => EPOCA_CLASS[Object.values(EPOCAS).find((e) => ref.startsWith(e))] || '';

// Decimais com vírgula ou ponto ("1,7", "1.7", "1.250,50").
function parseNum(text) {
  const raw = String(text ?? '').trim().replace(/\s/g, '');
  if (!raw) return NaN;
  if (raw.includes(',')) return Number(raw.replace(/\./g, '').replace(',', '.'));
  return Number(raw);
}

// ---------- Formulário de um cenário ----------

// path: caminho no objeto do cenário, ex. 'econ.compra' ou 'pb.seca'.
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

function numField(key, path, label, { unit, hint } = {}) {
  const c = state[key];
  const input = h('input', {
    type: 'text',
    inputmode: 'decimal',
    value: String(getPath(c, path)).replace('.', ','),
    'aria-label': label,
    onchange: () => {
      const v = parseNum(input.value);
      input.classList.toggle('invalid', !Number.isFinite(v));
      if (!Number.isFinite(v)) return toast(`"${label}": informe um número.`, 'error');
      setPath(c, path, v);
      recalc();
    },
  });
  return h('label', { class: 'field' }, h('span', {}, label, unit ? h('small', { class: 'unit' }, ` ${unit}`) : null), input, hint ? h('small', {}, hint) : null);
}

function dateField(key, path, label) {
  const c = state[key];
  const input = h('input', {
    type: 'date',
    value: getPath(c, path),
    onchange: () => {
      if (!input.value) return;
      setPath(c, path, input.value);
      recalc();
    },
  });
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

function radioField(key, path, label, options) {
  const c = state[key];
  const name = `${key}-${path}`;
  return h(
    'fieldset',
    { class: 'field p3-radios' },
    h('legend', {}, label),
    options.map((o) =>
      h(
        'label',
        { class: 'check' },
        h('input', {
          type: 'radio',
          name,
          value: o,
          checked: getPath(c, path) === o,
          onchange: () => {
            setPath(c, path, o);
            recalc();
          },
        }),
        h('span', {}, o),
      ),
    ),
  );
}

// Faixa de meses (de/até) com "Usar", como os sliders do app original.
function monthRange(key, part, label) {
  const c = state[key];
  const r = c[part];
  const sel = (which) =>
    h(
      'select',
      {
        'aria-label': `${label}: mês ${which === 'de' ? 'inicial' : 'final'}`,
        disabled: !r.usar,
        onchange: (e) => {
          r[which] = Number(e.target.value);
          recalc();
          renderScenario(key);
        },
      },
      MESES.slice(1).map((m, i) => h('option', { value: i + 1, selected: r[which] === i + 1 }, `${i + 1} · ${m}`)),
    );
  return h(
    'div',
    { class: 'field' },
    h('span', {}, label),
    h('div', { class: 'p3-range' }, sel('de'), h('span', { class: 'muted' }, 'a'), sel('ate')),
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: r.usar,
        onchange: (e) => {
          r.usar = e.target.checked;
          recalc();
          renderScenario(key);
        },
      }),
      h('span', {}, 'Usar'),
    ),
  );
}

// Faixa de 12 meses mostrando a época de cada mês (o que o modelo vai usar).
function calendarStrip(c) {
  const ep = epocasDoAno(c);
  return h(
    'div',
    { class: 'p3-calendar', 'aria-label': 'Épocas do ano usadas no cálculo' },
    MESES.slice(1).map((m, i) => h('span', { class: `p3-month ${EPOCA_CLASS[ep[i + 1]]}`, title: `${m}: ${ep[i + 1]}` }, h('strong', {}, m), h('small', {}, ep[i + 1].replace('Águas 1°s', 'Águas 1ª').replace('Águas 2°s', 'Águas 2ª')))),
  );
}

function productField(key, epoca, label) {
  const c = state[key];
  const info = h('small', {});
  const showInfo = () => {
    const p = PRODUTOS[c.produto[epoca]];
    info.textContent = p ? `Dose ${nf(p.dose, p.dose < 0.1 ? 3 : 2)}% do PV · PB ${nf(p.pb, 1)}%` : '';
  };
  const select = h(
    'select',
    {
      'aria-label': label,
      onchange: () => {
        c.produto[epoca] = select.value;
        showInfo();
        recalc();
      },
    },
    OPCOES[epoca].map((p) => h('option', { value: p, selected: c.produto[epoca] === p }, p)),
  );
  showInfo();
  return h('label', { class: 'field' }, h('span', {}, label), select, info);
}

function renderScenario(key) {
  const c = state[key];
  const n = key === 'c1' ? 1 : 2;
  const panel = document.querySelector(`[data-panel="${key}"]`);
  const overlap = sobreposicao(c);
  fill(
    panel,
    h(
      'div',
      { class: 'p3-card' },
      h('div', { class: 'p3-card-head' }, h('h2', {}, `Cenário ${n} · Variáveis zootécnicas`), key === 'c2' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: copyC1 }, 'Copiar tudo do Cenário 1') : null),
      h(
        'div',
        { class: 'p3-grid' },
        h(
          'div',
          { class: 'p3-col' },
          numField(key, 'pesoEntrada', 'Peso de entrada', { unit: 'kg' }),
          numField(key, 'animais', 'Número de animais'),
          dateField(key, 'dataEntrada', 'Data de entrada'),
          dateField(key, 'dataSaida', 'Data de saída'),
        ),
        h('div', { class: 'p3-col' }, numField(key, 'area', 'Área', { unit: 'ha' }), radioField(key, 'sexo', 'Sexo', ['Macho', 'Fêmea']), numField(key, 'standard.aguas', 'Standard águas', { hint: 'De 0 a 1 (1 = sem ajuste).' }), numField(key, 'standard.transicao', 'Standard transição'), numField(key, 'standard.seca', 'Standard seca')),
        h('div', { class: 'p3-col' }, radioField(key, 'pasto', 'Pasto', Object.keys(PASTOS)), numField(key, 'pb.aguas', 'PB do pasto nas águas', { unit: '%' }), numField(key, 'pb.transicao', 'PB do pasto na transição águas-seca', { unit: '%' }), numField(key, 'pb.seca', 'PB do pasto na seca', { unit: '%' })),
        h(
          'div',
          { class: 'p3-col' },
          productField(key, 'aguas', 'Produto de águas'),
          numField(key, 'custo.aguas', 'Custo do produto de águas', { unit: 'R$/kg' }),
          productField(key, 'transicao', 'Produto de transição'),
          numField(key, 'custo.transicao', 'Custo do produto de transição', { unit: 'R$/kg' }),
          productField(key, 'seca', 'Produto de seca'),
          numField(key, 'custo.seca', 'Custo do produto de seca', { unit: 'R$/kg' }),
        ),
      ),
      h('h3', { class: 'p3-sub' }, 'Épocas do ano'),
      h('div', { class: 'p3-grid p3-grid-2' }, monthRange(key, 'transicao', 'Meses de transição'), monthRange(key, 'seca', 'Meses de seca')),
      calendarStrip(c),
      overlap ? h('p', { class: 'alert' }, 'Transição e Seca estão sobrepostas: nos meses em comum, vale a Seca.') : null,
      h('p', { class: 'muted p3-note' }, 'Os meses vão até o fim do mês escolhido (mês 5 vai até 31/05). Depois do último mês de transição/seca, o ano volta às "Águas 2ª".'),
    ),
    h(
      'div',
      { class: 'p3-card' },
      h('h2', {}, `Cenário ${n} · Variáveis econômicas`),
      h(
        'div',
        { class: 'p3-grid p3-grid-econ' },
        numField(key, 'econ.compra', 'Valor de compra', { unit: 'R$/cab.' }),
        numField(key, 'econ.freteCompra', 'Frete na compra', { unit: 'R$/cab.' }),
        numField(key, 'econ.comissao', 'Comissão na compra', { unit: 'R$/cab.' }),
        numField(key, 'econ.aluguelDia', 'Aluguel de pasto', { unit: 'R$/cab./dia' }),
        numField(key, 'econ.salario', 'Salário de funcionários', { unit: 'R$/mês' }),
        numField(key, 'econ.animaisPorFuncionario', 'Animais por funcionário'),
        numField(key, 'econ.salgaDia', 'Custo de salga', { unit: 'R$/cab./dia' }),
        numField(key, 'econ.sanitario', 'Custos sanitários', { unit: 'R$/cab.' }),
        numField(key, 'econ.rastreabilidade', 'Rastreabilidade', { unit: 'R$/cab.' }),
        numField(key, 'econ.outros', 'Outros custos', { unit: 'R$/cab.' }),
        numField(key, 'econ.freteVenda', 'Frete na venda', { unit: 'R$/cab.' }),
        numField(key, 'econ.valorVenda', 'Valor de venda', { unit: 'R$/@' }),
      ),
    ),
    h('div', { class: 'p3-next' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => selectTab(key === 'c1' ? 'c2' : 'dashboard') }, key === 'c1' ? 'Ir para o Cenário 2 →' : 'Ver o Dashboard →')),
  );
}

function copyC1() {
  state.c2 = structuredClone(state.c1);
  recalc();
  renderScenario('c2');
  toast('Cenário 2 igual ao Cenário 1. Agora mude só o que quer comparar.');
}

// ---------- Cálculo ----------

function recalc() {
  for (const k of ['c1', 'c2']) {
    state.erros[k] = validar(state[k]);
    state[`s${k[1]}`] = state.erros[k].length ? null : simular(state[k]);
  }
  if (state.tab === 'dashboard') renderDashboard();
}

// ---------- Dashboard ----------

const KPIS = [
  { key: 'pesoFinal', label: 'Peso final', unit: 'kg', digits: 1, up: true },
  { key: 'gpd', label: 'GPD (ganho por dia)', unit: 'kg', digits: 3, up: true },
  { key: 'ganhoTotal', label: 'Ganho no período', unit: 'kg', digits: 1, up: true },
  { key: 'arrobasHa', label: '@ produzidas por ha', unit: '@/ha', digits: 1, up: true },
  { key: 'custoArrobaProd', label: 'Custo da @ produzida', unit: 'R$', digits: 1, up: false, money: true },
  { key: 'custoTotalArroba', label: 'Custo total da @', unit: 'R$', digits: 1, up: false, money: true },
  { key: 'margemCab', label: 'Margem por cabeça', unit: 'R$/cab.', digits: 1, up: true, money: true },
  { key: 'margemHa', label: 'Margem por hectare', unit: 'R$/ha', digits: 1, up: true, money: true },
  { key: 'rentabilidade', label: 'Rentabilidade', unit: '% ao mês', digits: 2, up: true },
];

function kpiTile(k) {
  const a = state.s1.kpis[k.key];
  const b = state.s2.kpis[k.key];
  const diff = b - a;
  const better = Math.abs(diff) < 1e-9 ? null : (diff > 0) === k.up ? 'C2' : 'C1';
  const val = (v) => (k.money ? brl(v, k.digits) : nf(v, k.digits));
  return h(
    'article',
    { class: 'p3-kpi' },
    h('span', { class: 'p3-kpi-label' }, k.label, h('small', {}, ` ${k.unit}`)),
    h('div', { class: 'p3-kpi-pair' }, h('div', { class: better === 'C1' ? 'best' : '' }, h('span', { class: 'p3-tag c1' }, 'C1'), h('strong', {}, val(a))), h('div', { class: better === 'C2' ? 'best' : '' }, h('span', { class: 'p3-tag c2' }, 'C2'), h('strong', {}, val(b)))),
    h('span', { class: 'p3-kpi-diff' }, better ? `C2 − C1: ${diff > 0 ? '+' : ''}${k.money ? brl(diff, k.digits) : nf(diff, k.digits)} · melhor: ${better}` : 'Iguais nos dois cenários'),
  );
}

function renderDashboard() {
  const panel = document.querySelector('[data-panel="dashboard"]');
  const problems = [...state.erros.c1.map((e) => `Cenário 1: ${e}`), ...state.erros.c2.map((e) => `Cenário 2: ${e}`)];
  if (problems.length) {
    panel.replaceChildren(h('div', { class: 'p3-card' }, h('h2', {}, 'Falta ajustar alguns campos'), h('ul', {}, problems.map((p) => h('li', {}, p)))));
    return;
  }
  const { s1, s2 } = state;
  const rows = comparar(s1, s2);
  const warnings = [];
  for (const [k, n] of [['c1', 1], ['c2', 2]]) {
    if (sobreposicao(state[k])) warnings.push(`Cenário ${n}: transição e seca sobrepostas (vale a Seca).`);
    const altaDose = ['aguas', 'transicao', 'seca'].filter((e) => PRODUTOS[state[k].produto[e]]?.dose > 0.99);
    if (altaDose.length) warnings.push(`Cenário ${n}: suplementação de 1% do PV ou mais — a equação foi feita com até 1%, então o GMD fica menos preciso.`);
  }

  const canvas = h('canvas', { role: 'img', 'aria-label': 'Curvas de peso corporal dos dois cenários ao longo do tempo' });
  const gmdTable = h(
    'table',
    { class: 'p3-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Época'), h('th', { class: 'num' }, 'C1'), h('th', { class: 'num' }, 'C2'))),
    h(
      'tbody',
      {},
      rows.map((r) => h('tr', {}, h('td', {}, h('span', { class: `p3-ep ${epocaClass(r.ref)}` }), r.ref), h('td', { class: 'num' }, r.c1 ? nf(r.c1.gmd, 3) : '—'), h('td', { class: 'num' }, r.c2 ? nf(r.c2.gmd, 3) : '—'))),
    ),
  );

  const detail = h(
    'table',
    { class: 'p3-table p3-detail' },
    h('thead', {}, h('tr', {}, h('th', { rowspan: 2 }, 'Indicador'), rows.map((r) => h('th', { colspan: 2, class: `p3-ep-head ${epocaClass(r.ref)}` }, r.ref))), h('tr', {}, rows.flatMap(() => [h('th', { class: 'num' }, 'C1'), h('th', { class: 'num' }, 'C2')]))),
    h(
      'tbody',
      {},
      VARIAVEIS.map(([key, label]) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, label),
          rows.flatMap((r) => [h('td', { class: 'num' }, r.c1 ? nf(r.c1[key], casas(key)) : '—'), h('td', { class: 'num' }, r.c2 ? nf(r.c2[key], casas(key)) : '—')]),
        ),
      ),
    ),
  );

  const scen = (n, s, c) =>
    h(
      'div',
      { class: 'p3-scen' },
      h('span', { class: `p3-tag c${n}` }, `C${n}`),
      h('span', {}, `${fmtDate(c.dataEntrada)} a ${fmtDate(c.dataSaida)} · ${s.tempo} dias · ${nf(c.animais, 0)} animais em ${nf(c.area, 0)} ha · GPD esperado entre ${nf(s.kpis.gpdMin, 3)} e ${nf(s.kpis.gpdMax, 3)} kg`),
    );

  fill(
    panel,
    warnings.length ? h('div', { class: 'alert' }, warnings.map((w) => h('div', {}, w))) : null,
    h('div', { class: 'p3-scens' }, scen(1, s1, state.c1), scen(2, s2, state.c2)),
    h('div', { class: 'p3-kpis' }, KPIS.map(kpiTile)),
    h(
      'div',
      { class: 'p3-row' },
      h('section', { class: 'p3-card' }, h('h2', {}, 'Curva de peso corporal'), h('ul', { class: 'p3-legend' }, h('li', {}, h('span', { class: 'p3-key c1' }), 'Cenário 1'), h('li', {}, h('span', { class: 'p3-key c2' }), 'Cenário 2')), h('div', { class: 'p3-chart' }, canvas)),
      h('section', { class: 'p3-card' }, h('h2', {}, 'GMD por época'), h('p', { class: 'muted' }, 'Média do ganho diário (kg) em cada época.'), gmdTable),
    ),
    h(
      'section',
      { class: 'p3-card' },
      h('div', { class: 'p3-card-head' }, h('h2', {}, 'Comparação por época'), h('div', { class: 'viewer-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: exportExcel }, 'Baixar Excel'), h('button', { class: 'btn btn-sm', type: 'button', onclick: printReport }, 'Relatório (imprimir/PDF)'))),
      h('div', { class: 'table-wrap' }, detail),
      h('p', { class: 'muted p3-note' }, 'Estimativas baseadas em literatura com animais, níveis de suplementação, composição de suplementos e épocas do ano similares. A Cargill não garante que os resultados serão exatamente os mesmos.'),
    ),
  );
  requestAnimationFrame(() => drawChart(canvas));
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function drawChart(canvas) {
  state.chart?.destroy();
  if (!window.Chart || !canvas.isConnected) return;
  const { s1, s2 } = state;
  const toPoints = (s) => s.dias.map((d) => ({ x: Date.parse(`${d.data}T12:00:00Z`), y: d.peso }));
  const muted = cssVar('--muted');
  const line = cssVar('--line');
  const monthLabel = (ms) => {
    const d = new Date(ms);
    return `${MESES[d.getUTCMonth() + 1]}/${String(d.getUTCFullYear()).slice(2)}`;
  };
  state.chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        { label: 'Cenário 1', data: toPoints(s1), borderColor: cssVar('--p3-c1'), backgroundColor: cssVar('--p3-c1'), borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0 },
        { label: 'Cenário 2', data: toPoints(s2), borderColor: cssVar('--p3-c2'), backgroundColor: cssVar('--p3-c2'), borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => fmtDate(new Date(items[0].parsed.x).toISOString().slice(0, 10)),
            label: (ctx) => ` ${ctx.dataset.label}: ${nf(ctx.parsed.y, 1)} kg`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          grid: { display: false },
          border: { color: line },
          ticks: {
            color: muted,
            maxRotation: 0,
            autoSkip: true,
            // Um rótulo por mês (no dia 1º).
            callback: (v) => monthLabel(v),
            stepSize: 30.44 * 86400000,
          },
        },
        y: { grid: { color: line }, border: { display: false }, ticks: { color: muted, callback: (v) => `${v} kg` } },
      },
    },
  });
}

// ---------- Exportações ----------

function generalRows() {
  const { s1, s2 } = state;
  return [
    ['GPD médio (kg/dia)', s1.kpis.gpd, s2.kpis.gpd],
    ['Peso final (kg)', s1.kpis.pesoFinal, s2.kpis.pesoFinal],
    ['Dias totais', s1.tempo, s2.tempo],
    ['Ganho total (kg)', s1.kpis.ganhoTotal, s2.kpis.ganhoTotal],
    ['Custo da @ produzida (R$)', s1.kpis.custoArrobaProd, s2.kpis.custoArrobaProd],
    ['Custo total da @ (R$)', s1.kpis.custoTotalArroba, s2.kpis.custoTotalArroba],
    ['@ produzidas por ha', s1.kpis.arrobasHa, s2.kpis.arrobasHa],
    ['Margem (R$/cab.)', s1.kpis.margemCab, s2.kpis.margemCab],
    ['Margem (R$/ha)', s1.kpis.margemHa, s2.kpis.margemHa],
    ['Rentabilidade (% ao mês)', s1.kpis.rentabilidade, s2.kpis.rentabilidade],
  ];
}

const DETAIL_COLUMNS = [
  ['ref', 'Época'],
  ['data', 'Data'],
  ['diasAcum', 'Dias Acum.'],
  ['dias', 'Dias'],
  ['peso', 'Peso (kg)'],
  ['gmd', 'GMD (kg)'],
  ['arrobasProd', '@ Prod.'],
  ['arrobasProdAcum', '@ Prod. Acum.'],
  ['consSuplDia', 'Cons. Supl. (kg/d)'],
  ['consSuplTotal', 'Cons. Supl. Total (kg)'],
  ['custoSuplDia', 'Custo Supl. (R$/cab./d)'],
  ['custoSuplAcum', 'Custo Supl. Acum. (R$/cab.)'],
  ['custoArrobaProd', 'Custo @ Prod. (R$)'],
  ['custoArrobaProdAcum', 'Custo @ Prod. Acum. (R$)'],
  ['margemHa', 'Margem/ha (R$)'],
  ['rentabilidade', 'Rentabilidade (%)'],
];

let excelLoading = null;
function loadExcelLib() {
  excelLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/exceljs.min.js';
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => {
      excelLoading = null;
      reject(new Error('Não foi possível carregar o gerador de Excel.'));
    };
    document.head.append(s);
  });
  return excelLoading;
}

async function exportExcel() {
  try {
    const ExcelJS = await loadExcelLib();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'BI Probeef · 3P';
    const sheet = (name, columns, rows) => {
      const ws = wb.addWorksheet(name);
      ws.columns = columns.map(([key, header, width]) => ({ header, key, width: width || Math.max(12, header.length + 2) }));
      rows.forEach((r) => ws.addRow(r));
      const head = ws.getRow(1);
      head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF094140' } };
      head.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      return ws;
    };
    sheet('Comparação Geral', [['m', 'Métrica', 30], ['c1', 'Cenário 1', 15], ['c2', 'Cenário 2', 15]], generalRows().map(([m, c1, c2]) => ({ m, c1, c2 })));
    for (const [n, s] of [[1, state.s1], [2, state.s2]]) {
      sheet(`Cenário ${n} - Detalhado`, DETAIL_COLUMNS.map(([k, label]) => [k, label, k === 'ref' ? 22 : 14]), s.epocas.map((e) => ({ ...e, data: fmtDate(e.data) })));
    }
    sheet('Resumo GMD', [['ref', 'Estação', 22], ['c1', 'Cenário 1', 14], ['c2', 'Cenário 2', 14]], comparar(state.s1, state.s2).map((r) => ({ ref: r.ref, c1: r.c1?.gmd ?? null, c2: r.c2?.gmd ?? null })));
    sheet('Produtos Utilizados', [['c', 'Cenário', 15], ['e', 'Época', 18], ['p', 'Produto', 34]], [...state.s1.produtos.map((p) => ({ c: 'Cenário 1', e: p.epoca, p: p.produto })), ...state.s2.produtos.map((p) => ({ c: 'Cenário 2', e: p.epoca, p: p.produto }))]);
    sheet('Entradas', [['campo', 'Campo', 34], ['c1', 'Cenário 1', 30], ['c2', 'Cenário 2', 30]], inputRows());
    const blob = new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `3P-Desempenho-a-Pasto-${new Date().toISOString().slice(0, 10)}.xlsx` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Todas as entradas dos dois cenários, para a planilha e o relatório.
function inputRows() {
  const f = (c) => ({
    'Peso de entrada (kg)': c.pesoEntrada,
    'Número de animais': c.animais,
    'Data de entrada': fmtDate(c.dataEntrada),
    'Data de saída': fmtDate(c.dataSaida),
    'Meses de transição': c.transicao.usar ? `${c.transicao.de} a ${c.transicao.ate}` : 'não usa',
    'Meses de seca': c.seca.usar ? `${c.seca.de} a ${c.seca.ate}` : 'não usa',
    'Área (ha)': c.area,
    Sexo: c.sexo,
    'Standard águas / transição / seca': `${c.standard.aguas} / ${c.standard.transicao} / ${c.standard.seca}`,
    Pasto: c.pasto,
    'PB do pasto águas / transição / seca (%)': `${c.pb.aguas} / ${c.pb.transicao} / ${c.pb.seca}`,
    'Produto de águas': `${c.produto.aguas} (R$ ${nf(c.custo.aguas)}/kg)`,
    'Produto de transição': `${c.produto.transicao} (R$ ${nf(c.custo.transicao)}/kg)`,
    'Produto de seca': `${c.produto.seca} (R$ ${nf(c.custo.seca)}/kg)`,
    'Valor de compra (R$/cab.)': c.econ.compra,
    'Frete na compra (R$/cab.)': c.econ.freteCompra,
    'Comissão na compra (R$/cab.)': c.econ.comissao,
    'Aluguel de pasto (R$/cab./dia)': c.econ.aluguelDia,
    'Salário de funcionários (R$/mês)': c.econ.salario,
    'Animais por funcionário': c.econ.animaisPorFuncionario,
    'Custo de salga (R$/cab./dia)': c.econ.salgaDia,
    'Custos sanitários (R$/cab.)': c.econ.sanitario,
    'Rastreabilidade (R$/cab.)': c.econ.rastreabilidade,
    'Outros custos (R$/cab.)': c.econ.outros,
    'Frete na venda (R$/cab.)': c.econ.freteVenda,
    'Valor de venda (R$/@)': c.econ.valorVenda,
  });
  const a = f(state.c1);
  const b = f(state.c2);
  return Object.keys(a).map((campo) => ({ campo, c1: a[campo], c2: b[campo] }));
}

// Relatório para imprimir ou salvar em PDF (substitui o Relatorio.html do app original).
function printReport() {
  const box = document.getElementById('print');
  const table = (head, rows) => h('table', {}, h('thead', {}, h('tr', {}, head.map((t) => h('th', {}, t)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))));
  const canvas = document.querySelector('.p3-chart canvas');
  const rows = comparar(state.s1, state.s2);
  fill(
    box,
    h('header', {}, h('img', { src: '/img/probeef-horizontal.png', alt: 'Probeef', width: 120 }), h('div', {}, h('h1', {}, 'Predição de Desempenho a Pasto'), h('p', {}, `Nutron | Cargill · gerado em ${new Date().toLocaleString('pt-BR')}`))),
    h('p', { class: 'p3-print-note' }, 'Este relatório contém estimativas de desempenho baseadas em informações de literatura em que se utilizaram animais, níveis de suplementação, composição de suplementos e épocas do ano similares ao projetado aqui. A Cargill não garante que as estimativas serão exatamente as mesmas.'),
    h('h2', {}, 'Comparação geral'),
    table(['Métrica', 'Cenário 1', 'Cenário 2'], generalRows().map(([m, a, b]) => [m, nf(a, m.startsWith('Dias') ? 0 : 2), nf(b, m.startsWith('Dias') ? 0 : 2)])),
    canvas ? [h('h2', {}, 'Curva de peso corporal'), h('img', { class: 'p3-print-chart', src: canvas.toDataURL('image/png'), alt: 'Curvas de peso dos dois cenários' })] : null,
    h('h2', {}, 'Comparação por época'),
    table(['Indicador', ...rows.flatMap((r) => [`C1 · ${r.ref}`, `C2 · ${r.ref}`])], VARIAVEIS.map(([k, label]) => [label, ...rows.flatMap((r) => [r.c1 ? nf(r.c1[k], casas(k)) : '—', r.c2 ? nf(r.c2[k], casas(k)) : '—'])])),
    h('h2', {}, 'GMD por época'),
    table(['Época', 'Cenário 1', 'Cenário 2'], rows.map((r) => [r.ref, r.c1 ? nf(r.c1.gmd, 3) : '—', r.c2 ? nf(r.c2.gmd, 3) : '—'])),
    h('h2', {}, 'Produtos utilizados'),
    table(['Cenário', 'Época', 'Produto'], [...state.s1.produtos.map((p) => ['Cenário 1', p.epoca, p.produto]), ...state.s2.produtos.map((p) => ['Cenário 2', p.epoca, p.produto])]),
    h('h2', {}, 'Entradas'),
    table(['Campo', 'Cenário 1', 'Cenário 2'], inputRows().map((r) => [r.campo, String(r.c1), String(r.c2)])),
    h('footer', {}, 'Todos os direitos reservados · Nutron | Cargill'),
  );
  window.print();
}

// ---------- Simulações salvas ----------

function showSimName() {
  document.getElementById('sim-name').textContent = state.sim ? `Simulação: ${state.sim.name}` : '';
}

function saveDialog() {
  const name = h('input', { type: 'text', value: state.sim?.name || '', placeholder: 'Ex.: Fazenda Boa Vista · recria 2027', maxlength: 120 });
  const error = h('p', { class: 'alert', hidden: true });
  const save = async (asNew) => {
    try {
      const body = { name: name.value, data: { c1: state.c1, c2: state.c2 } };
      const { simulation } = state.sim && !asNew ? await api(`/api/pasto/simulations/${state.sim.id}`, { method: 'PUT', body }) : await api('/api/pasto/simulations', { method: 'POST', body });
      state.sim = { id: simulation.id, name: simulation.name };
      showSimName();
      dialog.close();
      toast('Simulação salva.');
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  };
  dialog.replaceChildren(
    h(
      'form',
      { onsubmit: (e) => (e.preventDefault(), save(false)) },
      h('h2', {}, 'Salvar simulação'),
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
    ({ simulations: list } = await api('/api/pasto/simulations'));
  } catch (err) {
    return toast(err.message, 'error');
  }
  const load = async (s) => {
    try {
      const { simulation } = await api(`/api/pasto/simulations/${s.id}`);
      const base1 = cenarioPadrao(undefined, 1);
      const base2 = cenarioPadrao(undefined, 2);
      // Junta com o padrão: simulações antigas continuam abrindo se um campo novo aparecer.
      state.c1 = { ...base1, ...simulation.data.c1, econ: { ...base1.econ, ...simulation.data.c1?.econ } };
      state.c2 = { ...base2, ...simulation.data.c2, econ: { ...base2.econ, ...simulation.data.c2?.econ } };
      state.sim = { id: simulation.id, name: simulation.name };
      showSimName();
      recalc();
      renderScenario('c1');
      renderScenario('c2');
      dialog.close();
      selectTab('dashboard');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const remove = async (s) => {
    if (!confirm(`Excluir a simulação "${s.name}"?`)) return;
    await api(`/api/pasto/simulations/${s.id}`, { method: 'DELETE', body: {} }).catch((err) => toast(err.message, 'error'));
    if (state.sim?.id === s.id) {
      state.sim = null;
      showSimName();
    }
    openDialog();
  };
  dialog.replaceChildren(
    h(
      'div',
      { class: 'p3-sims' },
      h('h2', {}, 'Minhas simulações'),
      list.length
        ? h(
            'ul',
            {},
            list.map((s) =>
              h('li', {}, h('button', { class: 'p3-sim', type: 'button', onclick: () => load(s) }, h('strong', {}, s.name), h('span', { class: 'muted' }, `salva em ${new Date(s.updatedAt).toLocaleString('pt-BR')}`)), h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: () => remove(s) }, 'Excluir')),
            ),
          )
        : h('p', { class: 'muted' }, 'Nenhuma simulação salva ainda. Monte os dois cenários e use "Salvar".'),
      h(
        'div',
        { class: 'dialog-actions' },
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => {
              state.c1 = cenarioPadrao(undefined, 1);
              state.c2 = cenarioPadrao(undefined, 2);
              state.sim = null;
              showSimName();
              recalc();
              renderScenario('c1');
              renderScenario('c2');
              dialog.close();
              selectTab('c1');
            },
          },
          'Começar do zero',
        ),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => dialog.close() }, 'Fechar'),
      ),
    ),
  );
  if (!dialog.open) dialog.showModal();
}

// ---------- Abas ----------

function selectTab(name) {
  state.tab = name;
  document.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
  history.replaceState(null, '', `#${name}`);
  if (name === 'dashboard') renderDashboard();
  window.scrollTo({ top: 0 });
}

// ---------- Tempo de uso (mesmo esquema do portal e do 4M) ----------

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
    document.getElementById('impersonation-text').textContent = `Você (${user.impersonatedBy.name}) está vendo a 3P como ${user.name}.`;
    document.getElementById('impersonation').hidden = false;
  }
  state.c1 = cenarioPadrao(undefined, 1);
  state.c2 = cenarioPadrao(undefined, 2);
  recalc();
  renderScenario('c1');
  renderScenario('c2');
  document.querySelectorAll('[data-tab]').forEach((t) => (t.onclick = () => selectTab(t.dataset.tab)));
  document.getElementById('sim-save').onclick = saveDialog;
  document.getElementById('sim-open').onclick = openDialog;
  const initial = location.hash.slice(1);
  selectTab(['c1', 'c2', 'dashboard', 'dicas'].includes(initial) ? initial : 'c1');
  // Tema mudou: redesenha o gráfico com as cores novas.
  new MutationObserver(() => state.tab === 'dashboard' && renderDashboard()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  api('/api/pasto/open', { method: 'POST', body: {} })
    .then((d) => trackUsage(d.viewId))
    .catch(() => {});
}

init().catch((err) => toast(err.message, 'error'));

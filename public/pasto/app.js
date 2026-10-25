// 3P · Predição de Desempenho a Pasto, dentro do portal (antes: app Shiny em shinyapps.io).
// O cálculo fica em model.js (tradução fiel do app.R); aqui ficam os formulários dos dois
// cenários, o Dashboard comparativo, as simulações salvas e as exportações (Excel e relatório).
import { api, h, toast } from '/js/common.js';
import { initTicker } from '/js/ticker.js';
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

// Campo numérico com a unidade dentro da caixa (kg, %, R$/kg). Recalcula ao sair do campo e
// também enquanto digita, para a prévia acompanhar.
function numInput(key, path, label, { unit, compact = false } = {}) {
  const c = state[key];
  const input = h('input', { type: 'text', inputmode: 'decimal', value: String(getPath(c, path)).replace('.', ','), 'aria-label': label });
  const apply = (strict) => {
    const v = parseNum(input.value);
    const ok = Number.isFinite(v);
    input.classList.toggle('invalid', !ok && strict);
    if (!ok) {
      if (strict) toast(`"${label}": informe um número.`, 'error');
      return;
    }
    setPath(c, path, v);
    recalc();
  };
  input.addEventListener('input', () => apply(false));
  input.addEventListener('change', () => apply(true));
  return h('span', { class: `p3-input${compact ? ' compact' : ''}` }, input, unit ? h('span', { class: 'p3-suffix', 'aria-hidden': 'true' }, unit) : null);
}

function numField(key, path, label, opts = {}) {
  return h('label', { class: 'field' }, h('span', {}, label), numInput(key, path, label, opts), opts.hint ? h('small', {}, opts.hint) : null);
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
      renderScenario(key);
    },
  });
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

// Botões em pílula (um só escolhido), no lugar dos rádios do app original.
function segmented(key, path, label, options) {
  const c = state[key];
  const group = h(
    'div',
    { class: 'p3-seg', role: 'radiogroup', 'aria-label': label },
    options.map((o) =>
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          'aria-checked': String(getPath(c, path) === o),
          class: getPath(c, path) === o ? 'on' : '',
          onclick: () => {
            setPath(c, path, o);
            group.querySelectorAll('button').forEach((b) => {
              const on = b.textContent === o;
              b.classList.toggle('on', on);
              b.setAttribute('aria-checked', String(on));
            });
            recalc();
          },
        },
        o,
      ),
    ),
  );
  return h('div', { class: 'field' }, h('span', {}, label), group);
}

// Faixa de 12 meses mostrando a época de cada mês (o que o modelo vai usar).
function calendarStrip(c) {
  const ep = epocasDoAno(c);
  return h(
    'div',
    { class: 'p3-calendar', 'aria-label': 'Épocas do ano usadas no cálculo' },
    MESES.slice(1).map((m, i) => h('span', { class: `p3-month ${EPOCA_CLASS[ep[i + 1]]}`, title: `${m}: ${ep[i + 1]}` }, h('strong', {}, m), h('small', {}, ep[i + 1].replace('Águas 1°s', 'Águas').replace('Águas 2°s', 'Águas 2ª')))),
  );
}

// Uma linha por época: meses, PB do pasto, standard, produto e custo, tudo junto.
const SEASONS = [
  { key: 'aguas', label: 'Águas', cls: 'ep-aguas1', hint: 'O resto do ano' },
  { key: 'transicao', label: 'Transição', cls: 'ep-trans', range: 'transicao' },
  { key: 'seca', label: 'Seca', cls: 'ep-seca', range: 'seca' },
];

function monthSelect(key, part, which) {
  const r = state[key][part];
  return h(
    'select',
    {
      'aria-label': `${part === 'seca' ? 'Seca' : 'Transição'}: mês ${which === 'de' ? 'inicial' : 'final'}`,
      disabled: !r.usar,
      onchange: (e) => {
        r[which] = Number(e.target.value);
        recalc();
        renderScenario(key);
      },
    },
    MESES.slice(1).map((m, i) => h('option', { value: i + 1, selected: r[which] === i + 1 }, m)),
  );
}

function seasonRow(key, s) {
  const c = state[key];
  const r = s.range ? c[s.range] : null;
  const off = r && !r.usar;
  const product = h(
    'select',
    {
      'aria-label': `Produto de ${s.label.toLowerCase()}`,
      onchange: () => {
        c.produto[s.key] = product.value;
        info.textContent = productInfo(product.value);
        recalc();
      },
    },
    OPCOES[s.key].map((p) => h('option', { value: p, selected: c.produto[s.key] === p }, p.replace(/^PROBEEF /, ''))),
  );
  const info = h('small', { class: 'p3-prod-info' }, productInfo(c.produto[s.key]));
  const months = r
    ? h(
        'div',
        { class: 'p3-months' },
        h(
          'label',
          { class: 'p3-switch' },
          h('input', {
            type: 'checkbox',
            checked: r.usar,
            'aria-label': `Usar ${s.label.toLowerCase()}`,
            onchange: (e) => {
              r.usar = e.target.checked;
              recalc();
              renderScenario(key);
            },
          }),
          h('span', { 'aria-hidden': 'true' }),
        ),
        monthSelect(key, s.range, 'de'),
        h('span', { class: 'muted' }, 'a'),
        monthSelect(key, s.range, 'ate'),
      )
    : h('span', { class: 'muted p3-months-auto' }, s.hint);
  const cell = (label, content) => h('div', { class: 'p3-cell' }, h('span', { class: 'p3-cell-label' }, label), content);
  return h(
    'div',
    { class: `p3-season ${s.cls}${off ? ' off' : ''}` },
    h('div', { class: 'p3-season-name' }, h('strong', {}, s.label), off ? h('small', {}, 'não usada') : null),
    cell('Meses', months),
    cell('PB do pasto', numInput(key, `pb.${s.key}`, `PB do pasto (${s.label})`, { unit: '%', compact: true })),
    cell('Standard', numInput(key, `standard.${s.key}`, `Standard (${s.label})`, { compact: true })),
    cell('Produto Probeef', h('div', { class: 'p3-prod' }, product, info)),
    cell('Custo', numInput(key, `custo.${s.key}`, `Custo do produto (${s.label})`, { unit: 'R$/kg', compact: true })),
  );
}

function productInfo(name) {
  const p = PRODUTOS[name];
  return p ? `${nf(p.dose, p.dose < 0.1 ? 3 : 2)}% do PV · PB ${nf(p.pb, 0)}%` : '';
}

function card(title, subtitle, ...children) {
  return h('section', { class: 'p3-card' }, h('header', { class: 'p3-card-title' }, h('h2', {}, title), subtitle ? h('p', {}, subtitle) : null), ...children);
}

function group(title, ...fields) {
  return h('div', { class: 'p3-group' }, h('h3', {}, title), h('div', { class: 'p3-group-fields' }, ...fields));
}

function renderScenario(key) {
  const c = state[key];
  const n = key === 'c1' ? 1 : 2;
  const panel = document.querySelector(`[data-panel="${key}"]`);
  const days = Math.round((Date.parse(c.dataSaida) - Date.parse(c.dataEntrada)) / 86400000);
  const name = h('input', {
    class: 'p3-name',
    type: 'text',
    value: c.nome || '',
    placeholder: `Cenário ${n}`,
    maxlength: 40,
    'aria-label': `Nome do cenário ${n}`,
    oninput: () => {
      c.nome = name.value.trim();
      renderPreview(key);
    },
  });
  fill(
    panel,
    h(
      'div',
      { class: 'p3-scenario-head' },
      h('span', { class: `p3-badge c${n}` }, `C${n}`),
      h('div', {}, name, h('p', { class: 'muted' }, 'Dê um nome curto (ex.: "Topmost" ou "Pasto Bom") para reconhecer no Dashboard.')),
      key === 'c2' ? h('button', { class: 'btn btn-sm', type: 'button', onclick: copyC1 }, 'Copiar tudo do Cenário 1') : null,
    ),
    h(
      'div',
      { class: 'p3-layout' },
      h(
        'div',
        { class: 'p3-forms' },
        card(
          'Lote e período',
          null,
          h(
            'div',
            { class: 'p3-fields' },
            numField(key, 'pesoEntrada', 'Peso de entrada', { unit: 'kg' }),
            numField(key, 'animais', 'Número de animais', { unit: 'cab.' }),
            numField(key, 'area', 'Área', { unit: 'ha' }),
            segmented(key, 'sexo', 'Sexo', ['Macho', 'Fêmea']),
            dateField(key, 'dataEntrada', 'Entrada'),
            dateField(key, 'dataSaida', 'Saída'),
            h('div', { class: 'field' }, h('span', {}, 'Duração'), h('strong', { class: 'p3-duration' }, Number.isFinite(days) ? `${days} dias · ${nf(days / 30.42, 1)} meses` : '—')),
          ),
        ),
        card(
          'Pasto e épocas do ano',
          'Cada época tem o seu pasto, produto e custo. Na sobreposição, a Seca vale sobre a Transição; depois do último mês de transição/seca o ano volta às águas.',
          segmented(key, 'pasto', 'Pasto', Object.keys(PASTOS)),
          h('div', { class: 'p3-seasons' }, SEASONS.map((s) => seasonRow(key, s))),
          calendarStrip(c),
          sobreposicao(c) ? h('p', { class: 'alert' }, 'Transição e Seca estão sobrepostas: nos meses em comum, vale a Seca.') : null,
        ),
        card(
          'Custos e venda',
          'Valores por cabeça.',
          h(
            'div',
            { class: 'p3-groups' },
            group('Compra', numField(key, 'econ.compra', 'Valor de compra', { unit: 'R$' }), numField(key, 'econ.freteCompra', 'Frete', { unit: 'R$' }), numField(key, 'econ.comissao', 'Comissão', { unit: 'R$' })),
            group('Custos diários', numField(key, 'econ.aluguelDia', 'Aluguel de pasto', { unit: 'R$/dia' }), numField(key, 'econ.salgaDia', 'Salga', { unit: 'R$/dia' })),
            group('Mão de obra', numField(key, 'econ.salario', 'Salário', { unit: 'R$/mês' }), numField(key, 'econ.animaisPorFuncionario', 'Animais por funcionário', { unit: 'cab.' })),
            group('Outros custos', numField(key, 'econ.sanitario', 'Sanitário', { unit: 'R$' }), numField(key, 'econ.rastreabilidade', 'Rastreabilidade', { unit: 'R$' }), numField(key, 'econ.outros', 'Outros', { unit: 'R$' }), numField(key, 'econ.freteVenda', 'Frete na venda', { unit: 'R$' })),
            group('Venda', numField(key, 'econ.valorVenda', 'Valor de venda', { unit: 'R$/@' })),
          ),
        ),
        h('div', { class: 'p3-next' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => selectTab(key === 'c1' ? 'c2' : 'dashboard') }, key === 'c1' ? 'Ir para o Cenário 2 →' : 'Ver o Dashboard →')),
      ),
      h('aside', { class: 'p3-preview', id: `preview-${key}`, 'aria-live': 'polite' }),
    ),
  );
  renderPreview(key);
}

// Minicurva de peso (SVG puro) para a prévia.
function sparkline(dias, color) {
  if (!dias?.length) return null;
  const w = 260;
  const hgt = 64;
  const pesos = dias.map((d) => d.peso);
  const min = Math.min(...pesos);
  const max = Math.max(...pesos);
  const step = Math.max(1, Math.floor(dias.length / 120));
  const pts = dias
    .filter((_, i) => i % step === 0 || i === dias.length - 1)
    .map((d) => `${((d.i - 1) / Math.max(1, dias.length - 1)) * w},${hgt - 4 - ((d.peso - min) / Math.max(1, max - min)) * (hgt - 8)}`)
    .join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('class', 'p3-spark');
  svg.setAttribute('aria-hidden', 'true');
  const area = document.createElementNS(svg.namespaceURI, 'polygon');
  area.setAttribute('points', `0,${hgt} ${pts} ${w},${hgt}`);
  area.setAttribute('fill', color);
  area.setAttribute('opacity', '0.12');
  const line = document.createElementNS(svg.namespaceURI, 'polyline');
  line.setAttribute('points', pts);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linejoin', 'round');
  svg.append(area, line);
  return svg;
}

// Resultado do cenário sendo editado, ao lado do formulário.
function renderPreview(key) {
  const box = document.getElementById(`preview-${key}`);
  if (!box) return;
  const n = key === 'c1' ? 1 : 2;
  const s = state[`s${n}`];
  const c = state[key];
  if (!s) {
    fill(box, h('div', { class: 'p3-preview-card' }, h('h3', {}, 'Prévia'), h('ul', { class: 'p3-errors' }, state.erros[key].map((e) => h('li', {}, e)))));
    return;
  }
  const k = s.kpis;
  const row = (label, value, strong = false, extra = false) => h('div', { class: `p3-pv-row${strong ? ' strong' : ''}${extra ? ' extra' : ''}` }, h('span', {}, label), h('strong', {}, value));
  fill(
    box,
    h(
      'div',
      { class: 'p3-preview-card' },
      h('div', { class: 'p3-preview-head' }, h('span', { class: `p3-badge c${n}` }, `C${n}`), h('div', {}, h('h3', {}, c.nome || `Cenário ${n}`), h('small', {}, 'Prévia do resultado'))),
      h('div', { class: 'p3-pv-hero' }, h('span', {}, 'Peso final'), h('strong', {}, `${nf(k.pesoFinal, 1)} kg`), h('small', {}, `+${nf(k.ganhoTotal, 1)} kg em ${s.tempo} dias`)),
      sparkline(s.dias, cssVar(`--p3-c${n}`)),
      row('GPD', `${nf(k.gpd, 3)} kg/dia`),
      row('Faixa esperada', `${nf(k.gpdMin, 3)} a ${nf(k.gpdMax, 3)}`, false, true),
      row('@ produzidas por ha', nf(k.arrobasHa, 1), false, true),
      row('Custo da @ produzida', brl(k.custoArrobaProd, 1), false, true),
      row('Margem por cabeça', brl(k.margemCab, 1), true, true),
      row('Margem por hectare', brl(k.margemHa, 1), true),
      row('Rentabilidade', `${nf(k.rentabilidade, 2)}% ao mês`, false, true),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => selectTab('dashboard') }, 'Comparar no Dashboard'),
    ),
  );
}

function copyC1() {
  state.c2 = { ...structuredClone(state.c1), nome: state.c2.nome };
  recalc();
  renderScenario('c2');
  toast('Cenário 2 igual ao Cenário 1. Agora mude só o que quer comparar.');
}

// ---------- Cálculo ----------

let dashTimer = null;
function recalc() {
  for (const k of ['c1', 'c2']) {
    state.erros[k] = validar(state[k]);
    state[`s${k[1]}`] = state.erros[k].length ? null : simular(state[k]);
  }
  if (state.tab === 'c1' || state.tab === 'c2') renderPreview(state.tab);
  if (state.tab === 'dashboard') {
    clearTimeout(dashTimer);
    dashTimer = setTimeout(renderDashboard, 60);
  }
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

const nomeDe = (n) => state[`c${n}`]?.nome || `Cenário ${n}`;

// Frase de abertura do Dashboard: qual cenário rende mais por hectare, e por quanto.
function summary(s1, s2) {
  const a = s1.kpis.margemHa;
  const b = s2.kpis.margemHa;
  if (Math.abs(a - b) < 0.05) return h('div', { class: 'p3-summary' }, h('p', {}, 'Os dois cenários dão a mesma margem por hectare.'));
  const [win, lose, wk, lk] = a > b ? [1, 2, s1.kpis, s2.kpis] : [2, 1, s2.kpis, s1.kpis];
  const diffHa = Math.abs(a - b);
  const total = (diffHa * state[`c${win}`].area);
  return h(
    'div',
    { class: `p3-summary win-c${win}` },
    h('span', { class: `p3-badge c${win}` }, `C${win}`),
    h(
      'div',
      {},
      h('p', { class: 'p3-summary-main' }, h('strong', {}, nomeDe(win)), ' rende ', h('strong', {}, `${brl(diffHa, 0)}/ha a mais`), ` que ${nomeDe(lose)}.`),
      h(
        'p',
        { class: 'muted' },
        `Margem de ${brl(wk.margemHa, 0)}/ha contra ${brl(lk.margemHa, 0)}/ha · peso final ${nf(wk.pesoFinal, 1)} kg contra ${nf(lk.pesoFinal, 1)} kg · na área do ${nomeDe(win)}, cerca de ${brl(total, 0)} no período.`,
      ),
    ),
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
      h('strong', {}, nomeDe(n)),
      h('span', { class: 'muted' }, `${fmtDate(c.dataEntrada)} a ${fmtDate(c.dataSaida)} · ${s.tempo} dias · ${nf(c.animais, 0)} animais em ${nf(c.area, 0)} ha · ${[c.produto.aguas, c.produto.transicao, c.produto.seca].map((p) => p.replace(/^PROBEEF /, '')).join(' → ')}`),
    );

  fill(
    panel,
    warnings.length ? h('div', { class: 'alert' }, warnings.map((w) => h('div', {}, w))) : null,
    summary(s1, s2),
    h('div', { class: 'p3-scens' }, scen(1, s1, state.c1), scen(2, s2, state.c2)),
    h('div', { class: 'p3-kpis' }, KPIS.map(kpiTile)),
    h(
      'div',
      { class: 'p3-row' },
      h(
        'section',
        { class: 'p3-card' },
        h('h2', {}, 'Curva de peso corporal'),
        h(
          'ul',
          { class: 'p3-legend' },
          h('li', {}, h('span', { class: 'p3-key c1' }), nomeDe(1)),
          h('li', {}, h('span', { class: 'p3-key c2' }), nomeDe(2)),
          h('li', { class: 'p3-legend-ep' }, 'Fundo: épocas do C1'),
          [['ep-aguas1', 'Águas'], ['ep-trans', 'Transição'], ['ep-seca', 'Seca']].map(([cls, label]) => h('li', {}, h('span', { class: `p3-key-ep ${cls}` }), label)),
        ),
        h('div', { class: 'p3-chart' }, canvas),
      ),
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
  // Faixas de fundo com as épocas do Cenário 1 (trechos seguidos de mesma época).
  const bandColor = { [EPOCAS.AGUAS1]: cssVar('--ep-aguas1'), [EPOCAS.AGUAS2]: cssVar('--ep-aguas1'), [EPOCAS.TRANS]: cssVar('--ep-trans'), [EPOCAS.SECA]: cssVar('--ep-seca') };
  const bands = [];
  for (const d of s1.dias) {
    const x = Date.parse(`${d.data}T12:00:00Z`);
    const last = bands.at(-1);
    if (last && last.epoca === d.epoca) last.to = x;
    else bands.push({ epoca: d.epoca, from: x, to: x });
  }
  const seasonBands = {
    id: 'epocas',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      ctx.save();
      for (const b of bands) {
        const x1 = Math.max(chartArea.left, scales.x.getPixelForValue(b.from - 43200000));
        const x2 = Math.min(chartArea.right, scales.x.getPixelForValue(b.to + 43200000));
        ctx.fillStyle = bandColor[b.epoca];
        ctx.globalAlpha = 0.55;
        ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
      }
      ctx.restore();
    },
  };
  state.chart = new window.Chart(canvas, {
    type: 'line',
    plugins: [seasonBands],
    data: {
      datasets: [
        { label: nomeDe(1), data: toPoints(s1), borderColor: cssVar('--p3-c1'), backgroundColor: cssVar('--p3-c1'), borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, tension: 0 },
        { label: nomeDe(2), data: toPoints(s2), borderColor: cssVar('--p3-c2'), backgroundColor: cssVar('--p3-c2'), borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, tension: 0 },
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
    sheet('Comparação Geral', [['m', 'Métrica', 30], ['c1', `C1 · ${nomeDe(1)}`, 18], ['c2', `C2 · ${nomeDe(2)}`, 18]], generalRows().map(([m, c1, c2]) => ({ m, c1, c2 })));
    for (const [n, s] of [[1, state.s1], [2, state.s2]]) {
      sheet(`Cenário ${n} - Detalhado`, DETAIL_COLUMNS.map(([k, label]) => [k, label, k === 'ref' ? 22 : 14]), s.epocas.map((e) => ({ ...e, data: fmtDate(e.data) })));
    }
    sheet('Resumo GMD', [['ref', 'Estação', 22], ['c1', `C1 · ${nomeDe(1)}`, 18], ['c2', `C2 · ${nomeDe(2)}`, 18]], comparar(state.s1, state.s2).map((r) => ({ ref: r.ref, c1: r.c1?.gmd ?? null, c2: r.c2?.gmd ?? null })));
    sheet('Produtos Utilizados', [['c', 'Cenário', 15], ['e', 'Época', 18], ['p', 'Produto', 34]], [...state.s1.produtos.map((p) => ({ c: 'Cenário 1', e: p.epoca, p: p.produto })), ...state.s2.produtos.map((p) => ({ c: 'Cenário 2', e: p.epoca, p: p.produto }))]);
    sheet('Entradas', [['campo', 'Campo', 34], ['c1', `C1 · ${nomeDe(1)}`, 30], ['c2', `C2 · ${nomeDe(2)}`, 30]], inputRows());
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
  const f = (c, n) => ({
    Nome: nomeDe(n),
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
  const a = f(state.c1, 1);
  const b = f(state.c2, 2);
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
    table(['Métrica', `C1 · ${nomeDe(1)}`, `C2 · ${nomeDe(2)}`], generalRows().map(([m, a, b]) => [m, nf(a, m.startsWith('Dias') ? 0 : 2), nf(b, m.startsWith('Dias') ? 0 : 2)])),
    canvas ? [h('h2', {}, 'Curva de peso corporal'), h('img', { class: 'p3-print-chart', src: canvas.toDataURL('image/png'), alt: 'Curvas de peso dos dois cenários' })] : null,
    h('h2', {}, 'Comparação por época'),
    table(['Indicador', ...rows.flatMap((r) => [`C1 · ${r.ref}`, `C2 · ${r.ref}`])], VARIAVEIS.map(([k, label]) => [label, ...rows.flatMap((r) => [r.c1 ? nf(r.c1[k], casas(k)) : '—', r.c2 ? nf(r.c2[k], casas(k)) : '—'])])),
    h('h2', {}, 'GMD por época'),
    table(['Época', `C1 · ${nomeDe(1)}`, `C2 · ${nomeDe(2)}`], rows.map((r) => [r.ref, r.c1 ? nf(r.c1.gmd, 3) : '—', r.c2 ? nf(r.c2.gmd, 3) : '—'])),
    h('h2', {}, 'Produtos utilizados'),
    table(['Cenário', 'Época', 'Produto'], [...state.s1.produtos.map((p) => ['Cenário 1', p.epoca, p.produto]), ...state.s2.produtos.map((p) => ['Cenário 2', p.epoca, p.produto])]),
    h('h2', {}, 'Entradas'),
    table(['Campo', `C1 · ${nomeDe(1)}`, `C2 · ${nomeDe(2)}`], inputRows().map((r) => [r.campo, String(r.c1), String(r.c2)])),
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
  initTicker();
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

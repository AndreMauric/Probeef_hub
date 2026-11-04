// Semi Confinamento: três produtos (formulações) lado a lado numa recria/terminação a pasto com
// suplementação. Veio do app "Semi Confinamento Probeef" do Power Apps; o cálculo está em model.js.
// As simulações ficam no portal (/api/semi/simulations), no lugar da lista do SharePoint.
import { api, h, toast } from '/js/common.js';
import { initTicker } from '/js/ticker.js';
import { buildExcel, buildPrint } from './report.js';
import { CONSUMOS, ESPECIES, FERTILIDADE, MANEJO, N_ING, QUALIDADES, SUPLEMENTACAO, avisos, calc, defaultData, desempenhoSugerido, formula, gradeCompraVenda, gradeMilhoVenda, lotacao } from './model.js';

const dialog = document.getElementById('dialog');
const panel = (name) => document.querySelector(`[data-panel="${name}"]`);
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const state = {
  tab: 'cadastro',
  data: defaultData(),
  sim: null, // simulação salva aberta
  dirty: false,
  userName: '',
};
const prods = () => state.data.prods;
const ing = () => state.data.ing;

// ---------- Formatação ----------

const nf = (dec) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmt = (v, dec = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : nf(dec).format(v));
const pct = (v, dec = 2) => (v === null || !Number.isFinite(v) ? '—' : `${fmt(v * 100, dec)}%`);
const parseNum = (s) => {
  const t = String(s ?? '').trim().replace(/\s/g, '');
  if (!t) return 0;
  return Number(/,/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t);
};
// Número no campo: vírgula decimal, sem separador de milhar (para editar sem tropeçar).
const asInput = (v, dec) => (v === 0 || v === null || v === undefined ? '' : fmt(v, dec ?? (Number.isInteger(v) ? 0 : 2)).replace(/\./g, ''));

// ---------- Recalcular sem redesenhar os campos ----------

// Cada valor calculado na tela se registra aqui; mudar um campo recalcula e atualiza só esses valores
// (redesenhar a aba inteira tiraria o foco de quem está passando de um campo para o outro com Tab).
let outs = [];
let R = [];
function recompute() {
  R = prods().map((p) => calc(p, ing()));
  for (const f of outs) f();
}
const live = (fn, tag = 'span', attrs = {}) => {
  const el = h(tag, attrs);
  const upd = () => {
    const v = fn();
    el.replaceChildren(...[v].flat().filter((x) => x !== null && x !== undefined));
  };
  outs.push(upd);
  upd();
  return el;
};
function markDirty() {
  state.dirty = true;
  showSimName();
}
function changed() {
  markDirty();
  recompute();
}

function numInput(obj, key, opts = {}) {
  const input = h('input', { type: 'text', inputmode: 'decimal', value: asInput(obj[key], opts.dec), 'aria-label': opts.label || key, placeholder: '0' });
  // Ao entrar no campo, seleciona o valor: digitar já substitui.
  input.addEventListener('focus', () => input.select());
  input.addEventListener('change', () => {
    const v = parseNum(input.value);
    if (!Number.isFinite(v) || v < 0) {
      toast(`Valor inválido${opts.label ? ` em "${opts.label}"` : ''}.`, 'error');
      input.value = asInput(obj[key], opts.dec);
      return;
    }
    obj[key] = v;
    changed();
    opts.after?.();
  });
  return opts.suffix ? h('span', { class: 'sc-input' }, input, h('span', { class: 'sc-suffix' }, opts.suffix)) : input;
}

function selInput(obj, key, options, opts = {}) {
  return h(
    'select',
    { 'aria-label': opts.label || key, onchange: (e) => ((obj[key] = options.find((o) => String(o[0]) === e.target.value)[0]), changed(), opts.after?.()) },
    options.map(([v, t]) => h('option', { value: String(v), selected: obj[key] === v }, t)),
  );
}

function textInput(obj, key, attrs = {}) {
  return h('input', { type: 'text', value: obj[key] || '', ...attrs, oninput: (e) => ((obj[key] = e.target.value), markDirty(), attrs.after?.()) });
}

// ---------- Tabela de três colunas (uma por produto) ----------

// Linha: { sec } = título de seção; { key } = campo do produto; { get(r, p) } = valor calculado.
const prodName = (i) => prods()[i].nome || `Produto ${i + 1}`;
// Cada produto tem uma cor fixa em todas as abas (--p1..--p3 em semi.css); o nome sempre vai junto.
const dot = (i) => h('span', { class: `sc-dot p${i + 1}`, 'aria-hidden': 'true' });
const prodLabel = (i) => h('span', { class: 'sc-prod' }, dot(i), live(() => prodName(i)));

function grid(rows, opts = {}) {
  const head = h('tr', {}, h('th', {}, opts.first || 'Variável'), [0, 1, 2].map((i) => h('th', { class: 'sc-col' }, prodLabel(i))));
  const body = rows.map((row) => {
    if (row.sec) return h('tr', { class: 'sc-sec' }, h('td', { colspan: 4 }, row.sec));
    const label = h('td', { class: 'sc-var' }, h('span', {}, row.label), row.unit ? h('span', { class: 'sub' }, row.unit) : null);
    const cells = [0, 1, 2].map((i) => {
      const p = prods()[i];
      if (row.key && row.options) return h('td', {}, selInput(p, row.key, row.options, { label: `${row.label} · ${prodName(i)}` }));
      if (row.key) return h('td', {}, numInput(p, row.key, { dec: row.dec, label: `${row.label} · ${prodName(i)}`, suffix: row.suffix }));
      return h(
        'td',
        { class: 'sc-out' },
        live(() => {
          const v = row.get(R[i], p, i);
          if (typeof v === 'string' || v === null) return v ?? '—';
          const neg = row.signed && v < 0;
          return h(row.strong ? 'strong' : 'span', { class: neg ? 'sc-neg' : '' }, row.pct ? pct(v) : fmt(v, row.dec ?? 2));
        }),
        row.extra ? row.extra(i) : null,
      );
    });
    return h('tr', { class: row.key ? 'sc-in' : 'sc-calc' }, label, cells);
  });
  return h('div', { class: 'table-wrap' }, h('table', { class: 'sc-table' }, h('thead', {}, head), h('tbody', {}, body)));
}

const card = (title, sub, ...children) => h('section', { class: 'sc-card' }, h('div', { class: 'sc-card-head' }, h('div', {}, h('h2', {}, title), sub ? h('p', { class: 'muted' }, sub) : null)), ...children);
// Legenda dos campos: branco = preencher, sombreado = calculado.
const legenda = () => h('p', { class: 'sc-legend' }, h('span', { class: 'sc-key in' }), 'você preenche', h('span', { class: 'sc-key calc' }), 'calculado na hora');
// Bloco recolhível (os detalhes dos Resultados).
const fold = (title, sub, open, ...children) => h('details', { class: 'sc-card sc-fold', open }, h('summary', {}, h('span', {}, h('strong', {}, title), sub ? h('span', { class: 'muted' }, ` · ${sub}`) : null)), ...children);

// Barra fixa no rodapé das abas de entrada: o resultado de cada produto muda enquanto se preenche.
const STEPS = ['cadastro', 'formulacao', 'zootecnico', 'financeiro', 'resultados', 'risco'];
const STEP_NAME = { cadastro: 'Cadastro', formulacao: 'Formulação', zootecnico: 'Zootécnico', financeiro: 'Financeiro', resultados: 'Resultados', risco: 'Análise de risco' };
function summaryBar(tab) {
  const next = STEPS[STEPS.indexOf(tab) + 1];
  return h(
    'div',
    { class: 'sc-summary' },
    h('span', { class: 'sc-summary-label' }, 'Lucro agora'),
    [0, 1, 2].map((i) =>
      live(
        () => {
          const r = R[i];
          return [dot(i), h('span', { class: 'sc-summary-name' }, prodName(i)), h('strong', { class: r.lucroHa < 0 ? 'sc-neg' : '' }, `R$ ${fmt(r.lucroHa, 0)}/ha`), h('span', { class: 'muted' }, pct(r.rentMes, 1), ' a.m.')];
        },
        'button',
        { class: 'sc-summary-item', type: 'button', title: 'Ver os resultados', onclick: () => selectTab('resultados') },
      ),
    ),
    next ? h('button', { class: 'btn btn-primary btn-sm sc-summary-next', type: 'button', onclick: () => selectTab(next) }, `${STEP_NAME[next]} →`) : null,
  );
}

// ---------- 1. Cadastro ----------

function renderCadastro() {
  const c = state.data.cadastro;
  const f = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
  const estado = h('select', { onchange: (e) => ((c.estado = e.target.value), markDirty()) }, h('option', { value: '' }, '—'), UFS.map((uf) => h('option', { value: uf, selected: c.estado === uf }, uf)));
  panel('cadastro').replaceChildren(
    card(
      'Dados da visita',
      'Identificam a simulação em "Minhas simulações". Nada aqui é obrigatório: dá para ir direto à Formulação.',
      h(
        'div',
        { class: 'sc-fields' },
        f('Proprietário', textInput(c, 'proprietario')),
        f('Fazenda', textInput(c, 'fazenda')),
        f('Data da visita', h('input', { type: 'date', value: c.dataVisita || '', onchange: (e) => ((c.dataVisita = e.target.value), markDirty()) })),
        f('Cidade', textInput(c, 'cidade')),
        f('Estado', estado),
        f('Visita nº', textInput(c, 'nVisita', { inputmode: 'numeric' })),
      ),
      h('h3', { class: 'sc-subtitle' }, 'Equipe Probeef'),
      h(
        'div',
        { class: 'sc-fields' },
        f('Coordenador', textInput(c, 'coordenador')),
        f('Telefone do coordenador', textInput(c, 'telCoordenador', { inputmode: 'tel' })),
        f('E-mail do coordenador', textInput(c, 'emailCoordenador', { type: 'email' })),
        f('ATC', textInput(c, 'atc')),
        f('Telefone do ATC', textInput(c, 'telAtc', { inputmode: 'tel' })),
        f('E-mail do ATC', textInput(c, 'emailAtc', { type: 'email' })),
      ),
    ),
    summaryBar('cadastro'),
  );
}

// ---------- 2. Formulação ----------

function renderFormulacao() {
  const P = prods();
  const head = h(
    'tr',
    {},
    h('th', {}, 'Ingrediente'),
    h('th', { class: 'sc-col' }, 'Preço', h('span', { class: 'sc-th-unit' }, 'R$/t MN')),
    P.map((p, i) => h('th', { class: 'sc-col' }, h('span', { class: 'sc-prod sc-prod-edit' }, dot(i), textInput(p, 'nome', { class: 'sc-prodname', title: 'Clique para trocar o nome do produto', 'aria-label': `Nome do produto ${i + 1}`, maxlength: 40, after: () => outs.forEach((f) => f()) })), h('span', { class: 'sc-th-unit' }, 'inclusão, % MN'))),
  );
  const rows = ing().map((x, j) =>
    h(
      'tr',
      { class: 'sc-in' },
      h('td', {}, textInput(x, 'nome', { 'aria-label': `Ingrediente ${j + 1}`, maxlength: 40 })),
      h('td', {}, numInput(x, 'preco', { label: `Preço · ${x.nome}` })),
      P.map((p, i) => h('td', {}, numInput(p.incl, j, { label: `Inclusão · ${x.nome} · produto ${i + 1}`, suffix: '%' }))),
    ),
  );
  const f = P.map((p) => () => formula(p, ing()));
  const foot = [
    h(
      'tr',
      { class: 'sc-total' },
      h('td', { colspan: 2 }, 'Total da fórmula'),
      P.map((p, i) =>
        h(
          'td',
          { class: 'sc-out' },
          live(() => {
            const t = f[i]().inclTotal;
            const ok = Math.abs(t - 100) <= 0.05;
            return [
              h('span', { class: ok ? 'sc-ok' : 'sc-warn' }, ok ? '✓ ' : t > 100 ? '▲ ' : '▼ ', `${fmt(t, 1)}%`),
              h('span', { class: `sc-meter${ok ? ' ok' : t > 100 ? ' over' : ''}`, role: 'img', 'aria-label': `${fmt(t, 1)}% de 100%` }, h('span', { style: `width:${Math.min(t, 100)}%` })),
            ];
          }),
        ),
      ),
    ),
    h('tr', { class: 'sc-calc' }, h('td', { colspan: 2 }, 'Custo da fórmula', h('span', { class: 'sub' }, 'R$/t')), P.map((p, i) => h('td', { class: 'sc-out' }, live(() => fmt(f[i]().custoFormula, 2))))),
    h('tr', { class: 'sc-in' }, h('td', { colspan: 2 }, 'Custo de produção', h('span', { class: 'sub' }, 'R$/t (mistura, frete da ração…)')), P.map((p, i) => h('td', {}, numInput(p, 'custoProd', { label: `Custo de produção · produto ${i + 1}` })))),
    h('tr', { class: 'sc-total' }, h('td', { colspan: 2 }, 'Custo final', h('span', { class: 'sub' }, 'R$/kg MN')), P.map((p, i) => h('td', { class: 'sc-out' }, live(() => h('strong', {}, fmt(f[i]().custoKg, 3)))))),
  ];
  panel('formulacao').replaceChildren(
    card(
      'Formulação',
      'Preço de cada ingrediente (R$ por tonelada, matéria natural) e quanto entra em cada produto. A fórmula de cada produto precisa somar 100%.',
      legenda(),
      h('div', { class: 'table-wrap' }, h('table', { class: 'sc-table sc-formula' }, h('thead', {}, head), h('tbody', {}, rows, foot))),
    ),
    summaryBar('formulacao'),
  );
}

// ---------- 3. Zootécnico ----------

const ZOO_ROWS = [
  { sec: 'Animais e lotação' },
  { label: 'Número de animais', unit: 'cab', key: 'n', dec: 0 },
  { label: 'Peso inicial', unit: 'kg', key: 'pi', dec: 0 },
  { label: 'Rendimento de carcaça inicial', unit: '%', key: 'rci', suffix: '%' },
  { label: 'Arrobas iniciais', unit: '@/cab', get: (r) => r.arrobaIni },
  { label: 'Lotação', unit: 'UA/ha · veja a tabela auxiliar abaixo', key: 'lotUA' },
  { label: 'Lotação', unit: 'animais/ha', get: (r) => r.lotHa },
  { sec: 'Consumo do suplemento' },
  { label: 'Consumo de MN', unit: '% do peso vivo', key: 'cmn', options: CONSUMOS.map((c) => [c, `${fmt(c, 1)}%`]) },
  { label: 'Consumo de MN', unit: 'kg/cab/dia (no peso médio)', get: (r) => r.cmnKg },
  { label: 'Custo do concentrado', unit: 'R$/kg', get: (r) => r.custoKg, dec: 3 },
  { sec: 'Desempenho' },
  { label: 'Condição do pasto', unit: 'qualidade', key: 'qualidade', options: QUALIDADES.map((q) => [q, q.charAt(0) + q.slice(1).toLowerCase()]) },
  { label: 'Desempenho sugerido', unit: 'kg/dia, macho inteiro', get: (r) => r.sugerido, extra: (i) => h('button', { class: 'btn btn-sm btn-ghost sc-use', type: 'button', onclick: () => useGmd(i) }, 'usar') },
  { label: 'Ganho médio diário (GMD)', unit: 'kg/dia', key: 'gmd', dec: 3 },
  { label: 'Número de dias', unit: 'dias', key: 'dias', dec: 0 },
  { label: 'Peso de abate', unit: 'kg', get: (r) => r.pesoAbate, dec: 1 },
  { label: 'Rendimento de carcaça final', unit: '%', key: 'rc', suffix: '%' },
  { label: 'Peso de carcaça', unit: '@', get: (r) => r.pesoCarc },
  { label: 'Arrobas produzidas', unit: '@/cab', get: (r) => r.arrobaProd, strong: true, signed: true },
  { label: 'Arrobas produzidas', unit: '@/ha', get: (r) => r.arrobaHa, strong: true, signed: true },
];

function useGmd(i) {
  const s = desempenhoSugerido(prods()[i].qualidade, prods()[i].cmn);
  if (s === null) return;
  prods()[i].gmd = s;
  changed();
  renderZootecnico();
}

function lotacaoCard() {
  const P = prods();
  const rows = [
    ['Espécie forrageira', 'especie', ESPECIES.map((e) => [e.nome, e.nome])],
    ['Fertilidade do solo', 'fertilidade', FERTILIDADE.map(([n]) => [n, n])],
    ['Manejo', 'manejo', MANEJO.map(([n]) => [n, n])],
    ['Suplementação', 'suplementacao', SUPLEMENTACAO.map(([n]) => [n, n])],
  ];
  const use = (i, epoca) => {
    const v = lotacao(P[i].lot)[epoca];
    if (v === null) return;
    P[i].lotUA = v;
    changed();
    renderZootecnico();
  };
  const outRow = (label, epoca) =>
    h(
      'tr',
      { class: 'sc-total' },
      h('td', { class: 'sc-var' }, h('span', {}, label), h('span', { class: 'sub' }, 'UA/ha')),
      P.map((p, i) => h('td', { class: 'sc-out' }, live(() => h('strong', {}, fmt(lotacao(p.lot)[epoca], 2))), h('button', { class: 'btn btn-sm btn-ghost sc-use', type: 'button', onclick: () => use(i, epoca) }, 'usar'))),
    );
  return card(
    'Tabela auxiliar · taxa de lotação',
    'Estimativa de UA/ha pela produção de forragem: espécie (+ nitrogênio), fertilidade, época, manejo e suplementação. "usar" copia o valor para a lotação acima.',
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'sc-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Pasto'), [0, 1, 2].map((i) => h('th', { class: 'sc-col' }, live(() => prodName(i)))))),
        h(
          'tbody',
          {},
          rows.map(([label, key, options]) => h('tr', { class: 'sc-in' }, h('td', { class: 'sc-var' }, label), P.map((p, i) => h('td', {}, selInput(p.lot, key, options, { label: `${label} · produto ${i + 1}` }))))),
          h('tr', { class: 'sc-in' }, h('td', { class: 'sc-var' }, h('span', {}, 'Nitrogênio'), h('span', { class: 'sub' }, 'kg N/ha')), P.map((p, i) => h('td', {}, numInput(p.lot, 'n', { dec: 0, label: `Nitrogênio · produto ${i + 1}` })))),
          outRow('Águas / transição', 'aguas'),
          outRow('Seca', 'seca'),
        ),
      ),
    ),
  );
}

function desempenhoCard() {
  return card(
    'Desempenho sugerido',
    'GMD previsto para macho inteiro, pela condição do pasto e pelo consumo do suplemento. Machos castrados: 10% abaixo. Fêmeas Nelore: 15% abaixo. Fêmeas cruzadas: igual ao macho inteiro.',
    h(
      'div',
      { class: 'table-wrap sc-narrow' },
      h(
        'table',
        { class: 'sc-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Pasto'), CONSUMOS.map((c) => h('th', { class: 'sc-col' }, `${fmt(c, 1)}% PV`)))),
        h('tbody', {}, QUALIDADES.map((q) => h('tr', {}, h('td', {}, q.charAt(0) + q.slice(1).toLowerCase()), CONSUMOS.map((c) => h('td', { class: 'sc-out' }, fmt(desempenhoSugerido(q, c), 2)))))),
      ),
    ),
  );
}

function renderZootecnico() {
  outs = [];
  panel('zootecnico').replaceChildren(
    card('Informações zootécnicas', 'Campo em branco conta como zero. Os valores calculados mudam assim que você sai do campo.', legenda(), grid(ZOO_ROWS)),
    lotacaoCard(),
    desempenhoCard(),
    summaryBar('zootecnico'),
  );
  recompute();
}

// ---------- 4. Financeiro ----------

const FIN_ROWS = [
  { sec: 'Custos de entrada' },
  { label: 'Custo inicial', unit: 'R$/@ (preço do boi magro)', key: 'custoIni' },
  { label: 'Frete', unit: 'R$/cab', key: 'frete' },
  { label: 'Comissão de compra', unit: 'R$/cab', key: 'comissao' },
  { label: 'Custo inicial', unit: 'R$/cab', get: (r) => r.custoIniCab, strong: true },
  { sec: 'Custos operacionais' },
  { label: 'Aluguel de pasto', unit: 'R$/cab/mês', key: 'aluguel' },
  { label: 'Protocolo sanitário', unit: 'R$/cab no período', key: 'sanitario' },
  { label: 'Rastreabilidade', unit: 'R$/cab no período', key: 'rastreab' },
  { label: 'Custo operacional', unit: 'R$/cab/dia', key: 'operacional' },
  { label: 'Custo total sem o suplemento', unit: 'R$/cab/dia', get: (r) => r.custoCabDia, strong: true },
  { sec: 'Venda' },
  { label: 'Valor de venda', unit: 'R$/@', key: 'venda' },
  { label: 'Venda do boi gordo', unit: 'R$/cab', get: (r) => r.receita, strong: true },
  { sec: 'Taxas e impostos' },
  { label: 'Taxa Indea', unit: 'R$/cab', key: 'indea' },
  { label: 'Funrural', unit: 'R$/cab', key: 'funrural' },
  { label: 'Comissão de venda', unit: 'R$/cab', key: 'comissaoVenda' },
  { label: 'Total de taxas', unit: 'R$/cab', get: (r) => r.taxas, strong: true },
];

function renderFinanceiro() {
  outs = [];
  panel('financeiro').replaceChildren(
    card('Informações financeiras', 'Valores por cabeça, salvo onde a unidade diz outra coisa.', legenda(), grid(FIN_ROWS)),
    summaryBar('financeiro'),
  );
  recompute();
}

// ---------- 5. Resultados ----------

const RES_ZOO = [
  { label: 'Ganho médio diário', unit: 'kg/dia', get: (r, p) => p.gmd, dec: 3 },
  { label: 'Número de dias', unit: 'dias', get: (r, p) => p.dias, dec: 0 },
  { label: 'Peso inicial → abate', unit: 'kg', get: (r, p) => `${fmt(p.pi, 0)} → ${fmt(r.pesoAbate, 1)}` },
  { label: 'Peso médio', unit: 'kg', get: (r) => r.pesoMedio, dec: 1 },
  { label: 'Rendimento de carcaça final', unit: '%', get: (r, p) => p.rc, dec: 1 },
  { label: 'Peso de carcaça', unit: '@', get: (r) => r.pesoCarc },
  { label: 'Arrobas produzidas', unit: '@/cab', get: (r) => r.arrobaProd, strong: true, signed: true },
  { label: 'Lotação', unit: 'animais/ha', get: (r) => r.lotHa },
  { label: 'Arrobas produzidas', unit: '@/ha', get: (r) => r.arrobaHa, strong: true, signed: true },
  { label: 'Consumo do suplemento', unit: 'kg MN/cab/dia', get: (r) => r.cmnKg },
];
const RES_CUSTO = [
  { label: 'Custo do suplemento', unit: 'R$/cab/dia', get: (r) => r.custoAlimDia },
  { label: 'Custo total por dia', unit: 'R$/cab/dia', get: (r) => r.custoTotalDia },
  { label: 'Custo do suplemento no período', unit: 'R$/cab', get: (r) => r.custoAlim },
  { label: 'Custo suplemento + operacional', unit: 'R$/cab', get: (r) => r.custoAlimOp },
  { label: 'Custo da @ produzida (suplemento)', unit: 'R$/@', get: (r) => r.custoArrobaAlim },
  { label: 'Custo da @ produzida (suplemento + operacional)', unit: 'R$/@', get: (r) => r.custoArroba, strong: true },
  { label: 'Custo inicial', unit: 'R$/cab', get: (r) => r.custoIniCab },
  { label: 'Taxas e impostos', unit: 'R$/cab', get: (r) => r.taxas },
  { label: 'Custo total', unit: 'R$/cab', get: (r) => r.custoTotal, strong: true },
  { label: 'Custo total', unit: 'R$/ha', get: (r) => r.custoTotalHa },
];
const RES_RESULT = [
  { label: 'Venda do boi gordo', unit: 'R$/cab', get: (r) => r.receita },
  { label: 'Lucro', unit: 'R$/cab', get: (r) => r.lucro, strong: true, signed: true },
  { label: 'Lucro', unit: 'R$/ha', get: (r) => r.lucroHa, strong: true, signed: true },
  { label: 'Rentabilidade', unit: '% no período', get: (r) => r.rentPeriodo, pct: true, signed: true },
  { label: 'Rentabilidade', unit: '% ao mês', get: (r) => r.rentMes, pct: true, signed: true, strong: true },
  { label: 'Rentabilidade', unit: '% ao ano (mensal × 12)', get: (r) => r.rentAno, pct: true, signed: true },
  { label: 'Ponto de equilíbrio', unit: 'R$/@ de venda que zera o lucro', get: (r) => r.equilibrio },
  { label: 'Valor máximo do boi magro', unit: 'R$/@ de compra que zera o lucro', get: (r) => r.boiMagroMax },
  { sec: 'Comparação com a lavoura' },
  { label: 'Saco de milho', unit: 'R$/saca', key: 'sacaMilho' },
  { label: 'Lucro em sacas de milho', unit: 'sc/ha', get: (r) => r.sacasMilhoHa, signed: true },
  { label: 'Saco de soja', unit: 'R$/saca', key: 'sacaSoja' },
  { label: 'Lucro em sacas de soja', unit: 'sc/ha', get: (r) => r.sacasSojaHa, signed: true },
];

function kpis() {
  return h(
    'div',
    { class: 'sc-kpis' },
    [0, 1, 2].map((i) =>
      live(
        () => {
          const r = R[i];
          const best = R.every((x, k) => k === i || x.lucroHa < r.lucroHa) && R.length > 1;
          const warn = avisos(prods()[i], ing());
          return [
            h('div', { class: 'sc-kpi-head' }, h('span', { class: 'sc-prod' }, dot(i), h('strong', {}, prodName(i))), best ? h('span', { class: 'pill pill-ok' }, '★ maior lucro/ha') : null),
            h('span', { class: 'sc-kpi-cap' }, 'Lucro por hectare'),
            h('div', { class: `sc-kpi-big${r.lucroHa < 0 ? ' sc-neg' : ''}` }, `R$ ${fmt(r.lucroHa, 0)}`, h('span', {}, '/ha')),
            h('dl', {}, h('dt', {}, 'Lucro'), h('dd', { class: r.lucro < 0 ? 'sc-neg' : '' }, `R$ ${fmt(r.lucro, 2)}/cab`), h('dt', {}, 'Rentabilidade'), h('dd', {}, `${pct(r.rentMes)} ao mês`), h('dt', {}, 'Custo da @ produzida'), h('dd', {}, `R$ ${fmt(r.custoArroba, 2)}`), h('dt', {}, '@ produzidas'), h('dd', {}, `${fmt(r.arrobaHa, 2)} @/ha`)),
            warn.length ? h('ul', { class: 'sc-warnlist' }, warn.map((w) => h('li', {}, w))) : null,
          ];
        },
        'div',
        { class: `sc-kpi p${i + 1}` },
      ),
    ),
  );
}

// Comparação lado a lado: uma barra por produto (cor do produto + nome + valor), a partir do zero.
const COMPARA = [
  { label: 'Lucro', unit: 'R$/ha', get: (r) => r.lucroHa, dec: 0, better: 'max' },
  { label: 'Lucro', unit: 'R$/cab', get: (r) => r.lucro, dec: 2, better: 'max' },
  { label: 'Rentabilidade', unit: '% ao mês', get: (r) => r.rentMes, pct: true, better: 'max' },
  { label: '@ produzidas', unit: '@/ha', get: (r) => r.arrobaHa, dec: 2, better: 'max' },
  { label: 'Custo da @ produzida', unit: 'R$/@ · menor é melhor', get: (r) => r.custoArroba, dec: 2, better: 'min' },
  { label: 'Ponto de equilíbrio', unit: 'R$/@ de venda · menor é melhor', get: (r) => r.equilibrio, dec: 2, better: 'min' },
];

function comparacao() {
  return card(
    'Comparação entre os produtos',
    'Cada barra começa no zero; a estrela marca o melhor em cada indicador.',
    live(
      () =>
        COMPARA.map((m) => {
          const vals = R.map((r) => m.get(r));
          const ok = vals.filter((v) => Number.isFinite(v));
          const max = Math.max(...ok.map((v) => Math.abs(v)), 1e-9);
          const best = ok.length ? (m.better === 'max' ? Math.max(...ok) : Math.min(...ok)) : null;
          return h(
            'div',
            { class: 'sc-cmp' },
            h('div', { class: 'sc-cmp-label' }, h('strong', {}, m.label), h('span', { class: 'muted' }, m.unit)),
            h(
              'div',
              { class: 'sc-cmp-bars' },
              vals.map((v, i) => {
                const txt = m.pct ? pct(v, 2) : fmt(v, m.dec);
                const w = Number.isFinite(v) ? (Math.abs(v) / max) * 100 : 0;
                return h(
                  'div',
                  { class: 'sc-cmp-row', title: `${prodName(i)}: ${txt} ${m.unit.split(' ·')[0]}` },
                  h('span', { class: 'sc-cmp-name' }, prodName(i)),
                  h('span', { class: 'sc-cmp-track' }, h('span', { class: `sc-cmp-bar p${i + 1}${v < 0 ? ' neg' : ''}`, style: `width:${w}%` })),
                  h('span', { class: `sc-cmp-val${v < 0 ? ' sc-neg' : ''}` }, v === best && ok.length > 1 ? '★ ' : '', txt),
                );
              }),
            ),
          );
        }),
      'div',
      { class: 'sc-cmps' },
    ),
  );
}

function renderResultados() {
  outs = [];
  panel('resultados').replaceChildren(
    kpis(),
    comparacao(),
    fold('Resultado econômico', 'lucro, rentabilidade, ponto de equilíbrio e comparação com milho e soja', true, grid(RES_RESULT)),
    fold('Custos', 'suplemento, operacional, custo da @ e custo total', false, grid(RES_CUSTO)),
    fold('Resultado zootécnico', 'pesos, arrobas e lotação', false, grid(RES_ZOO)),
    h('div', { class: 'sc-next' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => selectTab('risco') }, 'Análise de risco →')),
  );
  recompute();
}

// ---------- 6. Análise de risco ----------

// Preço inteiro sem casas (as grades cabem melhor); com centavos, duas casas.
const preco = (v) => fmt(v, Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2);

function heat(grade, corner, fmtLinha) {
  const max = Math.max(1, ...grade.valores.flat().map((v) => Math.abs(v)));
  return h(
    'table',
    { class: 'sc-heat' },
    h('thead', {}, h('tr', {}, h('th', { class: 'sc-corner' }, corner), grade.colunas.map((v) => h('th', {}, fmtLinha(v))))),
    h(
      'tbody',
      {},
      grade.linhas.map((l, a) =>
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, fmtLinha(l)),
          grade.valores[a].map((v, b) => {
            const t = Math.round((Math.abs(v) / max) * 55) + 8;
            return h('td', { class: `${v < 0 ? 'neg' : 'pos'}${a === 2 && b === 2 ? ' mid' : ''}`, style: `--t:${t}%`, title: `${fmt(v, 2)} R$/ha` }, fmt(v, 0));
          }),
        ),
      ),
    ),
  );
}

function renderRisco() {
  outs = [];
  const Rk = state.data.risco;
  const rerender = () => renderRisco();
  const ctl = (label, key, suffix) => h('label', { class: 'field' }, h('span', {}, label), numInput(Rk, key, { label, suffix, after: rerender }));
  const milhoSel = h(
    'label',
    { class: 'field' },
    h('span', {}, 'Ingrediente que é o milho'),
    selInput(
      Rk,
      'milho',
      ing().map((x, j) => [j, x.nome || `Ingrediente ${j + 1}`]),
      { label: 'Ingrediente que é o milho', after: rerender },
    ),
  );
  recompute();
  const P = prods();
  const saca = (ing()[Rk.milho]?.preco / 1000) * 60;
  const blocos = (titulo, sub, fn, corner, fmtLinha) =>
    card(
      titulo,
      sub,
      h(
        'div',
        { class: 'sc-heats' },
        P.map((p, i) => {
          const g = fn(p, ing(), Rk);
          return h('div', { class: 'sc-heatbox' }, h('h3', { class: 'sc-prod' }, dot(i), prodName(i)), g.semMilho ? h('p', { class: 'sc-callout' }, 'Este produto não tem o ingrediente escolhido como milho: o preço do milho não muda o resultado.') : null, h('div', { class: 'sc-heatwrap' }, heat(g, corner, fmtLinha)));
        }),
      ),
    );
  panel('risco').replaceChildren(
    card(
      'Análise de risco',
      'Lucro em R$/ha para cada combinação de preços, dois passos para baixo e dois para cima. A célula do meio (com borda) é a dos Resultados. Verde: lucro; vermelho: prejuízo; quanto mais forte, maior o valor.',
      h('p', { class: 'sc-heat-legend' }, h('span', { class: 'sc-swatch neg' }), 'prejuízo', h('span', { class: 'sc-swatch zero' }), 'perto de zero', h('span', { class: 'sc-swatch pos' }), 'lucro', h('span', { class: 'sc-swatch mid' }), 'preços de hoje (os dos Resultados)'),
      h('div', { class: 'sc-ctl' }, ctl('Passo do valor de compra', 'passoCompra', 'R$/@'), ctl('Passo do valor de venda', 'passoVenda', 'R$/@'), ctl('Passo do preço do milho', 'passoMilho', 'R$/sc'), milhoSel),
    ),
    blocos('Valor de compra × valor de venda', 'Linhas: valor de compra do boi magro (R$/@). Colunas: valor de venda do boi gordo (R$/@).', gradeCompraVenda, 'Compra ↓ · Venda →', preco),
    blocos(
      'Preço do milho × valor de venda',
      `Linhas: preço do milho (R$/saca de 60 kg; hoje R$ ${fmt(saca, 2)}, a partir de R$ ${fmt(ing()[Rk.milho]?.preco, 0)}/t na Formulação). Colunas: valor de venda (R$/@). O custo do suplemento é refeito com o milho de cada linha.`,
      gradeMilhoVenda,
      'Milho ↓ · Venda →',
      preco,
    ),
  );
}

// ---------- Como funciona ----------

function renderAjuda() {
  const li = (t) => h('li', {}, t);
  panel('ajuda').replaceChildren(
    card(
      'Como o cálculo é feito',
      'Mesmas contas do app "Semi Confinamento Probeef" do Power Apps, para cada produto (coluna).',
      h(
        'ul',
        { class: 'sc-help' },
        li('Custo do suplemento (R$/kg) = (Σ preço do ingrediente × inclusão + custo de produção) ÷ 1000.'),
        li('Peso de abate = peso inicial + GMD × dias. Peso de carcaça (@) = peso de abate × rendimento final ÷ 15. Arrobas produzidas = peso de carcaça − peso inicial × rendimento inicial ÷ 15.'),
        li('Lotação (animais/ha) = UA/ha × 450 ÷ peso médio, com peso médio = (inicial + abate) ÷ 2. @/ha = @ produzidas × animais/ha.'),
        li('Consumo do suplemento (kg/cab/dia) = peso médio × % do PV. Custo do suplemento por dia = consumo × custo por kg.'),
        li('Custo por dia sem o suplemento = aluguel ÷ 30,4 + (sanitário + rastreabilidade) ÷ dias + custo operacional.'),
        li('Custo total (R$/cab) = custo inicial (preço da @ × @ iniciais + frete + comissão) + (suplemento + custo do dia) × dias + taxas (Indea, Funrural e comissão de venda).'),
        li('Lucro = preço de venda × peso de carcaça − custo total. Por hectare: × animais/ha. Rentabilidade no período = lucro ÷ custo total; ao mês = período ÷ (dias ÷ 30,4); ao ano = mês × 12.'),
        li('Ponto de equilíbrio = custo total ÷ peso de carcaça (R$/@ de venda). Valor máximo do boi magro = lucro ÷ @ iniciais + custo inicial (R$/@ de compra que zera o lucro). Sacas por hectare = lucro/ha ÷ preço da saca.'),
        li('Lotação auxiliar: (produção da espécie + kg de N × resposta da espécie) × fertilidade × proporção da época × eficiência do manejo ÷ 180 dias ÷ consumo da UA (450 kg × 2,3% nas águas ou 2,0% na seca) × fator da suplementação.'),
        li('Os arredondamentos do app foram mantidos (peso de carcaça, @ produzidas, lotação e custos por dia com 2 casas), para os números baterem com os dele.'),
      ),
    ),
    card(
      'O que mudou em relação ao Power Apps',
      'Erros do app original que foram corrigidos aqui:',
      h(
        'ul',
        { class: 'sc-help' },
        li('Custo do suplemento do primeiro produto: o app usava o valor da tela de histórico (outra simulação), não o da Formulação.'),
        li('Custo por dia do terceiro produto: o rateio do sanitário e da rastreabilidade usava os dias do segundo produto.'),
        li('Valor máximo do boi magro do terceiro produto: usava o rendimento de entrada do primeiro.'),
        li('Desempenho sugerido: só o primeiro produto era calculado pela tabela; os outros dois eram fixos. Agora os três seguem a tabela.'),
        li('Análise de risco: a grade somava a comissão de venda duas vezes e deixava de fora a comissão de compra; a de milho deixava de fora o custo de produção da ração. Agora a célula do meio bate com os Resultados. Ao mudar o passo, o app deslocava o centro para a borda da grade; aqui o centro fica sempre no meio.'),
        li('Rentabilidade: o app multiplicava por 100 duas vezes na hora de mostrar. Aqui é lucro ÷ custo, em %.'),
        li('Consumo padrão: o app abria o primeiro produto com 2,0% do PV, mas com o GMD da tabela para 1,0%. Agora abre com 1,0% / 1,5% / 2,0%.'),
      ),
    ),
  );
}

// ---------- Relatório e Excel (report.js) ----------

// Tudo o que o relatório e a planilha precisam, com as mesmas linhas das tabelas da tela.
function reportContext() {
  recompute();
  const P = prods();
  return {
    data: state.data,
    R,
    prodName,
    simName: state.sim?.name || '',
    userName: state.userName,
    COMPARA,
    rows: { zoo: ZOO_ROWS, fin: FIN_ROWS, result: RES_RESULT, custo: RES_CUSTO, resZoo: RES_ZOO },
    grades: { compraVenda: P.map((p) => gradeCompraVenda(p, ing(), state.data.risco)), milhoVenda: P.map((p) => gradeMilhoVenda(p, ing(), state.data.risco)) },
  };
}

async function exportExcel() {
  const btn = document.getElementById('excel');
  btn.disabled = true;
  try {
    await buildExcel(reportContext());
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---------- Simulações salvas (o "Histórico" do app) ----------

function showSimName() {
  const el = document.getElementById('sim-name');
  el.replaceChildren(...[state.sim ? h('span', {}, state.sim.name) : h('span', { class: 'muted' }, 'Simulação nova'), state.dirty ? h('span', { class: 'sc-unsaved' }, ' · não salva') : null].filter(Boolean));
}

function restore(data) {
  const base = defaultData();
  state.data = {
    ...base,
    ...data,
    cadastro: { ...base.cadastro, ...data.cadastro },
    ing: base.ing.map((x, j) => ({ ...x, ...data.ing?.[j] })),
    prods: base.prods.map((p, i) => ({ ...p, ...data.prods?.[i], lot: { ...p.lot, ...data.prods?.[i]?.lot }, incl: Array.from({ length: N_ING }, (_, j) => data.prods?.[i]?.incl?.[j] ?? p.incl[j]) })),
    risco: { ...base.risco, ...data.risco },
  };
  state.dirty = false;
}

function defaultName() {
  const c = state.data.cadastro;
  const d = c.dataVisita ? new Date(`${c.dataVisita}T12:00`).toLocaleDateString('pt-BR') : '';
  return [c.fazenda || c.proprietario, d].filter(Boolean).join(' · ');
}

function saveDialog() {
  const name = h('input', { type: 'text', value: state.sim?.name || defaultName(), placeholder: 'Ex.: Fazenda Santa Rita · 04/11/2026', maxlength: 120 });
  const error = h('p', { class: 'alert', hidden: true });
  const save = async (asNew) => {
    try {
      const body = { name: name.value, data: state.data };
      const { simulation } = state.sim && !asNew ? await api(`/api/semi/simulations/${state.sim.id}`, { method: 'PUT', body }) : await api('/api/semi/simulations', { method: 'POST', body });
      state.sim = { id: simulation.id, name: simulation.name };
      state.dirty = false;
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
      h('p', { class: 'muted' }, 'Guarda o cadastro da visita, a formulação e os valores dos três produtos.'),
      h('label', { class: 'field' }, h('span', {}, 'Nome'), name),
      error,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancelar'), state.sim ? h('button', { class: 'btn', type: 'button', onclick: () => save(true) }, 'Salvar como nova') : null, h('button', { class: 'btn btn-primary', type: 'submit' }, state.sim ? 'Atualizar' : 'Salvar')),
    ),
  );
  dialog.showModal();
  name.focus();
}

const discardOk = () => !state.dirty || confirm('Há alterações não salvas nesta simulação. Continuar mesmo assim?');

async function openDialog() {
  let list;
  try {
    ({ simulations: list } = await api('/api/semi/simulations'));
  } catch (err) {
    return toast(err.message, 'error');
  }
  const load = async (s) => {
    if (!discardOk()) return;
    try {
      const { simulation } = await api(`/api/semi/simulations/${s.id}`);
      restore(simulation.data);
      state.sim = { id: simulation.id, name: simulation.name };
      showSimName();
      dialog.close();
      selectTab('resultados');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const remove = async (s) => {
    if (!confirm(`Excluir a simulação "${s.name}"?`)) return;
    await api(`/api/semi/simulations/${s.id}`, { method: 'DELETE', body: {} }).catch((err) => toast(err.message, 'error'));
    if (state.sim?.id === s.id) {
      state.sim = null;
      showSimName();
    }
    openDialog();
  };
  const filtro = h('input', { type: 'search', placeholder: 'Procurar fazenda ou proprietário', 'aria-label': 'Procurar simulação' });
  const ul = h('ul');
  const semAcento = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const draw = () => {
    const termos = semAcento(filtro.value).split(/\s+/).filter(Boolean);
    const shown = list.filter((s) => termos.every((t) => semAcento(`${s.name} ${s.fazenda} ${s.proprietario}`).includes(t)));
    ul.replaceChildren(
      ...shown.map((s) =>
        h(
          'li',
          {},
          h(
            'button',
            { class: 'sc-sim', type: 'button', onclick: () => load(s) },
            h('strong', {}, s.name),
            h('span', { class: 'muted' }, [s.fazenda && `Fazenda ${s.fazenda}`, s.proprietario, s.dataVisita && `visita em ${new Date(`${s.dataVisita}T12:00`).toLocaleDateString('pt-BR')}`].filter(Boolean).join(' · ') || 'sem cadastro'),
            h('span', { class: 'muted' }, `salva em ${new Date(s.updatedAt).toLocaleString('pt-BR')}`),
          ),
          h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: () => remove(s) }, 'Excluir'),
        ),
      ),
    );
    if (!shown.length) ul.append(h('li', { class: 'muted' }, 'Nenhuma simulação com esse nome.'));
  };
  filtro.addEventListener('input', draw);
  dialog.replaceChildren(
    h(
      'div',
      { class: 'sc-sims' },
      h('h2', {}, 'Minhas simulações'),
      list.length ? [list.length > 5 ? filtro : null, ul] : h('p', { class: 'muted' }, 'Nenhuma simulação salva ainda. Preencha os dados e use "Salvar".'),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => dialog.close() }, 'Fechar')),
    ),
  );
  if (list.length) draw();
  if (!dialog.open) dialog.showModal();
}

function newSim() {
  if (!discardOk()) return;
  state.data = defaultData();
  state.sim = null;
  state.dirty = false;
  showSimName();
  selectTab('cadastro');
}

// ---------- Abas ----------

const RENDER = { cadastro: renderCadastro, formulacao: renderFormulacao, zootecnico: renderZootecnico, financeiro: renderFinanceiro, resultados: renderResultados, risco: renderRisco, ajuda: renderAjuda };

function selectTab(name) {
  state.tab = name;
  outs = [];
  document.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll('[data-panel]').forEach((p) => {
    p.hidden = p.dataset.panel !== name;
    if (p.hidden) p.replaceChildren();
  });
  history.replaceState(null, '', `#${name}`);
  recompute(); // os valores calculados da aba leem R já na montagem
  RENDER[name]();
  recompute();
  window.scrollTo({ top: 0 });
}

// Relatório próprio para o papel (A4); também sai com Ctrl+P, pelo evento beforeprint.
function fillPrint() {
  document.getElementById('report').replaceChildren(...buildPrint(reportContext()));
}
function printReport() {
  fillPrint();
  // espera o logo carregar antes de abrir a impressão
  const img = document.querySelector('#report img');
  if (img && !img.complete) img.addEventListener('load', () => window.print(), { once: true });
  else window.print();
}

// ---------- Tempo de uso (mesmo esquema das outras ferramentas) ----------

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
  state.userName = user.name;
  window.addEventListener('beforeprint', fillPrint);
  if (user.impersonatedBy) {
    document.getElementById('impersonation-text').textContent = `Você (${user.impersonatedBy.name}) está vendo o Semi Confinamento como ${user.name}.`;
    document.getElementById('impersonation').hidden = false;
  }
  initTicker();
  showSimName();
  // Sair com alterações não salvas: o navegador pergunta antes.
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) e.preventDefault();
  });
  document.querySelectorAll('[data-tab]').forEach((t) => (t.onclick = () => selectTab(t.dataset.tab)));
  document.getElementById('sim-new').onclick = newSim;
  document.getElementById('sim-save').onclick = saveDialog;
  document.getElementById('sim-open').onclick = openDialog;
  document.getElementById('excel').onclick = exportExcel;
  document.getElementById('print').onclick = printReport;
  const initial = location.hash.slice(1);
  selectTab(RENDER[initial] ? initial : 'cadastro');
  api('/api/semi/open', { method: 'POST', body: {} })
    .then((d) => trackUsage(d.viewId))
    .catch(() => {});
}

init().catch((err) => toast(err.message, 'error'));

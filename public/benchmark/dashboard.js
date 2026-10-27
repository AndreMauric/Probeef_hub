// Painel do Benchmarking (aba Resultado → Painel): indicadores dos lotes com filtros e comparação
// entre grupos (raça, sexo, categoria, mês ou trimestre de saída, tipo de entrada). Mesma regra do
// resultado da planilha: médias ponderadas pelo número de animais de cada lote.
import { h } from '/js/common.js';
import { calcLote, periodoLote } from './fields.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const nf = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// Filtros e escolhas da tela (ficam enquanto a página está aberta).
const dash = { kind: 'engorda', raca: '', sexo: '', categoria: '', tipo: '', periodo: '', de: '', ate: '', by: 'raca', ind: 'gpd' };

// Média ponderada pelos animais, só entre os lotes que têm o valor.
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

// Indicadores de um conjunto de lotes. Valor informado no lote quando existe; senão o recalculado.
function resumo(lotes) {
  const cs = new Map(lotes.map((l) => [l, calcLote(l)]));
  const c = (l) => cs.get(l);
  const W = (f) => weighted(lotes, f);
  const comMortes = lotes.filter((l) => num(l.mortes) !== null && num(l.qtAnm));
  const animaisMortes = comMortes.reduce((s, l) => s + l.qtAnm, 0);
  return {
    animais: lotes.reduce((s, l) => s + (num(l.qtAnm) || 0), 0),
    lotes: lotes.length,
    pvEntrada: W((l) => num(l.pvEntrada)),
    pvSaida: W((l) => num(l.pvSaida)),
    dias: W((l) => num(l.diasTrato)),
    gpd: W((l) => num(l.gpd) ?? c(l).gpd),
    rc: W((l) => num(l.rc) ?? c(l).rc),
    ganhoArroba: W((l) => num(l.ganhoArroba) ?? c(l).ganhoArroba),
    msPct: W((l) => num(l.consMSpctPV) ?? c(l).consMSpctPV),
    conversao: W((l) => num(l.convAlim) ?? c(l).convAlim),
    eficiencia: W((l) => num(l.eficAlim) ?? c(l).eficAlim),
    mortalidade: animaisMortes ? (comMortes.reduce((s, l) => s + l.mortes, 0) / animaisMortes) * 100 : null,
    custoAlimDia: W((l) => c(l).custoAlimentarDia),
    lucro: W((l) => c(l).lucroCab),
  };
}

// key, rótulo, unidade, casas, só na engorda (econômicos).
const INDICADORES = [
  ['gpd', 'GPD', 'kg/dia', 3],
  ['dias', 'Dias de cocho', 'dias', 0],
  ['rc', 'Rendimento de carcaça', '%', 2],
  ['ganhoArroba', 'Ganho de carcaça', '@/cab', 2],
  ['msPct', 'Consumo de MS', '% PV', 2],
  ['conversao', 'Conversão alimentar', 'kgMS/kgPV', 2],
  ['eficiencia', 'Eficiência biológica', 'kgMS/@', 1],
  ['mortalidade', 'Mortalidade', '%', 2],
  ['pvEntrada', 'Peso de entrada', 'kg', 1],
  ['pvSaida', 'Peso de saída', 'kg', 1],
  ['custoAlimDia', 'Custo alimentar', 'R$/cab/dia', 2, true],
  ['lucro', 'Lucro', 'R$/cab', 2, true],
];
const indicador = (key) => INDICADORES.find((i) => i[0] === key);

const sexoDe = (categoria) => (/macho/i.test(categoria || '') ? 'Machos' : /f[eê]mea|vaca/i.test(categoria || '') ? 'Fêmeas' : null);
const mesDe = (l) => (/^\d{4}-\d{2}/.test(l.saida || '') ? l.saida.slice(0, 7) : null);
const mesLabel = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`;
// Águas ou seca (mais de 70% dos dias no confinamento entre dezembro e maio = águas).
const periodoDe = (l) => periodoLote(l)?.periodo || null;
const trimestreDe = (l) => {
  const m = mesDe(l);
  return m ? `${m.slice(0, 4)}-T${Math.ceil(Number(m.slice(5, 7)) / 3)}` : null;
};

// Grupos para comparar: key -> rótulo, como achar o grupo de um lote, e se segue a ordem do tempo.
const AGRUPAR = {
  raca: { label: 'Raça', of: (l) => l.raca || null },
  sexo: { label: 'Sexo', of: (l) => sexoDe(l.categoria) },
  categoria: { label: 'Categoria', of: (l) => l.categoria || null },
  periodo: { label: 'Período (águas/seca)', of: periodoDe },
  mes: { label: 'Mês de saída', of: mesDe, time: true, name: mesLabel },
  trimestre: { label: 'Trimestre', of: trimestreDe, time: true, name: (k) => `${k.slice(5)}/${k.slice(0, 4)}` },
  tipo: { label: 'Tipo de entrada', of: (l) => l.tipoEntrada || null },
};

const options = (values, allLabel, selected) => [h('option', { value: '' }, allLabel), ...values.map(([v, t]) => h('option', { value: v, selected: v === selected }, t))];
const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));

export function renderDashboard(box, { engorda, recria }) {
  const all = dash.kind === 'recria' ? recria : engorda;
  const rerender = () => renderDashboard(box, { engorda, recria });
  const set = (patch) => {
    Object.assign(dash, patch);
    rerender();
  };

  const meses = uniq(all.map(mesDe));
  const lotes = all.filter(
    (l) =>
      (!dash.raca || l.raca === dash.raca) &&
      (!dash.sexo || sexoDe(l.categoria) === dash.sexo) &&
      (!dash.categoria || l.categoria === dash.categoria) &&
      (!dash.tipo || l.tipoEntrada === dash.tipo) &&
      (!dash.periodo || periodoDe(l) === dash.periodo) &&
      (!dash.de || (mesDe(l) && mesDe(l) >= dash.de)) &&
      (!dash.ate || (mesDe(l) && mesDe(l) <= dash.ate)),
  );
  const filtered = Boolean(dash.raca || dash.sexo || dash.categoria || dash.tipo || dash.periodo || dash.de || dash.ate);
  const inds = INDICADORES.filter((i) => !i[4] || dash.kind === 'engorda');
  if (!inds.some((i) => i[0] === dash.ind)) dash.ind = 'gpd';

  const select = (label, value, opts, key) => h('label', { class: 'bmk-dash-field' }, h('span', {}, label), h('select', { onchange: (e) => set({ [key]: e.target.value }) }, opts));
  const filters = h(
    'div',
    { class: 'bmk-dash-filters' },
    h(
      'div',
      { class: 'bmk-seg', role: 'radiogroup', 'aria-label': 'Lotes' },
      [
        ['engorda', `Engorda (${engorda.length})`],
        ['recria', `Recria (${recria.length})`],
      ].map(([k, t]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(dash.kind === k), class: dash.kind === k ? 'on' : '', onclick: () => set({ kind: k, raca: '', categoria: '', tipo: '', periodo: '', de: '', ate: '' }) }, t)),
    ),
    select('Raça', dash.raca, options(uniq(all.map((l) => l.raca)).map((v) => [v, v]), 'Todas', dash.raca), 'raca'),
    select('Sexo', dash.sexo, options(uniq(all.map((l) => sexoDe(l.categoria))).map((v) => [v, v]), 'Todos', dash.sexo), 'sexo'),
    select('Categoria', dash.categoria, options(uniq(all.map((l) => l.categoria)).map((v) => [v, v]), 'Todas', dash.categoria), 'categoria'),
    select('Tipo de entrada', dash.tipo, options(uniq(all.map((l) => l.tipoEntrada)).map((v) => [v, v]), 'Todos', dash.tipo), 'tipo'),
    select('Período', dash.periodo, options(['Águas', 'Seca'].filter((p) => all.some((l) => periodoDe(l) === p)).map((v) => [v, v]), 'Águas e seca', dash.periodo), 'periodo'),
    select('Saída de', dash.de, options(meses.map((m) => [m, mesLabel(m)]), 'Início', dash.de), 'de'),
    select('até', dash.ate, options(meses.map((m) => [m, mesLabel(m)]), 'Fim', dash.ate), 'ate'),
    filtered ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => set({ raca: '', sexo: '', categoria: '', tipo: '', periodo: '', de: '', ate: '' }) }, 'Limpar filtros') : null,
  );

  if (!all.length) {
    box.replaceChildren(filters, h('div', { class: 'bmk-blank' }, h('h3', {}, `Nenhum lote de ${dash.kind === 'recria' ? 'recria' : 'engorda'}`), h('p', { class: 'muted' }, 'Inclua lotes para ver o painel.')));
    return;
  }
  const total = resumo(lotes);

  // Indicadores principais dos lotes filtrados.
  const tiles = h(
    'div',
    { class: 'bmk-dash-tiles' },
    h('div', { class: 'bmk-dash-tile' }, h('span', {}, 'Animais'), h('strong', {}, nf(total.animais, 0)), h('small', {}, `${total.lotes} ${total.lotes === 1 ? 'lote' : 'lotes'}${filtered ? ` de ${all.length}` : ''}`)),
    inds
      .filter(([k]) => !['pvEntrada', 'pvSaida'].includes(k))
      .map(([k, label, unit, d]) => h('div', { class: 'bmk-dash-tile' }, h('span', {}, label), h('strong', { class: k === 'lucro' && total[k] < 0 ? 'neg' : '' }, nf(total[k], d)), h('small', {}, unit))),
  );

  // Comparação entre grupos.
  const g = AGRUPAR[dash.by];
  const groups = new Map();
  let semGrupo = 0;
  for (const l of lotes) {
    const k = g.of(l);
    if (!k) {
      semGrupo += 1;
      continue;
    }
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(l);
  }
  const [indKey, indLabel, indUnit, indDec] = indicador(dash.ind);
  const rows = [...groups].map(([k, ls]) => ({ key: k, name: g.name ? g.name(k) : k, r: resumo(ls) }));
  rows.sort((a, b) => (g.time ? a.key.localeCompare(b.key) : (b.r[indKey] ?? -Infinity) - (a.r[indKey] ?? -Infinity)));
  const values = rows.map((x) => x.r[indKey]).filter((v) => v !== null);
  const maxAbs = Math.max(...values.map(Math.abs), 0) || 1;
  const media = total[indKey];
  const allPositive = values.every((v) => v >= 0);

  const bars = h(
    'div',
    { class: 'bmk-bars', role: 'list' },
    rows.map(({ name, r }) => {
      const v = r[indKey];
      const pct = v === null ? 0 : (Math.abs(v) / maxAbs) * 100;
      return h(
        'div',
        { class: 'bmk-bar-row', role: 'listitem', title: `${name}: ${nf(v, indDec)} ${indUnit} · ${nf(r.animais, 0)} animais em ${r.lotes} lote(s)` },
        h('span', { class: 'bmk-bar-label' }, h('strong', {}, name), h('small', {}, `${nf(r.animais, 0)} animais · ${r.lotes} ${r.lotes === 1 ? 'lote' : 'lotes'}`)),
        h(
          'span',
          { class: 'bmk-bar-track' },
          h('span', { class: `bmk-bar${v !== null && v < 0 ? ' neg' : ''}`, style: `width:${pct.toFixed(1)}%` }),
          allPositive && media !== null ? h('span', { class: 'bmk-bar-avg', style: `left:${((media / maxAbs) * 100).toFixed(1)}%`, 'aria-hidden': 'true' }) : null,
        ),
        h('span', { class: 'bmk-bar-value' }, v === null ? 'sem dado' : nf(v, indDec)),
      );
    }),
  );

  const compare = h(
    'section',
    { class: 'bmk-card' },
    h(
      'header',
      { class: 'bmk-card-head bmk-dash-head' },
      h('h2', {}, `${indLabel} por ${g.label.toLowerCase()}`),
      h(
        'div',
        { class: 'bmk-dash-controls' },
        select('Comparar por', dash.by, Object.entries(AGRUPAR).map(([k, x]) => h('option', { value: k, selected: k === dash.by }, x.label)), 'by'),
        select('Indicador', dash.ind, inds.map(([k, label, unit]) => h('option', { value: k, selected: k === dash.ind }, `${label} (${unit})`)), 'ind'),
      ),
    ),
    rows.length
      ? [
          bars,
          h(
            'p',
            { class: 'muted bmk-dash-note' },
            `${indUnit} · média ponderada pelos animais.`,
            allPositive && media !== null ? ` A linha vertical marca a média geral dos lotes filtrados (${nf(media, indDec)}).` : '',
            semGrupo ? ` ${semGrupo} lote(s) sem ${g.label.toLowerCase()} ficaram fora da comparação.` : '',
          ),
        ]
      : h('p', { class: 'muted' }, `Nenhum lote com ${g.label.toLowerCase()} informado nos filtros escolhidos.`),
  );

  // Todos os indicadores lado a lado, por grupo.
  const tableInds = inds;
  const table = rows.length
    ? h(
        'section',
        { class: 'bmk-card' },
        h('header', { class: 'bmk-card-head' }, h('h2', {}, `Comparação por ${g.label.toLowerCase()}`), h('span', { class: 'muted' }, 'todos os indicadores')),
        h(
          'div',
          { class: 'bmk-dash-table-wrap' },
          h(
            'table',
            { class: 'bmk-result-table bmk-dash-table' },
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, g.label), h('th', { scope: 'col', class: 'num' }, 'Animais'), tableInds.map(([, label, unit]) => h('th', { scope: 'col', class: 'num' }, label, h('small', {}, unit))))),
            h(
              'tbody',
              {},
              rows.map(({ name, r }) => h('tr', {}, h('th', { scope: 'row' }, name), h('td', { class: 'num' }, nf(r.animais, 0)), tableInds.map(([k, , , d]) => h('td', { class: `num${k === indKey ? ' sel' : ''}` }, nf(r[k], d))))),
              h('tr', { class: 'total' }, h('th', { scope: 'row' }, filtered ? 'Total filtrado' : 'Total'), h('td', { class: 'num' }, nf(total.animais, 0)), tableInds.map(([k, , , d]) => h('td', { class: `num${k === indKey ? ' sel' : ''}` }, nf(total[k], d)))),
            ),
          ),
        ),
      )
    : null;

  box.replaceChildren(filters, ...(lotes.length ? [tiles, compare, table].filter(Boolean) : [h('p', { class: 'muted' }, 'Nenhum lote com esses filtros.')]));
}

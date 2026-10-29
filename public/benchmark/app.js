// Benchmarking Confinamento Probeef: coleta por cliente, com validação na hora (antes: planilha
// "Benchmarking Confinamento Probeef 2026 Feed Manager.xlsb"). As regras ficam em fields.js,
// as mesmas que o servidor usa. Fluxo: rascunho → enviado → correção/aprovado (ver src/benchmark.js).
import { api, h, toast } from '/js/common.js';
import { initTicker } from '/js/ticker.js';
import { initChat } from '/js/chat.js';
import { renderDashboard } from './dashboard.js';
import { baixarModelo, lerQuestionario, MODELOS } from './modelo.js';
import {
  calcLote,
  cleanAnswer,
  cleanLote,
  colIndex,
  COLUNAS_ECO,
  COLUNAS_ZOO,
  ECO_FIELDS,
  ECO_RESULT_ROWS,
  editableStatus,
  EXCLUSAO_LABELS,
  separarExclusao,
  lotesFromTgc,
  OPTIONS,
  QUESTIONARIO,
  QUESTIONS,
  questionText,
  questionVisible,
  resultadoEngorda,
  resultadoRecria,
  STATUS,
  CFM_LOTE,
  lotesFromCfm,
  TGC_LOTE,
  tgcHeader,
  toIsoDate,
  validateLotes,
  validateQuestionario,
  ZOO_FIELDS,
  ZOO_RESULT_ROWS,
} from './fields.js';

const state = {
  me: null,
  isAdmin: false,
  clients: [],
  clientId: null,
  ano: null,
  prazo: null,
  view: null, // resposta do servidor (submission, summary, settings)
  data: null, // cópia em edição: { engorda, recria, respostas }
  version: 0,
  dirty: false,
  saving: false,
  conflict: false,
  savedAt: null,
  tab: 'engorda',
  group: { engorda: 'zoo', recria: 'zoo' },
  filter: { engorda: 'todos', recria: 'todos' },
  // Filtro por coluna: { field, level } mostra só os lotes com aquele problema naquela coluna.
  colFilter: { engorda: null, recria: null },
  resultView: 'painel',
  visibleRows: { engorda: [], recria: [] }, // índices dos lotes que a tabela mostra (filtros e busca)
  search: { engorda: '', recria: '' },
  qSection: QUESTIONARIO[0].id,
};
const dialog = document.getElementById('dialog');
const fill = (el, ...children) => el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
const nf = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const settings = () => state.view.settings;
const status = () => state.view.submission.status;
// access vem do servidor: edit (admin sempre; os demais em rascunho/correção), review (valida).
const access = () => state.view?.access || {};
const canEdit = () => !state.me.impersonatedBy && Boolean(access().edit);

// ---------- Salvamento automático ----------

let saveTimer = null;
function changed() {
  state.dirty = true;
  renderStatus();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 1500);
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (!state.dirty || state.saving || state.conflict || !canEdit()) return;
  state.saving = true;
  state.dirty = false;
  renderStatus();
  try {
    const view = await api(`/api/benchmark/${state.clientId}`, { method: 'PUT', body: { ...state.data, version: state.version } });
    state.view = view;
    state.version = view.submission.version;
    state.savedAt = new Date();
  } catch (err) {
    state.dirty = true;
    if (/Outra pessoa salvou/.test(err.message)) state.conflict = true;
    toast(err.message, 'error');
  } finally {
    state.saving = false;
    renderStatus();
    if (state.dirty && !state.conflict) saveTimer = setTimeout(saveNow, 4000);
  }
}

window.addEventListener('beforeunload', (e) => {
  if (state.dirty || state.saving) {
    saveNow();
    e.preventDefault();
  }
});

// ---------- Faixa de situação (status, resumo e ações) ----------

function localSummary() {
  const s = settings();
  const eng = validateLotes(state.data.engorda, s);
  const rec = validateLotes(state.data.recria, s, { recria: true });
  const q = validateQuestionario(state.data.respostas);
  return { eng, rec, q, erros: eng.erros + rec.erros, alertas: eng.alertas + rec.alertas, total: state.data.engorda.length + state.data.recria.length };
}

function renderStatus() {
  const box = document.getElementById('status');
  if (!state.view) return;
  const sub = state.view.submission;
  const st = STATUS[sub.status] || STATUS.rascunho;
  const sum = localSummary();
  const ready = sum.total > 0 && sum.erros === 0 && sum.q.faltando.length === 0;
  document.getElementById('count-engorda').textContent = state.data.engorda.length || '';
  document.getElementById('count-recria').textContent = state.data.recria.length || '';
  document.getElementById('count-questionario').textContent = `${sum.q.respondidas}/${sum.q.visiveis}`;
  const saveText = state.conflict
    ? 'Outra pessoa salvou: recarregue a página'
    : state.saving
      ? 'Salvando…'
      : state.dirty
        ? 'Alterações não salvas'
        : state.savedAt
          ? `Salvo às ${state.savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
          : sub.updatedAt
            ? `Última alteração ${fmtDateTime(sub.updatedAt)}${sub.updatedByName ? ` por ${sub.updatedByName}` : ''}`
            : 'Nada salvo ainda';
  const lastMsg = [...sub.messages].reverse().find((m) => m.action === 'devolver');
  const actions = [];
  const hasData = sum.total > 0 || Object.values(state.data.respostas).some((v) => v !== null && v !== '' && !(Array.isArray(v) && !v.length));
  if (canEdit() && hasData) {
    actions.push(h('button', { class: 'btn btn-ghost btn-danger', type: 'button', disabled: state.conflict, onclick: clearDialog }, 'Apagar tudo'));
  }
  if (!state.me.impersonatedBy && editableStatus(sub.status)) {
    actions.push(h('button', { class: 'btn btn-primary', type: 'button', disabled: !ready || state.conflict, title: ready ? 'Enviar para a Cargill validar' : 'Corrija os erros e responda as perguntas obrigatórias antes de enviar', onclick: submitDialog }, 'Enviar para validação'));
  }
  if (access().review && !state.me.impersonatedBy) {
    if (sub.status === 'enviado') {
      actions.push(h('button', { class: 'btn', type: 'button', onclick: () => reviewDialog('devolver') }, 'Devolver para correção'));
      actions.push(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => reviewDialog('aprovar') }, 'Aprovar'));
    }
    if (sub.status === 'aprovado' || sub.status === 'enviado') actions.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => reviewDialog('reabrir') }, 'Reabrir para edição'));
  }
  const chip = (cls, text) => h('span', { class: `bmk-chip ${cls}` }, text);
  fill(
    box,
    h(
      'div',
      { class: 'bmk-status-main' },
      h('span', { class: `bmk-pill ${st.cls}` }, st.label),
      h('div', { class: 'bmk-status-text' }, h('strong', {}, state.view.client.name), h('span', { class: 'muted' }, `Benchmarking ${state.ano}${state.prazo ? ` · prazo ${new Date(`${state.prazo}T12:00:00`).toLocaleDateString('pt-BR')}` : ''} · ${saveText}`)),
      h('div', { class: 'bmk-actions' }, actions),
    ),
    h(
      'div',
      { class: 'bmk-chips' },
      chip('neutral', `${state.data.engorda.length} lotes de engorda · ${state.data.recria.length} de recria`),
      sum.erros ? chip('crit', `✕ ${sum.erros} ${sum.erros === 1 ? 'erro' : 'erros'} para corrigir`) : chip('ok', '✓ Sem erros nos lotes'),
      sum.alertas ? chip('warn', `⚠ ${sum.alertas} ${sum.alertas === 1 ? 'alerta' : 'alertas'} para conferir`) : null,
      sum.q.faltando.length ? chip('warn', `Questionário: faltam ${sum.q.faltando.length} obrigatórias`) : chip('ok', `Questionário: ${sum.q.respondidas} de ${sum.q.visiveis} respondidas`),
    ),
    sub.status === 'correcao' && lastMsg ? h('div', { class: 'bmk-callout crit' }, h('strong', {}, `Devolvido para correção por ${lastMsg.byName || 'Cargill'} em ${fmtDateTime(lastMsg.at)}:`), h('p', {}, lastMsg.text)) : null,
    sub.status === 'enviado' && !access().review ? h('div', { class: 'bmk-callout warn' }, 'Enviado para a Cargill validar. Enquanto isso a edição fica travada; se precisar mudar algo, fale com o seu coordenador pelo botão Mensagens do portal.') : null,
    sub.status === 'aprovado' ? h('div', { class: 'bmk-callout ok' }, `Aprovado em ${fmtDateTime(sub.decidedAt)}${sub.decidedByName ? ` por ${sub.decidedByName}` : ''}.`) : null,
    state.me.impersonatedBy ? h('div', { class: 'bmk-callout warn' }, 'Você está vendo como o cliente: nada do que mudar aqui é salvo.') : null,
  );
}

// ---------- Tabela de lotes ----------

const GROUPS = {
  zoo: { label: 'Zootécnico', fields: ZOO_FIELDS },
  eco: { label: 'Econômico', fields: ECO_FIELDS },
};
// Indicadores recalculados mostrados ao lado (só leitura).
const CALC_COLS = {
  zoo: [
    ['mortesPct', 'Mortes', '%', 2],
    ['retPastoPct', 'Ret. pasto', '%', 2],
  ],
  eco: [
    ['pesoEntradaArroba', 'Entrada', '@', 2],
    ['pesoSaidaArroba', 'Saída', '@', 2],
    ['custoArrobaEntrada', 'Custo @ entrada', 'R$/@', 2],
    ['valorArrobaVenda', 'Valor @ venda', 'R$/@', 2],
    ['custoAlimentarDia', 'Custo alim.', 'R$/cab/d', 2],
    ['custoOperacional', 'Custo oper.', 'R$/cab/d', 2],
    ['lucroCab', 'Lucro', 'R$/cab', 2],
  ],
};

function lotesPanel(kind) {
  const recria = kind === 'recria';
  const panel = document.querySelector(`[data-panel="${kind}"]`);
  const lotes = state.data[kind];
  const group = recria ? 'zoo' : state.group[kind];
  const val = validateLotes(lotes, settings(), { recria });
  const editable = canEdit();
  const fields = GROUPS[group].fields;
  const lead = group === 'eco' ? ZOO_FIELDS.slice(0, 1) : [];
  const shownFields = [...lead.map((f) => ({ ...f, readonly: true })), ...fields];
  const term = state.search[kind].trim().toLowerCase();
  const cf = state.colFilter[kind];
  const rows = lotes
    .map((l, i) => ({ l, i, issues: val.porLote[i] }))
    .filter(({ issues }) => (state.filter[kind] === 'erro' ? issues.some((x) => x.level === 'erro') : state.filter[kind] === 'alerta' ? issues.some((x) => x.level === 'alerta') : state.filter[kind] === 'ok' ? !issues.length : true))
    .filter(({ issues }) => !cf || issues.some((x) => x.field === cf.field && x.level === cf.level))
    .filter(({ l }) => !term || `${l.lote || ''} ${l.curral || ''}`.toLowerCase().includes(term));
  state.visibleRows[kind] = rows.map((r) => r.i);

  // Quantos lotes têm erro/alerta em cada coluna (todos os lotes, sem os filtros).
  const perField = new Map();
  for (const issues of val.porLote) {
    const seen = new Set();
    for (const x of issues) {
      const k = `${x.field}|${x.level}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!perField.has(x.field)) perField.set(x.field, { erro: 0, alerta: 0 });
      perField.get(x.field)[x.level] += 1;
    }
  }
  const allFields = ZOO_FIELDS.concat(recria ? [] : ECO_FIELDS);
  const fieldLabel = (key) => allFields.find((f) => f.key === key)?.label || key;
  const setColFilter = (next) => {
    state.colFilter[kind] = next;
    // A coluna escolhida pode estar no outro grupo (Zootécnico/Econômico).
    if (next && !recria && next.field !== 'lote') state.group[kind] = ZOO_FIELDS.some((f) => f.key === next.field) ? 'zoo' : 'eco';
    lotesPanel(kind);
  };
  const colBadges = (f) => {
    const n = perField.get(f.key);
    if (!n) return null;
    const badge = (level, sym) =>
      n[level]
        ? h(
            'button',
            {
              type: 'button',
              class: `bmk-colflt ${level}${cf?.field === f.key && cf.level === level ? ' on' : ''}`,
              title: `${n[level]} ${n[level] === 1 ? 'lote' : 'lotes'} com ${level === 'erro' ? 'erro' : 'alerta'} em ${f.label}. Clique para filtrar.`,
              onclick: () => setColFilter(cf?.field === f.key && cf.level === level ? null : { field: f.key, level }),
            },
            `${sym} ${n[level]}`,
          )
        : null;
    return h('span', { class: 'bmk-colflts' }, badge('erro', '✕'), badge('alerta', '⚠'));
  };

  const head = h(
    'tr',
    {},
    h('th', { class: 'bmk-sticky0', scope: 'col' }, ''),
    shownFields.flatMap((f, k) => [
      h('th', { scope: 'col', class: k === 0 ? 'bmk-sticky1' : '', style: `min-width:${f.w || 80}px` }, f.label, f.unit ? h('small', {}, f.unit) : null, (recria ? f.reqRecria : f.req) ? h('span', { class: 'bmk-req', title: 'Obrigatório' }, '*') : null, colBadges(f)),
      f.key === 'saida' ? h('th', { scope: 'col', class: 'bmk-calc-h', title: 'Calculado: águas (dez–mai) quando mais de 70% dos dias no confinamento caíram nas águas; senão, seca', style: 'min-width:110px' }, 'Período', h('small', {}, 'águas/seca')) : null,
    ]),
    CALC_COLS[group].map(([, label, unit]) => h('th', { scope: 'col', class: 'bmk-calc-h', title: 'Calculado' }, label, h('small', {}, unit))),
    editable ? h('th', { scope: 'col' }, '') : null,
  );

  const body = rows.map(({ l, i, issues }) => {
    const byField = new Map();
    for (const x of issues) {
      if (!byField.has(x.field)) byField.set(x.field, []);
      byField.get(x.field).push(x);
    }
    const level = issues.some((x) => x.level === 'erro') ? 'erro' : issues.some((x) => x.level === 'alerta') ? 'alerta' : 'ok';
    const c = calcLote(l);
    const icon = h(
      'button',
      { class: `bmk-row-icon ${level}`, type: 'button', title: issues.length ? issues.map((x) => `${x.level === 'erro' ? '✕' : '⚠'} ${x.msg}`).join('\n') : 'Sem problemas', onclick: () => issuesDialog(kind, i) },
      level === 'erro' ? '✕' : level === 'alerta' ? '⚠' : '✓',
    );
    return h(
      'tr',
      { class: `lvl-${level}` },
      h('td', { class: 'bmk-sticky0' }, icon),
      shownFields.flatMap((f, k) => {
        const fi = byField.get(f.key) || [];
        const cls = fi.some((x) => x.level === 'erro') ? 'has-erro' : fi.length ? 'has-alerta' : '';
        return [
          h('td', { class: `${k === 0 ? 'bmk-sticky1 ' : ''}${cls}`, title: fi.map((x) => x.msg).join('\n') || null }, cellInput(kind, i, f, editable && !f.readonly)),
          f.key === 'saida' ? periodoCell(c) : null,
        ];
      }),
      CALC_COLS[group].map(([key, , , d]) => h('td', { class: 'bmk-calc num' }, nf(c[key], d))),
      editable ? h('td', {}, h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', title: `Excluir o lote ${l.lote || ''}`, 'aria-label': 'Excluir lote', onclick: () => removeLote(kind, i) }, '×')) : null,
    );
  });

  const filterSel = h(
    'select',
    { 'aria-label': 'Filtrar lotes', onchange: (e) => ((state.filter[kind] = e.target.value), lotesPanel(kind)) },
    [
      ['todos', `Todos (${lotes.length})`],
      ['erro', `Com erro (${val.lotesComErro})`],
      ['alerta', `Com alerta (${val.porLote.filter((i) => i.some((x) => x.level === 'alerta')).length})`],
      ['ok', `Sem problemas (${val.porLote.filter((i) => !i.length).length})`],
    ].map(([v, t]) => h('option', { value: v, selected: state.filter[kind] === v }, t)),
  );
  // Todas as colunas com problema, inclusive as do grupo que não está aberto.
  const problemCols = allFields.filter((f) => perField.has(f.key));
  const colSel = problemCols.length
    ? h(
        'select',
        {
          'aria-label': 'Problemas por coluna',
          onchange: (e) => {
            const [field, level] = e.target.value.split('|');
            setColFilter(field ? { field, level } : null);
          },
        },
        h('option', { value: '' }, `Problemas por coluna (${problemCols.length})`),
        problemCols.flatMap((f) => {
          const n = perField.get(f.key);
          return ['erro', 'alerta']
            .filter((level) => n[level])
            .map((level) => h('option', { value: `${f.key}|${level}`, selected: cf?.field === f.key && cf.level === level }, `${f.label} — ${level === 'erro' ? '✕ erro' : '⚠ alerta'} (${n[level]})`));
        }),
      )
    : null;
  const activeChip = cf
    ? h(
        'button',
        { type: 'button', class: `bmk-flt-chip ${cf.level}`, title: 'Limpar o filtro da coluna', onclick: () => setColFilter(null) },
        `${fieldLabel(cf.field)} · com ${cf.level === 'erro' ? 'erro' : 'alerta'} (${rows.length})`,
        h('span', { 'aria-hidden': 'true' }, ' ×'),
      )
    : null;
  const search = h('input', {
    type: 'search',
    placeholder: 'Buscar lote ou curral',
    value: state.search[kind],
    'aria-label': 'Buscar lote',
    oninput: (e) => {
      state.search[kind] = e.target.value;
      clearTimeout(search._t);
      search._t = setTimeout(() => {
        lotesPanel(kind);
        document.querySelector(`[data-panel="${kind}"] input[type=search]`)?.focus();
      }, 250);
    },
  });

  fill(
    panel,
    h(
      'div',
      { class: 'bmk-toolbar' },
      editable ? h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: () => addLote(kind) }, '+ Novo lote') : null,
      editable ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => pasteDialog(kind) }, 'Colar do Excel') : null,
      editable ? h('button', { class: 'btn btn-sm', type: 'button', onclick: importDialog }, 'Importar planilha') : null,
      editable ? h('button', { class: 'btn btn-sm', type: 'button', title: 'Excel para preencher os lotes e o questionário fora do portal e depois importar', onclick: downloadModelo }, 'Baixar modelo') : null,
      editable && lotes.length ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => standardizeDialog(kind) }, 'Padronizar listas') : null,
      editable && lotes.length
        ? h(
            'button',
            {
              class: 'btn btn-sm',
              type: 'button',
              title: 'Preencher origem, tipo de entrada, raça ou categoria de vários lotes de uma vez',
              // Abre no que mais precisa: tipo de entrada (obrigatório) se faltar; senão a origem.
              onclick: () => originDialog(kind, lotes.some((l) => !l.tipoEntrada) ? 'tipoEntrada' : 'origem'),
            },
            'Preencher em lote',
          )
        : null,
      recria
        ? null
        : h(
            'div',
            { class: 'bmk-seg', role: 'radiogroup', 'aria-label': 'Grupo de colunas' },
            Object.entries(GROUPS).map(([key, g]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(group === key), class: group === key ? 'on' : '', onclick: () => ((state.group[kind] = key), lotesPanel(kind)) }, g.label)),
          ),
      h('span', { class: 'spacer' }),
      activeChip,
      colSel,
      filterSel,
      search,
    ),
    lotes.length
      ? h('div', { class: 'bmk-grid-wrap' }, h('table', { class: 'bmk-grid' }, h('thead', {}, head), h('tbody', {}, body.length ? body : h('tr', {}, h('td', { colspan: 99, class: 'muted bmk-empty' }, 'Nenhum lote neste filtro.')))))
      : h(
          'div',
          { class: 'bmk-blank' },
          h('h3', {}, recria ? 'Nenhum lote de recria confinada' : 'Nenhum lote de engorda ainda'),
          h('p', { class: 'muted' }, recria ? 'Se a fazenda faz recria confinada, inclua os lotes aqui (mesmas colunas da aba "BD_Zootec_Feed_ Recria_Conf" da planilha).' : 'Inclua os lotes encerrados no ano: digite, cole do Excel (mesma ordem de colunas da planilha de benchmarking) ou importe a planilha inteira.'),
          editable ? h('div', { class: 'bmk-blank-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => addLote(kind) }, '+ Novo lote'), h('button', { class: 'btn', type: 'button', onclick: () => pasteDialog(kind) }, 'Colar do Excel'), h('button', { class: 'btn', type: 'button', onclick: importDialog }, 'Importar planilha'), h('button', { class: 'btn', type: 'button', onclick: downloadModelo }, 'Baixar modelo')) : null,
        ),
    lotes.length ? h('p', { class: 'muted bmk-legend' }, '* obrigatório · ✕ erro (impede o envio) · ⚠ alerta (confira: o valor informado não bate com o recalculado ou está fora da faixa esperada) · colunas cinza são calculadas. Passe o mouse ou clique no ícone para ver o motivo.') : null,
  );
}

// Uma célula editável. Atualiza o lote e revalida a linha sem redesenhar a tabela inteira a cada tecla.
function cellInput(kind, i, f, editable) {
  const l = state.data[kind][i];
  const value = l[f.key] ?? '';
  // cleanLote descarta campos vazios, então apagar a célula remove o valor.
  const commit = (raw) => {
    state.data[kind][i] = cleanLote({ ...l, [f.key]: raw });
    changed();
  };
  if (f.type === 'list') {
    const opts = settings().listas[f.list];
    const sel = h(
      'select',
      { disabled: !editable, 'aria-label': f.label, onchange: (e) => (commit(e.target.value), lotesPanel(kind)) },
      h('option', { value: '' }, '—'),
      opts.map((o) => h('option', { value: o, selected: value === o }, o)),
      value && !opts.includes(value) ? h('option', { value, selected: true }, `${value} (fora da lista)`) : null,
    );
    return sel;
  }
  const input = h('input', {
    type: f.type === 'date' ? 'date' : 'text',
    inputmode: f.type === 'num' || f.type === 'int' ? 'decimal' : undefined,
    value: typeof value === 'number' ? String(value).replace('.', ',') : value,
    disabled: !editable,
    'aria-label': f.label,
    class: f.type === 'num' || f.type === 'int' ? 'num' : '',
    onchange: (e) => {
      commit(e.target.value.trim());
      // Redesenha para atualizar os ícones e as colunas calculadas, mantendo o foco na próxima célula.
      const pos = [...document.querySelectorAll(`[data-panel="${kind}"] .bmk-grid input, [data-panel="${kind}"] .bmk-grid select`)].indexOf(document.activeElement);
      lotesPanel(kind);
      if (pos >= 0) document.querySelectorAll(`[data-panel="${kind}"] .bmk-grid input, [data-panel="${kind}"] .bmk-grid select`)[pos]?.focus();
    },
  });
  return input;
}

function addLote(kind) {
  state.data[kind].push({});
  state.filter[kind] = 'todos';
  state.search[kind] = '';
  changed();
  lotesPanel(kind);
  const inputs = document.querySelectorAll(`[data-panel="${kind}"] .bmk-grid tbody tr:last-child input`);
  inputs[0]?.focus();
}

function removeLote(kind, i) {
  const l = state.data[kind][i];
  if (Object.keys(l).length > 1 && !confirm(`Excluir o lote ${l.lote || '(sem identificação)'}?`)) return;
  state.data[kind].splice(i, 1);
  changed();
  lotesPanel(kind);
}

// Período do lote (águas/seca), calculado da data de saída e dos dias no confinamento.
const fmtDia = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '—');
function periodoCell(c) {
  if (!c.periodo) return h('td', { class: 'bmk-calc', title: 'Precisa da data de saída e dos dias no confinamento.' }, '—');
  return h(
    'td',
    { class: 'bmk-calc', title: `Entrada estimada ${fmtDia(c.entrada)} · ${nf(c.pctAguas, 0)}% dos dias nas águas (dez–mai)` },
    h('span', { class: `bmk-periodo ${c.periodo === 'Águas' ? 'aguas' : 'seca'}` }, c.periodo),
    h('small', {}, ` ${nf(c.pctAguas, 0)}%`),
  );
}

function issuesDialog(kind, i) {
  const l = state.data[kind][i];
  const issues = validateLotes(state.data[kind], settings(), { recria: kind === 'recria' }).porLote[i];
  const c = calcLote(l);
  fill(
    dialog,
    h(
      'div',
      { class: 'bmk-dialog' },
      h('h2', {}, `Lote ${l.lote || '(sem identificação)'}`),
      issues.length
        ? h('ul', { class: 'bmk-issues' }, issues.map((x) => h('li', { class: x.level }, h('strong', {}, x.level === 'erro' ? '✕ Erro · ' : '⚠ Alerta · '), x.msg)))
        : h('p', { class: 'bmk-callout ok' }, 'Sem problemas neste lote.'),
      h('h3', {}, 'Recalculado a partir dos dados'),
      h(
        'table',
        { class: 'bmk-mini' },
        h(
          'tbody',
          {},
          [
            ['Peso de carcaça (kg)', c.pesoCarc, 1],
            ['GPD (kg/dia)', c.gpd, 3],
            ['Ganho (@/cab)', c.ganhoArroba, 2],
            ['Rendimento de carcaça (%)', c.rc, 1],
            ['Eficiência alimentar (kgMS/@)', c.eficAlim, 1],
            ['Conversão alimentar (kgMS/kgPV)', c.convAlim, 2],
            ['Dias de trato', c.diasTrato, 0],
          ].map(([label, v, d]) => h('tr', {}, h('th', {}, label), h('td', { class: 'num' }, nf(v, d)))),
          h('tr', {}, h('th', {}, 'Entrada (saída − dias no confinamento)'), h('td', { class: 'num' }, fmtDia(c.entrada))),
          h('tr', {}, h('th', {}, 'Dias nas águas (dez–mai)'), h('td', { class: 'num' }, c.pctAguas === null ? '—' : `${nf(c.pctAguas, 1)}%`)),
          h('tr', {}, h('th', {}, 'Período (águas se acima de 70%)'), h('td', { class: 'num' }, c.periodo || '—')),
        ),
      ),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => dialog.close() }, 'Fechar')),
    ),
  );
  dialog.showModal();
}

// ---------- Colar do Excel (mesma ordem de colunas da planilha) ----------

// Lê linhas coladas (separadas por tabulação) usando a letra de coluna de cada campo.
function rowsFromTsv(text, columns) {
  const lines = text.replace(/\r/g, '').split('\n').filter((line) => line.trim());
  return lines
    .map((line) => line.split('\t'))
    .filter((cells) => !/^lote$/i.test(String(cells[0] || '').trim()) && !/^identifica/i.test(String(cells[0] || '').trim()))
    .map((cells) => {
      const raw = {};
      for (const f of columns) {
        const v = cells[colIndex(f.col)];
        if (v !== undefined && String(v).trim() !== '') raw[f.key] = String(v).trim();
      }
      return raw;
    })
    .filter((r) => r.lote);
}

// Junta lotes novos aos atuais pelo identificador do lote (atualiza os existentes, inclui os novos).
function mergeLotes(kind, incoming) {
  const list = state.data[kind];
  let added = 0;
  let updated = 0;
  for (const raw of incoming) {
    const i = list.findIndex((l) => String(l.lote) === String(raw.lote));
    if (i >= 0) {
      list[i] = cleanLote({ ...list[i], ...raw });
      updated += 1;
    } else {
      list.push(cleanLote(raw));
      added += 1;
    }
  }
  return { added, updated };
}

// ---------- Relatórios por animal (TGC e Cargill Feed Manager) ----------
// Os dois exportam um animal por linha; o portal junta por lote (lotesFromTgc / lotesFromCfm em
// fields.js). O tipo de relatório é reconhecido pela coluna do lote no cabeçalho.

const ANIMAL_SOURCES = {
  cfm: { label: 'Cargill Feed Manager', lote: CFM_LOTE, loteCol: 'LOTE Saída confinamento', toLotes: lotesFromCfm, sheets: { engorda: 'BD_CFM_Conf', recria: 'BD_CFM_Conf_Recria' } },
  tgc: { label: 'TGC', lote: TGC_LOTE, loteCol: 'LOTE_SAIDA', toLotes: lotesFromTgc, sheets: { engorda: 'BD_TGC_Conf', recria: 'BD_TGC_Conf_Recria' } },
};

// Linhas de uma planilha ou texto colado → lotes, com { source } e o resumo da conversão.
// Sem a coluna do lote de nenhum dos dois, não é um relatório por animal (null).
function animalReport(matrix) {
  for (const [source, src] of Object.entries(ANIMAL_SOURCES)) {
    const hi = matrix.slice(0, 30).findIndex((row) => (row || []).some((c) => tgcHeader(c) === src.lote));
    if (hi < 0) continue;
    const head = matrix[hi].map(tgcHeader);
    const animais = matrix
      .slice(hi + 1)
      .filter((row) => (row || []).some((c) => c !== null && c !== undefined && String(c).trim() !== ''))
      .map((row) => Object.fromEntries(head.map((k, i) => [k, row[i]]).filter(([k]) => k)));
    return { source, ...src.toLotes(animais) };
  }
  return null;
}
const reportFromSheet = (XLSX, ws) => (ws ? animalReport(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })) : null);
const reportFromText = (text) => animalReport(text.replace(/\r/g, '').split('\n').map((line) => line.split('\t')));
const reportLabel = (t) => ANIMAL_SOURCES[t.source].label;
function reportResumo(t) {
  const src = ANIMAL_SOURCES[t.source];
  return [
    `${nf(t.animais, 0)} animais em ${t.lotes.length} ${t.lotes.length === 1 ? 'lote' : 'lotes'}`,
    t.mortes ? `${nf(t.mortes, 0)} morte(s)` : null,
    t.soMortes?.lotes ? `${t.soMortes.lotes} lote(s) só com animais mortos (${t.soMortes.animais} animais) ficaram de fora` : null,
    t.semLote ? `${t.semLote} linha(s) sem ${src.loteCol} ignorada(s)` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// Depois de trazer lotes de um relatório por animal: raça/categoria vêm escritas do jeito do
// programa e não há tipo de entrada.
function afterAnimalImport(kind, source) {
  setTimeout(() => standardizeDialog(kind, { auto: true }), 400);
  if (state.data[kind].some((l) => !l.tipoEntrada)) toast(`O ${ANIMAL_SOURCES[source]?.label || 'relatório'} não traz o tipo de entrada: use "Preencher em lote" para completar.`, 'info');
}

function pasteDialog(kind) {
  const recria = kind === 'recria';
  const area = h('textarea', { rows: 12, placeholder: 'Copie as linhas no Excel (Ctrl+C) e cole aqui (Ctrl+V)…', class: 'bmk-paste' });
  let which = 'zoo';
  const info = h('p', { class: 'muted' });
  const showInfo = () => {
    const cols = which === 'zoo' ? COLUNAS_ZOO : COLUNAS_ECO;
    info.textContent = `Feed Manager (um lote por linha) — ordem esperada (como na aba ${which === 'zoo' ? (recria ? 'BD_Zootec_Feed_ Recria_Conf' : 'BD_Zootec_Feed') : 'BD_Econom_Feed'}, a partir da coluna A): ${cols.map((f) => `${f.col} ${f.label || 'Lote'}`).join(' · ')}. Colunas que não estão na lista (como Mortes % e as calculadas) são ignoradas. Lotes já existentes são atualizados pelo número do lote. TGC ou Cargill Feed Manager (um animal por linha): cole o relatório junto com a linha de cabeçalho (LOTE_SAIDA ou "LOTE Saída confinamento", RAÇA…); os animais são juntados por lote, como a tabela dinâmica da planilha.`;
  };
  showInfo();
  fill(
    dialog,
    h(
      'form',
      {
        class: 'bmk-dialog',
        onsubmit: (e) => {
          e.preventDefault();
          // Relatório por animal (TGC ou Cargill Feed Manager) colado com o cabeçalho: junta por lote.
          const t = reportFromText(area.value);
          if (t) {
            if (!t.lotes.length) return toast(`O relatório do ${reportLabel(t)} não tem nenhum lote com animal vendido.`, 'error');
            const { added, updated } = mergeLotes(kind, t.lotes);
            changed();
            dialog.close();
            lotesPanel(kind);
            toast(`Relatório do ${reportLabel(t)}: ${reportResumo(t)}. ${added} lote(s) incluído(s), ${updated} atualizado(s).`);
            afterAnimalImport(kind, t.source);
            return;
          }
          const rows = rowsFromTsv(area.value, which === 'zoo' ? COLUNAS_ZOO : COLUNAS_ECO);
          if (!rows.length) return toast('Nenhuma linha com número de lote foi encontrada.', 'error');
          const { added, updated } = mergeLotes(kind, rows);
          changed();
          dialog.close();
          lotesPanel(kind);
          toast(`${added} lote(s) incluído(s), ${updated} atualizado(s).`);
        },
      },
      h('h2', {}, `Colar do Excel · ${recria ? 'recria confinada' : 'engorda'}`),
      recria
        ? null
        : h(
            'div',
            { class: 'bmk-seg' },
            [['zoo', 'Dados zootécnicos'], ['eco', 'Dados econômicos']].map(([v, label]) =>
              h(
                'button',
                {
                  type: 'button',
                  class: v === which ? 'on' : '',
                  onclick: (e) => {
                    which = v;
                    e.target.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target));
                    showInfo();
                  },
                },
                label,
              ),
            ),
          ),
      info,
      area,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancelar'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Incluir lotes')),
    ),
  );
  dialog.showModal();
  area.focus();
}

// ---------- Modelo em Excel para preencher e importar ----------

// Feed Manager (um lote por linha), TGC ou Cargill Feed Manager (um animal por linha).
function downloadModelo() {
  const baixar = async (tipo) => {
    dialog.close();
    try {
      toast('Montando o modelo…');
      await baixarModelo(tipo, settings(), state.clients.find((c) => c.id === state.clientId)?.name);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  fill(
    dialog,
    h(
      'form',
      { class: 'bmk-dialog', onsubmit: (e) => e.preventDefault() },
      h('h2', {}, 'Baixar modelo em Excel'),
      h('p', { class: 'muted' }, 'Escolha o software de onde vêm os dados. O modelo tem as mesmas abas e colunas da planilha de benchmarking, mais uma aba para o questionário. Depois de preencher, suba o arquivo em "Importar planilha".'),
      h(
        'div',
        { class: 'bmk-clear-list' },
        Object.entries(MODELOS).map(([tipo, m]) => h('button', { class: 'btn bmk-modelo-opt', type: 'button', onclick: () => baixar(tipo) }, h('strong', {}, m.label), h('small', { class: 'muted' }, m.desc))),
      ),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancelar')),
    ),
  );
  // Também é aberto de dentro da janela de importação, que já está aberta.
  if (!dialog.open) dialog.showModal();
}

// ---------- Importar a planilha atual (.xlsb/.xlsx) ----------

let xlsxLoading = null;
function loadXlsx() {
  xlsxLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => {
      xlsxLoading = null;
      reject(new Error('Não foi possível carregar o leitor de planilhas.'));
    };
    document.head.append(s);
  });
  return xlsxLoading;
}

// Linha da aba Q1 (1 a 100) → pergunta do questionário (as sem número ficam pela posição).
const Q1_ROWS = [
  ...Array.from({ length: 39 }, (_, i) => `q${i + 1}`),
  'q40a', 'q40b', 'q40c', 'q41', 'q42', 'q43', 'q44',
  ...Array.from({ length: 12 }, (_, i) => `q${45 + i}`),
  'q57', 'q58', 'q59', 'q60', 'q61', 'q62', 'q62b', 'q63', 'q63b', 'q63c', 'q64', 'q65', 'q66', 'q66b', 'q67', 'q68',
  'q69a', 'q69b', 'q69c', 'q69d', 'q69e', 'q70',
  ...Array.from({ length: 16 }, (_, i) => `q${71 + i}`),
  'q87', 'q88', 'q89', 'q90',
];

function sheetRows(XLSX, ws, columns, firstRow = 4) {
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 'A', range: firstRow - 1, raw: true, defval: null });
  return rows
    .map((r) => {
      const raw = {};
      for (const f of columns) {
        const v = r[f.col];
        if (v === null || v === undefined || v === '') continue;
        raw[f.key] = f.type === 'date' ? toIsoDate(v) : v;
      }
      return raw;
    })
    .filter((r) => r.lote !== undefined && String(r.lote).trim() !== '');
}

function answerFromCell(q, v) {
  if (v === null || v === undefined || v === '') return null;
  if (q.type === 'multi') return String(v).split(';').map((x) => x.trim()).filter(Boolean);
  const { value } = cleanAnswer(q, v);
  return value ?? String(v).trim();
}

async function readWorkbook(file) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const engZoo = sheetRows(XLSX, wb.Sheets.BD_Zootec_Feed, COLUNAS_ZOO);
  const engEco = sheetRows(XLSX, wb.Sheets.BD_Econom_Feed, COLUNAS_ECO);
  const recria = sheetRows(XLSX, wb.Sheets['BD_Zootec_Feed_ Recria_Conf'], COLUNAS_ZOO);
  const ecoById = new Map(engEco.map((r) => [String(r.lote), r]));
  const engorda = engZoo.map((r) => ({ ...r, ...(ecoById.get(String(r.lote)) || {}) }));
  for (const r of engEco) if (!engZoo.some((z) => String(z.lote) === String(r.lote))) engorda.push(r);
  const feedManager = { engorda: engorda.length, recria: recria.length };
  // Relatórios por animal nas abas próprias: BD_TGC_Conf(_Recria) e BD_CFM_Conf(_Recria).
  const porAnimal = { engorda: [], recria: [] };
  for (const src of Object.values(ANIMAL_SOURCES)) {
    for (const kind of ['engorda', 'recria']) {
      const r = reportFromSheet(XLSX, wb.Sheets[src.sheets[kind]]);
      if (r?.lotes.length) porAnimal[kind].push(r);
    }
  }
  engorda.push(...porAnimal.engorda.flatMap((r) => r.lotes));
  recria.push(...porAnimal.recria.flatMap((r) => r.lotes));
  // Arquivo que não é a planilha de benchmarking: pode ser a exportação pura do TGC ou do CFM.
  let raw = null;
  if (!engorda.length && !recria.length) {
    for (const name of wb.SheetNames) {
      const r = reportFromSheet(XLSX, wb.Sheets[name]);
      if (r?.animais) {
        raw = { ...r, sheet: name };
        break;
      }
    }
  }
  // Modelo baixado do portal: questionário na aba "Questionário" (código + resposta).
  const respostas = lerQuestionario(XLSX, wb, answerFromCell) || {};
  const q1 = wb.Sheets.Q1;
  if (q1) {
    const rows = XLSX.utils.sheet_to_json(q1, { header: 'A', raw: true, defval: null });
    Q1_ROWS.forEach((id, i) => {
      const q = QUESTIONS.find((x) => x.id === id);
      const a = answerFromCell(q, rows[i]?.B);
      if (q && a !== null && !(typeof a === 'number' && a === 0 && ['q45', 'q46', 'q52', 'q53', 'q54'].includes(id))) respostas[id] = a;
    });
  }
  return { engorda, recria, respostas, feedManager, porAnimal, raw, sheets: wb.SheetNames };
}

function importDialog() {
  const fileInput = h('input', { type: 'file', accept: '.xlsb,.xlsx,.xlsm,.xls,.csv' });
  const result = h('div', { class: 'bmk-import-result' });
  let parsed = null;
  const modes = h(
    'div',
    { class: 'bmk-import-modes', hidden: true },
    h('label', { class: 'check' }, h('input', { type: 'radio', name: 'mode', value: 'merge', checked: true }), h('span', {}, h('strong', {}, 'Juntar'), ' — atualiza os lotes com o mesmo número e inclui os novos')),
    h('label', { class: 'check' }, h('input', { type: 'radio', name: 'mode', value: 'replace' }), h('span', {}, h('strong', {}, 'Substituir'), ' — apaga os lotes atuais e fica só com os da planilha')),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'respostas', checked: true }), h('span', {}, 'Trazer também as respostas do questionário')),
  );
  const submitBtn = h('button', { class: 'btn btn-primary', type: 'submit', disabled: true }, 'Importar');
  // Exportação pura do TGC ou do CFM: a pessoa diz se os animais são da engorda ou da recria.
  let rawKind = state.tab === 'recria' ? 'recria' : 'engorda';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fill(result, h('p', { class: 'muted' }, 'Lendo a planilha… (arquivos grandes podem levar alguns segundos)'));
    try {
      parsed = await readWorkbook(file);
      const nResp = Object.keys(parsed.respostas).length;
      const faltando = (x) => (x.faltando.length > 0 && x.lotes.length ? h('small', { class: 'muted' }, ` · colunas que não vieram: ${x.faltando.join(', ')}`) : null);
      // "12 lotes de engorda (3 do Feed Manager + 9 do TGC: …)".
      const origem = (kind) => {
        const reps = parsed.porAnimal[kind];
        if (!reps.length) return kind === 'engorda' && parsed.feedManager.engorda ? [' (BD_Zootec_Feed + BD_Econom_Feed)'] : [''];
        const parts = reps.map((r) => `${r.lotes.length} do ${reportLabel(r)}: ${reportResumo(r)}`);
        if (parsed.feedManager[kind]) parts.unshift(`${parsed.feedManager[kind]} do Feed Manager`);
        return [` (${parts.join(' + ')})`, ...reps.map(faltando)];
      };
      const raw = parsed.raw;
      fill(
        result,
        raw
          ? [
              h(
                'p',
                { class: 'bmk-callout ok' },
                `Relatório do ${reportLabel(raw)} (aba "${raw.sheet}"): ${reportResumo(raw)}. Os animais são juntados por ${ANIMAL_SOURCES[raw.source].loteCol}${raw.source === 'cfm' ? ': zootécnico pela média dos vendidos, custos e receita somados no lote' : ' (contagem e média de cada coluna), como a tabela dinâmica da planilha'}.`,
                faltando(raw),
              ),
              h(
                'div',
                { class: 'bmk-field' },
                h('span', {}, 'Esses animais são de'),
                h(
                  'div',
                  { class: 'bmk-clear-list' },
                  [
                    ['engorda', 'Engorda'],
                    ['recria', 'Recria confinada'],
                  ].map(([k, label]) => h('label', { class: 'bmk-check' }, h('input', { type: 'radio', name: 'rawKind', value: k, checked: k === rawKind, onchange: () => (rawKind = k) }), h('span', {}, label))),
                ),
              ),
            ]
          : h(
              'ul',
              { class: 'bmk-import-list' },
              h('li', {}, h('strong', {}, parsed.engorda.length), ' lotes de engorda', ...origem('engorda')),
              h('li', {}, h('strong', {}, parsed.recria.length), ' lotes de recria confinada', ...origem('recria')),
              h('li', {}, h('strong', {}, nResp), ' respostas do questionário'),
            ),
        !raw && !parsed.engorda.length && !parsed.recria.length && !nResp ? h('p', { class: 'alert' }, `Não encontrei as abas do modelo de benchmarking nem um relatório por animal do TGC (coluna LOTE_SAIDA) ou do Cargill Feed Manager (coluna "LOTE Saída confinamento") neste arquivo (abas: ${parsed.sheets.join(', ')}).`) : null,
      );
      modes.hidden = false;
      modes.querySelector('[name=respostas]').closest('label').hidden = !nResp;
      submitBtn.disabled = !raw && !parsed.engorda.length && !parsed.recria.length && !nResp;
    } catch (err) {
      parsed = null;
      fill(result, h('p', { class: 'alert' }, `Não consegui ler o arquivo: ${err.message}`));
    }
  });
  fill(
    dialog,
    h(
      'form',
      {
        class: 'bmk-dialog',
        onsubmit: (e) => {
          e.preventDefault();
          if (!parsed) return;
          const form = e.target;
          const mode = form.elements.mode.value;
          if (mode === 'replace' && (state.data.engorda.length || state.data.recria.length) && !confirm('Apagar os lotes atuais e ficar só com os da planilha?')) return;
          if (parsed.raw) {
            // Exportação pura (TGC ou CFM): só a lista escolhida (engorda ou recria) é afetada.
            if (mode === 'replace') state.data[rawKind] = [];
            const r = mergeLotes(rawKind, parsed.raw.lotes);
            changed();
            dialog.close();
            if (state.tab !== rawKind) selectTab(rawKind);
            renderAll();
            toast(`Relatório do ${reportLabel(parsed.raw)}: ${reportResumo(parsed.raw)}. ${r.added} lote(s) incluído(s), ${r.updated} atualizado(s).`);
            afterAnimalImport(rawKind, parsed.raw.source);
            return;
          }
          if (mode === 'replace') {
            state.data.engorda = [];
            state.data.recria = [];
          }
          const a = mergeLotes('engorda', parsed.engorda);
          const b = mergeLotes('recria', parsed.recria);
          if (form.elements.respostas.checked) state.data.respostas = { ...state.data.respostas, ...parsed.respostas };
          changed();
          dialog.close();
          renderAll();
          toast(`Importado: ${a.added + a.updated} lotes de engorda, ${b.added + b.updated} de recria. Confira os erros e alertas.`);
          const sum = localSummary();
          const rep = parsed.porAnimal.engorda[0] || parsed.porAnimal.recria[0];
          if (rep) afterAnimalImport(state.tab === 'recria' ? 'recria' : 'engorda', rep.source);
          else if (sum.erros) setTimeout(() => standardizeDialog(state.tab === 'recria' ? 'recria' : 'engorda', { auto: true }), 400);
        },
      },
      h('h2', {}, 'Importar a planilha de benchmarking'),
      h('p', { class: 'muted' }, 'Escolha o modelo baixado do portal depois de preenchido, a planilha de benchmarking ("Benchmarking Confinamento Probeef …", .xlsb ou .xlsx), com os dados do Feed Manager, do TGC e/ou do Cargill Feed Manager nas abas próprias, ou direto o relatório por animal exportado do TGC ou do Cargill Feed Manager ("Relatório de fechamento individual", .xlsx, .xls ou .csv). O arquivo é lido aqui no seu navegador; só os dados vão para o portal.'),
      h('p', { class: 'muted' }, 'Ainda não tem o modelo? ', h('button', { class: 'btn btn-sm', type: 'button', onclick: downloadModelo }, 'Baixar modelo em Excel')),
      fileInput,
      result,
      modes,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancelar'), submitBtn),
    ),
  );
  dialog.showModal();
}

// ---------- Padronizar listas (o "Validação e Classificação" da planilha) ----------

// ---------- Preencher vários lotes de uma vez (origem, tipo de entrada, raça, categoria) ----------

// Pergunta 10 do questionário (modelos de reposição) -> origem do lote. Parceria/Outro não têm origem.
const Q10_ORIGEM = { 'Recria a pasto na fazenda': 'Recria Pasto', 'Recria confinada na fazenda': 'Recria Confinada', Compra: 'Compra Direta' };

// Sugestão só quando a fazenda marcou um único modelo que vira origem (e nada além dele).
function origemSugerida() {
  const marcados = Array.isArray(state.data.respostas.q10) ? state.data.respostas.q10.filter(Boolean) : [];
  if (marcados.length !== 1) return null;
  const origem = Q10_ORIGEM[marcados[0]];
  return origem && settings().listas.origens.includes(origem) ? { origem, resposta: marcados[0] } : null;
}

// Campos que dá para preencher em vários lotes de uma vez (o TGC, por exemplo, não traz o tipo de entrada).
const FILL_FIELDS = [
  ['origem', 'Origem', 'origens'],
  ['tipoEntrada', 'Tipo de entrada', 'tiposEntrada'],
  ['raca', 'Raça', 'racas'],
  ['categoria', 'Categoria', 'categorias'],
];

function originDialog(kind, field = 'origem') {
  const [, fieldLabel, list] = FILL_FIELDS.find((f) => f[0] === field);
  const nome = fieldLabel.toLowerCase();
  const lotes = state.data[kind];
  const visible = state.visibleRows[kind] || [];
  const vazios = lotes.map((l, i) => i).filter((i) => !lotes[i][field]);
  const sugestao = field === 'origem' ? origemSugerida() : null;
  const valores = settings().listas[list];
  let valor = sugestao?.origem || '';
  const targets = [
    { id: 'vazios', label: `Lotes sem ${nome} (${vazios.length})`, idx: vazios },
    // Só faz sentido quando a tabela está filtrada ou com busca.
    visible.length < lotes.length ? { id: 'tabela', label: `Lotes que aparecem na tabela agora (${visible.length})`, idx: visible } : null,
    { id: 'todos', label: `Todos os lotes (${lotes.length}) — troca também o que já está preenchido`, idx: lotes.map((l, i) => i) },
  ].filter(Boolean);
  // "Todos" troca o que já foi preenchido: nunca vem marcado sozinho.
  let target = vazios.length ? 'vazios' : targets.some((t) => t.id === 'tabela') ? 'tabela' : '';
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' });
  const buttons = h('div', { class: 'bmk-seg bmk-seg-wrap', role: 'radiogroup', 'aria-label': fieldLabel });
  const sync = () => {
    buttons.replaceChildren(...valores.map((o) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(o === valor), class: o === valor ? 'on' : '', onclick: () => ((valor = o), sync()) }, o)));
    const n = targets.find((t) => t.id === target)?.idx.length || 0;
    submit.textContent = !target ? 'Escolha onde aplicar' : n ? `Preencher ${n} ${n === 1 ? 'lote' : 'lotes'}` : 'Nenhum lote';
    submit.disabled = !valor || !n;
  };
  const radios = targets.map((t) =>
    h('label', { class: 'bmk-check' }, h('input', { type: 'radio', name: 'alvo', value: t.id, checked: t.id === target, disabled: !t.idx.length, onchange: () => ((target = t.id), sync()) }), h('span', {}, t.label)),
  );
  const fieldSel = h(
    'select',
    { 'aria-label': 'Campo', onchange: (e) => originDialog(kind, e.target.value) },
    FILL_FIELDS.map(([k, label]) => {
      const n = lotes.filter((l) => !l[k]).length;
      return h('option', { value: k, selected: k === field }, n ? `${label} (${n} sem)` : label);
    }),
  );
  sync();
  fill(
    dialog,
    h(
      'form',
      {
        class: 'bmk-dialog',
        onsubmit: (e) => {
          e.preventDefault();
          const idx = targets.find((t) => t.id === target)?.idx || [];
          for (const i of idx) lotes[i] = { ...lotes[i], [field]: valor };
          if (idx.length) changed();
          dialog.close();
          lotesPanel(kind);
          renderStatus();
          toast(`${fieldLabel} "${valor}" preenchido em ${idx.length} ${idx.length === 1 ? 'lote' : 'lotes'}.`);
        },
      },
      h('h2', {}, 'Preencher em lote'),
      h('label', { class: 'bmk-field' }, h('span', {}, 'Campo'), fieldSel),
      sugestao
        ? h('p', { class: 'bmk-callout ok' }, `No questionário (pergunta 10), a fazenda marcou só "${sugestao.resposta}" como reposição: sugerimos "${sugestao.origem}". Confira e aplique.`)
        : h('p', { class: 'muted' }, `Escolha o valor e em quais lotes aplicar. Para lotes com valores diferentes, filtre ou busque na tabela antes (por raça, curral…) e aplique só nos que aparecem.`),
      h('div', { class: 'bmk-field' }, h('span', {}, fieldLabel), buttons),
      h('div', { class: 'bmk-field' }, h('span', {}, 'Aplicar em'), h('div', { class: 'bmk-clear-list' }, radios)),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancelar'), submit),
    ),
  );
  if (!dialog.open) dialog.showModal();
}

function standardizeDialog(kind, { auto = false } = {}) {
  const listFields = ZOO_FIELDS.filter((f) => f.type === 'list');
  const lists = settings().listas;
  const unknown = [];
  for (const f of listFields) {
    const values = new Map();
    for (const l of state.data[kind]) {
      const v = l[f.key];
      if (v && !lists[f.list].includes(v)) values.set(v, (values.get(v) || 0) + 1);
    }
    for (const [v, n] of values) unknown.push({ f, v, n });
  }
  if (!unknown.length) {
    if (!auto) toast('Todos os valores de raça, categoria, origem e tipo de entrada já estão nas listas.');
    return;
  }
  // Nomes que o TGC e o Cargill Feed Manager usam → item da lista (só se o item existir na lista).
  const SINONIMOS = [
    [/leite/, 'Cruz.Leiteiro'],
    [/angus.*(cruz|mesti|f1)|(cruz|mesti|f1).*angus/, 'Cruz.Industrial(Angus)'],
    [/anelorad/, 'Anelorado'],
    [/novilha|femea/, 'Fêmea de Engorda'],
    [/vaca/, 'Vaca de Descarte'],
    [/^(macho|boi|garrote|novilho)/, 'Macho de Engorda'],
  ];
  const guess = (v, opts) => {
    const fold = (t) => String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const sinonimo = SINONIMOS.find(([re, o]) => re.test(fold(v)) && opts.includes(o))?.[1];
    return opts.find((o) => fold(o) === fold(v)) || sinonimo || opts.find((o) => fold(v).includes(fold(o).split(/[ (]/)[0])) || '';
  };
  const rows = unknown.map((u) => {
    const sel = h('select', {}, h('option', { value: '' }, 'Deixar como está'), lists[u.f.list].map((o) => h('option', { value: o, selected: guess(u.v, lists[u.f.list]) === o }, o)));
    return { u, sel, el: h('tr', {}, h('td', {}, u.f.label), h('td', {}, h('code', {}, u.v)), h('td', { class: 'num' }, u.n), h('td', {}, sel)) };
  });
  fill(
    dialog,
    h(
      'form',
      {
        class: 'bmk-dialog',
        onsubmit: (e) => {
          e.preventDefault();
          let n = 0;
          for (const { u, sel } of rows) {
            if (!sel.value) continue;
            for (const l of state.data[kind]) if (l[u.f.key] === u.v) {
              l[u.f.key] = sel.value;
              n += 1;
            }
          }
          if (n) changed();
          dialog.close();
          renderAll();
          toast(n ? `${n} valor(es) padronizado(s).` : 'Nada alterado.');
        },
      },
      h('h2', {}, 'Padronizar raça, categoria, origem e tipo de entrada'),
      h('p', { class: 'muted' }, 'Estes valores não estão nas listas do benchmarking. Escolha o equivalente de cada um (as sugestões já vêm marcadas) e aplique em todos os lotes de uma vez.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'bmk-mini' }, h('thead', {}, h('tr', {}, h('th', {}, 'Campo'), h('th', {}, 'Valor encontrado'), h('th', {}, 'Lotes'), h('th', {}, 'Usar'))), h('tbody', {}, rows.map((r) => r.el)))),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Agora não'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Aplicar')),
    ),
  );
  dialog.showModal();
}

// ---------- Questionário ----------

function questionInput(q, editable) {
  const r = state.data.respostas;
  const value = r[q.id];
  const set = (v) => {
    r[q.id] = v;
    changed();
  };
  const error = h('small', { class: 'bmk-q-error' });
  const showError = (v) => {
    const { error: e } = cleanAnswer(q, v);
    error.textContent = e || '';
  };
  if (['text', 'email', 'int', 'num', 'pct'].includes(q.type)) {
    const input = h('input', {
      type: q.type === 'email' ? 'email' : 'text',
      inputmode: ['int', 'num', 'pct'].includes(q.type) ? 'decimal' : undefined,
      value: typeof value === 'number' ? String(value).replace('.', ',') : (value ?? ''),
      disabled: !editable,
      onchange: (e) => {
        const v = e.target.value.trim();
        showError(v);
        const { value: clean } = cleanAnswer(q, v);
        set(clean ?? (v || null));
        renderQuestionProgress();
      },
    });
    if (value !== undefined && value !== null) showError(value);
    return h('div', { class: 'bmk-q-input' }, h('span', { class: 'bmk-input-unit' }, input, q.unit ? h('span', {}, q.unit) : null), error);
  }
  if (q.type === 'uf') {
    return h('select', { disabled: !editable, onchange: (e) => (set(e.target.value || null), renderQuestionProgress()) }, h('option', { value: '' }, '—'), OPTIONS.UFS.map((u) => h('option', { value: u, selected: value === u }, u)));
  }
  if (q.type === 'textarea') {
    return h('textarea', { rows: 4, disabled: !editable, onchange: (e) => (set(e.target.value.trim() || null), renderQuestionProgress()) }, value || '');
  }
  if (q.type === 'sn' || q.type === 'choice') {
    const opts = q.type === 'sn' ? OPTIONS.SN : q.options;
    const isOther = value && !opts.includes(value);
    const other = h('input', { type: 'text', placeholder: 'Qual?', value: isOther ? value : '', disabled: !editable, hidden: !isOther, onchange: (e) => (set(e.target.value.trim() || null), renderQuestionProgress()) });
    return h(
      'div',
      { class: 'bmk-options' },
      opts.map((o) =>
        h(
          'label',
          { class: `bmk-opt${value === o ? ' on' : ''}` },
          h('input', {
            type: 'radio',
            name: q.id,
            value: o,
            checked: value === o,
            disabled: !editable,
            onchange: () => {
              set(o);
              renderQuestions();
            },
          }),
          o,
        ),
      ),
      q.other
        ? h(
            'label',
            { class: `bmk-opt${isOther ? ' on' : ''}` },
            h('input', {
              type: 'radio',
              name: q.id,
              checked: Boolean(isOther),
              disabled: !editable,
              onchange: () => {
                other.hidden = false;
                other.focus();
              },
            }),
            'Outro',
          )
        : null,
      q.other ? other : null,
    );
  }
  if (q.type === 'multi') {
    const list = Array.isArray(value) ? value : [];
    const extra = list.filter((v) => !q.options.includes(v));
    const other = h('input', {
      type: 'text',
      placeholder: 'Outros (separe por ponto e vírgula)',
      value: extra.join('; '),
      disabled: !editable,
      onchange: (e) => {
        const typed = e.target.value.split(';').map((x) => x.trim()).filter(Boolean);
        set([...list.filter((v) => q.options.includes(v)), ...typed]);
        renderQuestionProgress();
      },
    });
    return h(
      'div',
      { class: 'bmk-options' },
      q.options.map((o) =>
        h(
          'label',
          { class: `bmk-opt${list.includes(o) ? ' on' : ''}` },
          h('input', {
            type: 'checkbox',
            checked: list.includes(o),
            disabled: !editable,
            onchange: (e) => {
              const next = e.target.checked ? [...list, o] : list.filter((x) => x !== o);
              if (q.max && next.filter((x) => q.options.includes(x)).length > q.max) {
                e.target.checked = false;
                return toast(`Escolha no máximo ${q.max}.`, 'error');
              }
              set(next);
              renderQuestions();
            },
          }),
          o,
        ),
      ),
      q.other ? other : null,
      q.max ? h('small', { class: 'muted' }, q.min === q.max ? `Escolha exatamente ${q.max}.` : `Escolha até ${q.max}.`) : null,
    );
  }
  return null;
}

function renderQuestionProgress() {
  renderStatus();
  const v = validateQuestionario(state.data.respostas);
  for (const s of QUESTIONARIO) {
    const el = document.querySelector(`[data-qsection="${s.id}"] .bmk-qnav-count`);
    if (!el) continue;
    const qs = s.questions.filter((q) => questionVisible(q, state.data.respostas));
    const done = qs.filter((q) => {
      const a = state.data.respostas[q.id];
      return !(a === null || a === undefined || a === '' || (Array.isArray(a) && !a.length));
    }).length;
    el.textContent = `${done}/${qs.length}`;
    el.classList.toggle('done', done === qs.length);
    el.classList.toggle('missing', s.questions.some((q) => v.faltando.includes(q.id)));
  }
}

function renderQuestions() {
  const panel = document.querySelector('[data-panel="questionario"]');
  const editable = canEdit();
  const v = validateQuestionario(state.data.respostas);
  const section = QUESTIONARIO.find((s) => s.id === state.qSection) || QUESTIONARIO[0];
  const idx = QUESTIONARIO.indexOf(section);
  const scrollY = document.getElementById('bmk').scrollTop;
  fill(
    panel,
    h(
      'div',
      { class: 'bmk-q-layout' },
      h(
        'nav',
        { class: 'bmk-qnav', 'aria-label': 'Seções do questionário' },
        QUESTIONARIO.map((s) =>
          h('button', { type: 'button', 'data-qsection': s.id, class: s.id === section.id ? 'on' : '', onclick: () => ((state.qSection = s.id), renderQuestions(), document.getElementById('bmk').scrollTo({ top: 0 })) }, h('span', {}, s.title), h('span', { class: 'bmk-qnav-count' })),
        ),
      ),
      h(
        'div',
        { class: 'bmk-q-section' },
        h('h2', {}, section.title),
        section.note ? h('p', { class: 'muted' }, section.note) : null,
        section.questions
          .filter((q) => questionVisible(q, state.data.respostas))
          .map((q) =>
            h(
              'div',
              { class: `bmk-q${v.faltando.includes(q.id) ? ' missing' : ''}` },
              h('label', { class: 'bmk-q-label' }, h('span', { class: 'bmk-q-n' }, q.n), h('span', {}, questionText(q, settings()), q.req ? h('span', { class: 'bmk-req' }, ' *') : null)),
              q.hint ? h('small', { class: 'muted' }, questionText({ text: q.hint }, settings())) : null,
              questionInput(q, editable),
              v.motivos[q.id] ? h('small', { class: 'bmk-q-err' }, `✕ ${v.motivos[q.id]}`) : null,
              v.alertas.filter((a) => a.id === q.id).map((a) => h('small', { class: 'bmk-q-warn' }, `⚠ ${a.msg}`)),
            ),
          ),
        h(
          'div',
          { class: 'bmk-q-nav' },
          idx > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => ((state.qSection = QUESTIONARIO[idx - 1].id), renderQuestions(), document.getElementById('bmk').scrollTo({ top: 0 })) }, `← ${QUESTIONARIO[idx - 1].title}`) : h('span'),
          idx < QUESTIONARIO.length - 1 ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ((state.qSection = QUESTIONARIO[idx + 1].id), renderQuestions(), document.getElementById('bmk').scrollTo({ top: 0 })) }, `${QUESTIONARIO[idx + 1].title} →`) : null,
        ),
      ),
    ),
  );
  document.getElementById('bmk').scrollTop = scrollY;
  renderQuestionProgress();
}

// ---------- Resultado (abas FINAL e FINAL RECRIA) ----------

function renderResult() {
  const panel = document.querySelector('[data-panel="resultado"]');
  const cats = settings().listas.categorias;
  // Critério de exclusão: os lotes fora dos limites saem do resultado (continuam na base).
  const exc = { engorda: separarExclusao(state.data.engorda, 'engorda', settings()), recria: separarExclusao(state.data.recria, 'recria', settings()) };
  const nExcluidos = exc.engorda.excluidos.length + exc.recria.excluidos.length;
  const eng = cats.map((c) => resultadoEngorda(exc.engorda.incluidos, state.data.respostas, c)).filter(Boolean);
  const rec = cats.map((c) => resultadoRecria(exc.recria.incluidos, c)).filter(Boolean);
  const table = (rows, obj, fonte = {}) =>
    h(
      'table',
      { class: 'bmk-result-table' },
      h(
        'tbody',
        {},
        rows.map(([key, label, d, src]) => h('tr', {}, h('th', {}, label, src && fonte[src] === 'questionário' ? h('span', { class: 'bmk-src', title: 'Valor informado no questionário' }, 'questionário') : null), h('td', { class: 'num' }, nf(obj[key], d)))),
      ),
    );
  const engCard = (r) =>
    h(
      'section',
      { class: 'bmk-card' },
      h('header', { class: 'bmk-card-head' }, h('h2', {}, r.categoria), h('span', { class: 'muted' }, `${nf(r.zootecnico.animais, 0)} animais em ${r.zootecnico.lotes} lote(s)`)),
      h(
        'div',
        { class: 'bmk-hero-row' },
        [
          ['Lucro', r.economico.lucro, 'R$/cab', 2],
          ['Rentabilidade', r.economico.rentabilidadeMensal, '% ao mês', 2],
          ['Custo total da @', r.economico.custoTotalArroba, 'R$/@', 2],
          ['GDC', r.zootecnico.gdc, 'kg/dia', 3],
        ].map(([label, v, unit, d]) => h('div', { class: 'bmk-hero' }, h('span', {}, label), h('strong', { class: v < 0 ? 'neg' : '' }, nf(v, d)), h('small', {}, unit))),
      ),
      h('div', { class: 'bmk-result-cols' }, h('div', {}, h('h3', {}, 'Zootécnico'), table(ZOO_RESULT_ROWS, r.zootecnico)), h('div', {}, h('h3', {}, 'Econômico'), table(ECO_RESULT_ROWS, r.economico, r.fonte))),
    );
  const recCard = (r) => h('section', { class: 'bmk-card' }, h('header', { class: 'bmk-card-head' }, h('h2', {}, `Recria · ${r.categoria}`), h('span', { class: 'muted' }, `${nf(r.zootecnico.animais, 0)} animais em ${r.zootecnico.lotes} lote(s)`)), table(ZOO_RESULT_ROWS, r.zootecnico));
  const sum = localSummary();
  // Duas visões: o painel (filtros e comparações) e as tabelas por categoria da planilha.
  const view = state.resultView;
  const switcher = h(
    'div',
    { class: 'bmk-seg bmk-result-switch', role: 'radiogroup', 'aria-label': 'Visão do resultado' },
    [
      ['painel', 'Painel'],
      ['tabelas', 'Tabelas por categoria'],
      ['exclusoes', `Exclusões${nExcluidos ? ` (${nExcluidos})` : ''}`],
    ].map(([k, t]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(view === k), class: view === k ? 'on' : '', onclick: () => ((state.resultView = k), renderResult()) }, t)),
  );
  const dashBox = h('div', { class: 'bmk-dash' });
  fill(
    panel,
    switcher,
    sum.erros ? h('div', { class: 'bmk-callout warn' }, `Há ${sum.erros} erro(s) nos lotes: o resultado abaixo pode mudar depois das correções.`) : null,
    nExcluidos && view !== 'exclusoes'
      ? h('div', { class: 'bmk-callout' }, `${nExcluidos} lote(s) ficaram fora do resultado pelo critério de exclusão de dados (continuam na base). `, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ((state.resultView = 'exclusoes'), renderResult()) }, 'Ver exclusões'))
      : null,
    view === 'exclusoes'
      ? exclusoesView(exc)
      : view === 'painel'
      ? dashBox
      : [
          h('p', { class: 'muted' }, 'Médias ponderadas pelo número de animais de cada lote, por categoria (como a aba FINAL da planilha). Os custos marcados "questionário" vêm das respostas da seção Comercialização; os demais, dos lotes.'),
          eng.length || rec.length ? [eng.map(engCard), rec.map(recCard)] : h('div', { class: 'bmk-blank' }, h('h3', {}, 'Ainda sem resultado'), h('p', { class: 'muted' }, 'Inclua lotes com categoria e número de animais para ver o resultado.')),
        ],
  );
  if (view === 'painel') renderDashboard(dashBox, { engorda: exc.engorda.incluidos, recria: exc.recria.incluidos });
}

// Aba Exclusões: o que saiu do resultado, por quê (valor × limite) e os limites usados.
function exclusoesView(exc) {
  const kinds = [
    ['engorda', 'Engorda'],
    ['recria', 'Recria confinada'],
  ];
  const animais = (ls) => ls.reduce((t, l) => t + (Number(l.qtAnm) || 0), 0);
  const tiles = kinds.map(([k, label]) => {
    const e = exc[k];
    const total = e.incluidos.length + e.excluidos.length;
    if (!total) return null;
    return h(
      'div',
      { class: 'bmk-excl-tile' },
      h('span', {}, label),
      h('strong', {}, `${e.excluidos.length} de ${total} lotes excluídos`),
      h('small', { class: 'muted' }, `${nf(animais(e.excluidos.map((x) => x.lote)), 0)} de ${nf(animais([...e.incluidos, ...e.excluidos.map((x) => x.lote)]), 0)} animais · ${total ? nf((e.excluidos.length / total) * 100, 1) : '0'}% dos lotes`),
    );
  });
  // Quantos lotes cada critério tirou (um lote pode cair em mais de um).
  const porCriterio = h(
    'table',
    { class: 'bmk-result-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Critério'), ...kinds.map(([, label]) => h('th', { class: 'num' }, label)))),
    h(
      'tbody',
      {},
      Object.entries(EXCLUSAO_LABELS).map(([key, [label]]) =>
        h('tr', {}, h('th', {}, label), ...kinds.map(([k]) => h('td', { class: 'num' }, exc[k].excluidos.filter((x) => x.motivos.some((m) => m.criterio === key)).length || '—'))),
      ),
    ),
  );
  const limites = settings().exclusao;
  const faixa = (r) => (!r ? '—' : r[1] === null ? `mín. ${nf(r[0], r[0] % 1 ? 1 : 0)}` : `${nf(r[0], 1)} a ${nf(r[1], 1)}`);
  const regras = h(
    'table',
    { class: 'bmk-result-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Limites usados'), h('th', { class: 'num' }, 'Engorda machos'), h('th', { class: 'num' }, 'Engorda fêmeas'), h('th', { class: 'num' }, 'Recria machos'), h('th', { class: 'num' }, 'Recria fêmeas'))),
    h(
      'tbody',
      {},
      h('tr', {}, h('th', {}, 'Enfermaria ou refugo'), ...[1, 2, 3, 4].map(() => h('td', { class: 'num' }, 'exclui'))),
      Object.entries(EXCLUSAO_LABELS)
        .filter(([key]) => key !== 'enfermaria')
        .map(([key, [label, unit]]) => h('tr', {}, h('th', {}, label, unit ? h('small', { class: 'muted' }, ` (${unit})`) : null), ...[limites.engorda.macho, limites.engorda.femea, limites.recria.macho, limites.recria.femea].map((r) => h('td', { class: 'num' }, faixa(r[key]))))),
    ),
  );
  const linhas = kinds.flatMap(([k, label]) =>
    exc[k].excluidos.map(({ lote: l, motivos }) =>
      h(
        'tr',
        {},
        h('td', {}, label),
        h('td', {}, h('strong', {}, l.lote ?? '—'), l.curral ? h('small', { class: 'muted bmk-sub' }, `curral ${l.curral}`) : null),
        h('td', {}, l.categoria || '—'),
        h('td', { class: 'num' }, nf(Number(l.qtAnm) || 0, 0)),
        h('td', {}, h('ul', { class: 'bmk-excl-motivos' }, motivos.map((m) => h('li', {}, m.msg)))),
      ),
    ),
  );
  return [
    h('p', { class: 'muted' }, 'Critério de exclusão de dados: lotes de enfermaria ou refugo e lotes com consumo de MS, dias de cocho, rendimento de carcaça, arrobas produzidas ou ganho médio diário fora dos limites não entram no resultado (tabelas por categoria, Painel e consolidado). Eles continuam na base, sem alteração. O sexo vem da categoria; vale o valor informado no lote e, sem ele, o recalculado.'),
    h('div', { class: 'bmk-excl-tiles' }, tiles),
    h('div', { class: 'bmk-result-cols' }, h('div', {}, h('h3', {}, 'Lotes por critério'), porCriterio), h('div', {}, h('h3', {}, 'Como: os limites'), regras)),
    h('h3', {}, 'Lotes excluídos'),
    linhas.length
      ? h('div', { class: 'bmk-grid-wrap' }, h('table', { class: 'bmk-grid bmk-excl-table' }, h('thead', {}, h('tr', {}, ['Tipo', 'Lote', 'Categoria', 'Animais', 'Por quê'].map((t) => h('th', {}, t)))), h('tbody', {}, linhas)))
      : h('p', { class: 'muted' }, 'Nenhum lote excluído: todos estão dentro dos limites.'),
  ];
}

// ---------- Histórico ----------

const ACTION_LABEL = { enviado: 'Enviado para validação', devolver: 'Devolvido para correção', aprovar: 'Aprovado', reabrir: 'Reaberto para edição', limpar: 'Dados apagados' };

function renderHistory() {
  const panel = document.querySelector('[data-panel="historico"]');
  const msgs = [...state.view.submission.messages].reverse();
  fill(
    panel,
    msgs.length
      ? h('ol', { class: 'bmk-history' }, msgs.map((m) => h('li', {}, h('strong', {}, ACTION_LABEL[m.action] || m.action), h('span', { class: 'muted' }, ` · ${m.byName || '—'} · ${fmtDateTime(m.at)}`), m.text ? h('p', {}, m.text) : null)))
      : h('p', { class: 'muted' }, 'Nenhum envio ainda.'),
  );
}

// ---------- Envio e validação ----------

function submitDialog() {
  const sum = localSummary();
  const text = h('textarea', { rows: 3, placeholder: 'Observações para a Cargill (opcional), por exemplo a explicação de algum alerta.' });
  fill(
    dialog,
    h(
      'form',
      {
        class: 'bmk-dialog',
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await saveNow();
            const view = await api(`/api/benchmark/${state.clientId}/submit`, { method: 'POST', body: { text: text.value } });
            applyView(view);
            dialog.close();
            toast('Enviado! A Cargill vai validar e você recebe a resposta pelo botão Mensagens do portal.');
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
      h('h2', {}, 'Enviar para validação'),
      h('p', {}, `${sum.total} lote(s), ${sum.q.respondidas} resposta(s) no questionário.`),
      sum.alertas ? h('p', { class: 'bmk-callout warn' }, `Ainda há ${sum.alertas} alerta(s). Pode enviar mesmo assim, mas explique abaixo se forem valores corretos.`) : null,
      text,
      h('p', { class: 'muted' }, 'Depois do envio a edição fica travada até a Cargill aprovar ou devolver para correção.'),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancelar'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Enviar')),
    ),
  );
  dialog.showModal();
}

// Apagar de uma vez o que foi preenchido. Pede para digitar APAGAR, porque não tem volta.
function clearDialog() {
  const answered = Object.values(state.data.respostas).filter((v) => v !== null && v !== '' && !(Array.isArray(v) && !v.length)).length;
  const parts = [
    { id: 'engorda', label: 'Lotes de engorda', n: state.data.engorda.length },
    { id: 'recria', label: 'Lotes de recria', n: state.data.recria.length },
    { id: 'respostas', label: 'Respostas do questionário', n: answered },
  ].map((p) => ({ ...p, box: h('input', { type: 'checkbox', checked: p.n > 0, disabled: p.n === 0 }) }));
  const word = h('input', { type: 'text', autocomplete: 'off', placeholder: 'APAGAR', 'aria-label': 'Digite APAGAR para confirmar' });
  const submit = h('button', { class: 'btn btn-danger', type: 'submit', disabled: true }, 'Apagar');
  const sync = () => (submit.disabled = word.value.trim().toUpperCase() !== 'APAGAR' || !parts.some((p) => p.box.checked));
  word.addEventListener('input', sync);
  parts.forEach((p) => p.box.addEventListener('change', sync));
  fill(
    dialog,
    h(
      'form',
      {
        class: 'bmk-dialog',
        onsubmit: async (e) => {
          e.preventDefault();
          submit.disabled = true;
          try {
            // Grava antes o que estiver pendente, para não perder a parte que não vai ser apagada.
            await saveNow();
            const chosen = parts.filter((p) => p.box.checked).map((p) => p.id);
            const view = await api(`/api/benchmark/${state.clientId}/clear`, { method: 'POST', body: { version: state.version, parts: chosen } });
            applyView(view);
            dialog.close();
            toast('Pronto, o que você escolheu foi apagado.');
          } catch (err) {
            toast(err.message, 'error');
            sync();
          }
        },
      },
      h('h2', {}, 'Apagar o que foi preenchido'),
      h('p', {}, 'Escolha o que apagar. Isso vale para todos da sua empresa e não dá para desfazer.'),
      h('div', { class: 'bmk-clear-list' }, parts.map((p) => h('label', { class: 'bmk-check' }, p.box, h('span', {}, `${p.label} `, h('span', { class: 'muted' }, `(${p.n})`))))),
      h('label', { class: 'bmk-field' }, h('span', {}, 'Para confirmar, digite APAGAR'), word),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancelar'), submit),
    ),
  );
  dialog.showModal();
  word.focus();
}

function reviewDialog(action) {
  const titles = { devolver: 'Devolver para correção', aprovar: 'Aprovar benchmarking', reabrir: 'Reabrir para edição' };
  const text = h('textarea', { rows: 4, required: action === 'devolver', placeholder: action === 'devolver' ? 'O que precisa ser corrigido? (o cliente recebe esta mensagem)' : 'Mensagem para o cliente (opcional)' });
  fill(
    dialog,
    h(
      'form',
      {
        class: 'bmk-dialog',
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            const view = await api(`/api/benchmark/${state.clientId}/review`, { method: 'POST', body: { action, text: text.value } });
            applyView(view);
            dialog.close();
            toast({ devolver: 'Devolvido. O cliente recebeu a mensagem no portal.', aprovar: 'Aprovado.', reabrir: 'Reaberto para edição.' }[action]);
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
      h('h2', {}, titles[action]),
      text,
      h('p', { class: 'muted' }, 'A mensagem chega para os usuários do cliente pelo botão Mensagens do portal.'),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancelar'), h('button', { class: `btn ${action === 'devolver' ? 'btn-danger' : 'btn-primary'}`, type: 'submit' }, titles[action])),
    ),
  );
  dialog.showModal();
  text.focus();
}

// ---------- Clientes (para quem valida) ----------

let overviewSeq = 0;
async function renderOverview() {
  const panel = document.querySelector('[data-panel="clientes"]');
  const seq = ++overviewSeq;
  if (!panel.childElementCount) fill(panel, h('p', { class: 'muted' }, 'Carregando…'));
  let data;
  try {
    data = await api('/api/benchmark/overview');
  } catch (err) {
    fill(panel, h('p', { class: 'alert' }, err.message));
    return;
  }
  if (seq !== overviewSeq) return;
  const filtro = state.overviewFilter || 'todos';
  const count = (st) => data.clients.filter((c) => c.status === st).length;
  // Primeiro o que espera validação; dentro de cada situação, por nome.
  const order = { enviado: 0, correcao: 1, rascunho: 2, nao_iniciado: 3, aprovado: 4 };
  const list = data.clients
    .filter((c) => filtro === 'todos' || c.status === filtro)
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.client.localeCompare(b.client, 'pt-BR'));
  const open = async (id) => {
    document.getElementById('client-select').value = id;
    await loadClient(id).catch((err) => toast(err.message, 'error'));
    selectTab('engorda');
  };
  const FILTROS = [
    ['todos', `Todos (${data.clients.length})`],
    ['enviado', `Para validar (${count('enviado')})`],
    ['correcao', `Em correção (${count('correcao')})`],
    ['aprovado', `Aprovados (${count('aprovado')})`],
    ['rascunho', `Em preenchimento (${count('rascunho')})`],
    ['nao_iniciado', `Não iniciados (${count('nao_iniciado')})`],
  ];
  const pill = (st) => {
    const s = STATUS[st];
    return h('span', { class: `bmk-pill ${s?.cls || 'neutral'}` }, s?.label || 'Não iniciado');
  };
  fill(
    panel,
    h(
      'div',
      { class: 'bmk-toolbar' },
      h(
        'div',
        { class: 'bmk-seg', role: 'radiogroup', 'aria-label': 'Situação' },
        FILTROS.map(([k, label]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(filtro === k), class: filtro === k ? 'on' : '', onclick: () => ((state.overviewFilter = k), renderOverview()) }, label)),
      ),
    ),
    h(
      'div',
      { class: 'bmk-grid-wrap' },
      h(
        'table',
        { class: 'bmk-grid bmk-overview' },
        h('thead', {}, h('tr', {}, ['Cliente', 'Situação', 'Lotes', 'Erros / alertas', 'Questionário', 'Última alteração', ''].map((t) => h('th', {}, t)))),
        h(
          'tbody',
          {},
          list.length
            ? list.map((c) =>
                h(
                  'tr',
                  {},
                  h('td', {}, h('strong', {}, c.client)),
                  h('td', {}, pill(c.status), c.submittedAt ? h('small', { class: 'muted bmk-sub' }, `enviado ${fmtDateTime(c.submittedAt)}`) : null),
                  h('td', {}, `${c.lotesEngorda} eng. · ${c.lotesRecria} rec.`),
                  h('td', {}, c.erros ? h('span', { class: 'bmk-chip crit' }, `✕ ${c.erros}`) : h('span', { class: 'muted' }, '0 erros'), ' ', c.alertas ? h('span', { class: 'bmk-chip warn' }, `⚠ ${c.alertas}`) : null),
                  h('td', {}, `${c.questionario.respondidas}/${c.questionario.visiveis}`, c.questionario.faltando ? h('small', { class: 'muted bmk-sub' }, `faltam ${c.questionario.faltando} obrigatórias`) : null),
                  h('td', {}, c.updatedAt ? fmtDateTime(c.updatedAt) : '—', c.updatedBy ? h('small', { class: 'muted bmk-sub' }, c.updatedBy) : null),
                  h('td', {}, h('button', { class: `btn btn-sm${c.status === 'enviado' ? ' btn-primary' : ''}`, type: 'button', onclick: () => open(c.clientId) }, c.status === 'enviado' ? 'Validar' : 'Abrir')),
                ),
              )
            : h('tr', {}, h('td', { colspan: 7, class: 'muted bmk-empty' }, 'Nenhum cliente nesta situação.')),
        ),
      ),
    ),
  );
}

// ---------- Abas e carregamento ----------

function renderAll() {
  renderStatus();
  if (state.tab === 'engorda' || state.tab === 'recria') lotesPanel(state.tab);
  if (state.tab === 'questionario') renderQuestions();
  if (state.tab === 'resultado') renderResult();
  if (state.tab === 'historico') renderHistory();
  if (state.tab === 'clientes') renderOverview();
}

function selectTab(name) {
  state.tab = name;
  beat(); // o tempo até aqui vai para a aba anterior
  // Na visão geral o quadro do cliente aberto não faz sentido.
  document.getElementById('status').hidden = name === 'clientes';
  document.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
  history.replaceState(null, '', `#${name}`);
  renderAll();
}

function applyView(view) {
  state.view = view;
  state.version = view.submission.version;
  state.data = { engorda: structuredClone(view.submission.engorda), recria: structuredClone(view.submission.recria), respostas: structuredClone(view.submission.respostas) };
  // Primeira vez: já preenche nome, e-mail e empresa a partir do portal.
  const r = state.data.respostas;
  if (!view.submission.updatedAt && canEdit() && !state.isAdmin) {
    r.q1 ??= view.client.name;
    r.q5 ??= state.me.name;
    r.q6 ??= state.me.email;
  }
  state.dirty = false;
  state.conflict = false;
  // Datas salvas num formato que o leitor de datas passou a entender: corrige e salva.
  let fixed = 0;
  for (const kind of ['engorda', 'recria']) {
    for (const l of state.data[kind]) {
      if (l.saida === undefined) continue;
      const iso = toIsoDate(l.saida);
      if (iso !== l.saida) ((l.saida = iso), fixed++);
    }
  }
  renderAll();
  if (fixed && canEdit()) {
    changed();
    toast(`${fixed} data(s) de saída convertida(s) para dd/mm/aaaa.`, 'info');
  }
}

async function loadClient(id) {
  await saveNow();
  state.clientId = id;
  try {
    localStorage.setItem('bi-probeef:bmk-cliente', id);
  } catch {
    // Sem armazenamento local: só não lembra o cliente.
  }
  applyView(await api(`/api/benchmark/${id}`));
  if (usage.started) openUsage();
}

async function init() {
  const { user } = await api('/api/auth/me');
  state.me = user;
  initTicker();
  // Mensagens com a equipe: a mesma conversa do portal; cada mensagem leva o Benchmarking e o cliente.
  if (user.role === 'client') {
    initChat({
      button: document.getElementById('chat-button'),
      badge: document.getElementById('chat-badge'),
      readOnly: Boolean(user.impersonatedBy),
      getContext: () => (state.clientId ? { tool: 'benchmark', clientId: state.clientId, label: `Benchmarking · ${state.view?.client.name || ''}` } : { tool: 'benchmark', label: 'Benchmarking' }),
      note: 'Um administrador responde aqui mesmo (é a mesma conversa do botão Mensagens do portal). A mensagem leva o benchmarking da sua empresa.',
      welcome: 'Dúvida sobre como preencher um lote, um erro que não entende ou uma pergunta do questionário? Escreva aqui: a equipe Probeef responde por esta conversa.',
    });
  }
  if (user.impersonatedBy) {
    document.getElementById('impersonation-text').textContent = `Você (${user.impersonatedBy.name}) está vendo o benchmarking como ${user.name}. Nada é salvo.`;
    document.getElementById('impersonation').hidden = false;
  }
  const info = await api('/api/benchmark/clients');
  Object.assign(state, { clients: info.clients, isAdmin: info.isAdmin, isValidator: info.isValidator, ano: info.ano, prazo: info.prazo });
  // Quem valida tem a aba Clientes: o andamento de todos e o atalho para validar cada um.
  document.querySelector('[data-tab="clientes"]').hidden = !info.isValidator;
  document.getElementById('bmk-title').textContent = `Benchmarking Confinamento ${info.ano}`;
  document.title = `Benchmarking ${info.ano}`;
  if (!info.clients.length) {
    fill(document.getElementById('status'), h('div', { class: 'bmk-blank' }, h('h3', {}, 'Nenhum cliente no benchmarking'), h('p', { class: 'muted' }, info.isAdmin ? 'Marque "Participa do Benchmarking" no cadastro dos clientes (Admin → Clientes).' : 'A sua empresa ainda não está no benchmarking. Fale com o seu coordenador Cargill.')));
    document.querySelectorAll('.tabs, [data-panel]').forEach((el) => (el.hidden = true));
    return;
  }
  const select = document.getElementById('client-select');
  fill(select, info.clients.map((c) => h('option', { value: c.id }, c.name)));
  document.getElementById('client-field').hidden = info.clients.length < 2;
  const params = new URLSearchParams(location.search);
  let saved = null;
  try {
    saved = localStorage.getItem('bi-probeef:bmk-cliente');
  } catch {
    saved = null;
  }
  const first = [params.get('cliente'), saved].find((id) => info.clients.some((c) => c.id === id)) || info.clients[0].id;
  select.value = first;
  select.onchange = () => loadClient(select.value).catch((err) => toast(err.message, 'error'));
  document.querySelectorAll('[data-tab]').forEach((t) => (t.onclick = () => selectTab(t.dataset.tab)));
  const tabs = ['engorda', 'recria', 'questionario', 'resultado', 'historico', ...(info.isValidator ? ['clientes'] : [])];
  state.tab = tabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : info.isValidator && !params.get('cliente') ? 'clientes' : 'engorda';
  await loadClient(first);
  selectTab(state.tab);
  openUsage();
}

// ---------- Tempo de uso (Admin → Benchmarking → Métricas do processo) ----------
// Igual ao portal: um batimento por minuto com a página visível. O batimento leva a aba aberta
// (o tempo vai para Lotes, Questionário, Resultado…) e a contagem recomeça ao trocar de cliente.

const usage = { viewId: null, started: false };
const postUsage = (path, body) => fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
const beat = (extra = {}) => usage.viewId && postUsage('/api/usage/beat', { viewId: usage.viewId, page: state.tab, ...extra });

async function openUsage() {
  usage.started = true;
  if (usage.viewId) postUsage('/api/usage/end', { viewId: usage.viewId, page: state.tab });
  usage.viewId = null;
  try {
    const d = await api('/api/benchmark/open', { method: 'POST', body: { clientId: state.clientId } });
    usage.viewId = d.viewId;
    beat();
  } catch {
    // Sem medição de uso: a ferramenta funciona igual.
  }
}

setInterval(() => document.visibilityState === 'visible' && beat(), 60 * 1000);
document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? beat() : beat({ resume: true })));
window.addEventListener('pagehide', () => usage.viewId && postUsage('/api/usage/end', { viewId: usage.viewId, page: state.tab }));

init().catch((err) => toast(err.message, 'error'));

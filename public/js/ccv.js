// Painel nativo da Ferramenta CCV (leitura de cocho), desenhado no portal com os dados do modelo
// semântico (rotas /api/ccv, ver src/routes/ccv.js). Substitui o relatório incorporado do Power BI
// para este tipo de relatório: o servidor só devolve as fazendas liberadas para quem está logado.
import { api, h, toast } from './common.js';

const FAROL = ['Crítico', 'Alerta', 'Observação', 'Normal'];
const IBC_REFERENCIA = 9; // linha tracejada do gráfico "IBC por dia" (o relatório usa a mesma referência)
const FARM_KEY = 'bi-probeef:ccv-fazenda';

const fmtInt = (v) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('pt-BR'));
const fmtDec = (v, d = 2) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtPct = (v, d = 0) => (v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: d })}%`);
const fmtDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sem armazenamento local: só não lembra a fazenda.
  }
}

function recall(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// ---------- Dica flutuante (hover) ----------

let tip = null;
function showTip(event, lines) {
  tip ??= document.body.appendChild(h('div', { class: 'ccv-tip', role: 'tooltip' }));
  tip.replaceChildren(...lines.map((l, i) => h(i ? 'span' : 'strong', {}, l)));
  tip.hidden = false;
  const x = Math.min(event.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
  const y = Math.min(event.clientY + 14, window.innerHeight - tip.offsetHeight - 8);
  tip.style.transform = `translate(${x}px, ${y}px)`;
}
function hideTip() {
  if (tip) tip.hidden = true;
}

// Variação contra o período anterior de mesmo tamanho: seta, sinal e se subir é bom ou ruim.
function delta(value, { unit = '', upIsGood = true, digits = 1, pct = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const shown = pct ? value * 100 : value;
  const rounded = Number(shown.toFixed(digits));
  const dir = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  const good = dir === 'flat' ? 'flat' : (dir === 'up') === upIsGood ? 'good' : 'bad';
  const arrow = { up: '↗', down: '↘', flat: '→' }[dir];
  const text = `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('pt-BR', { maximumFractionDigits: digits })}${pct ? '%' : unit}`;
  return h('span', { class: `ccv-delta ${good}`, title: 'Comparado ao período anterior de mesmo tamanho' }, `${arrow} ${text}`);
}

function meter(fraction, kind) {
  const width = Math.max(0, Math.min(1, fraction || 0)) * 100;
  return h('span', { class: `ccv-meter ${kind}`, 'aria-hidden': 'true' }, h('span', { style: `width:${width}%` }));
}

const statusClass = (status) => ({ 'Crítico': 'crit', 'Atenção': 'warn', 'Não conforme': 'warn', 'Conforme': 'ok' })[status] || 'neutral';

// ---------- Painel ----------

export function mountCcv(root, { report, clientId, farm: wantedFarm, onUsage }) {
  const state = { farms: [], filters: null, data: null, chart: null, seq: 0, expanded: new Set() };
  const query = (extra = {}) => {
    const params = new URLSearchParams();
    if (clientId) params.set('client', clientId);
    for (const [k, v] of Object.entries({ ...state.filters, ...extra })) if (v) params.set(k, v);
    return params.toString();
  };
  const base = `/api/ccv/${encodeURIComponent(report.id)}`;

  function message(title, text, action) {
    root.replaceChildren(h('div', { class: 'ccv-message' }, title ? h('h2', {}, title) : null, text ? h('p', {}, text) : null, action || null));
  }

  async function start() {
    message(null, 'Carregando o painel…');
    root.querySelector('.ccv-message')?.prepend(h('div', { class: 'spinner', 'aria-hidden': 'true' }));
    try {
      const { farms, viewId } = await api(`${base}/farms?${new URLSearchParams({ ...(clientId ? { client: clientId } : {}), open: '1' })}`);
      state.farms = farms;
      onUsage?.(viewId);
      const pick = farms.find((f) => f.name === wantedFarm) || farms.find((f) => f.name === recall(`${FARM_KEY}:${report.id}`)) || farms[0];
      setFarm(pick);
    } catch (err) {
      message('Não foi possível abrir o painel', err.message, h('button', { class: 'btn', type: 'button', onclick: start }, 'Tentar de novo'));
    }
  }

  // Trocar de fazenda volta curral e lote para "Todos" e o período para as últimas 4 semanas com dados.
  function setFarm(farm) {
    const to = farm.last || new Date().toISOString().slice(0, 10);
    state.filters = { farm: farm.name, from: addDays(to, -27), to, curral: '', lote: '' };
    remember(`${FARM_KEY}:${report.id}`, farm.name);
    load();
  }

  async function load() {
    const seq = ++state.seq;
    root.classList.add('ccv-loading');
    if (!state.data) message(null, 'Buscando os dados…');
    try {
      const data = await api(`${base}/painel?${query()}`);
      if (seq !== state.seq) return;
      state.data = data;
      state.expanded.clear();
      render();
    } catch (err) {
      if (seq !== state.seq) return;
      if (state.data) toast(err.message, 'error');
      else message('Não foi possível carregar os dados', err.message, h('button', { class: 'btn', type: 'button', onclick: load }, 'Tentar de novo'));
    } finally {
      if (seq === state.seq) root.classList.remove('ccv-loading');
    }
  }

  function setFilters(changes) {
    Object.assign(state.filters, changes);
    load();
  }

  // ---------- Filtros ----------

  function select(label, value, options, onChange, { all = 'Todos' } = {}) {
    const el = h(
      'select',
      { 'aria-label': label, onchange: () => onChange(el.value) },
      all ? h('option', { value: '' }, all) : null,
      options.map((o) => h('option', { value: o.value ?? o, selected: (o.value ?? o) === value }, o.label ?? o)),
    );
    return h('label', { class: 'ccv-filter' }, h('span', { class: 'label' }, label), el);
  }

  function filtersBar() {
    const f = state.filters;
    const farm = state.farms.find((x) => x.name === f.farm);
    const { currais, lotes } = state.data.opcoes;
    const farmSelect =
      state.farms.length > 1
        ? select('Fazenda', f.farm, state.farms.map((x) => x.name), (name) => setFarm(state.farms.find((x) => x.name === name)), { all: null })
        : h('div', { class: 'ccv-filter' }, h('span', { class: 'label' }, 'Fazenda'), h('strong', { class: 'ccv-farm-name' }, f.farm));
    const from = h('input', { type: 'date', value: f.from, min: farm?.first || undefined, max: f.to, 'aria-label': 'Data inicial', onchange: () => from.value && setFilters({ from: from.value }) });
    const to = h('input', { type: 'date', value: f.to, min: f.from, max: farm?.last || undefined, 'aria-label': 'Data final', onchange: () => to.value && setFilters({ to: to.value }) });
    const span = daysBetween(f.from, f.to) + 1;
    const presets = [7, 14, 28, 60].map((n) =>
      h(
        'button',
        { class: `chip${span === n && f.to === farm?.last ? ' on' : ''}`, type: 'button', onclick: () => setFilters({ to: farm?.last || f.to, from: addDays(farm?.last || f.to, -(n - 1)) }) },
        `${n} dias`,
      ),
    );
    return h(
      'div',
      { class: 'ccv-filters' },
      farmSelect,
      select('Curral', f.curral, currais, (v) => setFilters({ curral: v })),
      select('Lote', f.lote, lotes, (v) => setFilters({ lote: v })),
      h('div', { class: 'ccv-filter ccv-period' }, h('span', { class: 'label' }, 'Período'), h('div', { class: 'ccv-dates' }, from, h('span', { class: 'muted' }, 'a'), to), h('div', { class: 'ccv-presets' }, presets)),
    );
  }

  // ---------- Cartões ----------

  function kpis() {
    const c = state.data.cards;
    const tile = (label, value, extra = [], { hero = false } = {}) => h('article', { class: `ccv-kpi${hero ? ' hero' : ''}` }, h('span', { class: 'ccv-kpi-label' }, label), h('strong', { class: 'ccv-kpi-value' }, value), ...extra);
    return h(
      'div',
      { class: 'ccv-kpis' },
      tile('Rebanho médio', fmtInt(c.rebanho), [h('span', { class: 'muted' }, 'cabeças por dia no período')]),
      tile('IBC médio do período', fmtDec(c.ibc), [
        delta(c.ibcVar, { unit: ' pts', digits: 1 }),
        meter((c.ibc || 0) / 10, (c.ibc || 0) >= (c.metaIbc || 9.5) ? 'ok' : (c.ibc || 0) >= IBC_REFERENCIA ? 'warn' : 'crit'),
        h('span', { class: 'muted' }, `Meta ${fmtDec(c.metaIbc ?? 9.5, 1)}`),
      ]),
      tile('Inconsistências de ajuste', fmtInt(c.inconsistencias), [
        delta(c.inconsistenciasVar, { pct: true, digits: 0, upIsGood: false }),
        h('span', { class: 'ccv-chips' }, h('span', { class: 'ccv-chip warn' }, `${fmtInt(c.alertas)} alertas`), h('span', { class: 'ccv-chip crit' }, `${fmtInt(c.criticas)} críticas`)),
      ]),
      tile('Conformidade de leituras', fmtPct(c.conformidade), [
        delta(c.conformidadeVar, { unit: ' pts', digits: 1 }),
        meter(c.conformidade, (c.conformidade || 0) >= 0.5 ? 'ok' : (c.conformidade || 0) >= 0.3 ? 'warn' : 'crit'),
      ]),
    );
  }

  // ---------- Inconsistência de ajuste (barras 100% por lote) ----------

  function inconsistencia() {
    const list = state.data.inconsistencia;
    const rows = list.map((item) => {
      const segments = FAROL.filter((k) => item[k]).map((k) => {
        const share = item[k] / item.total;
        const label = `${(share * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
        return h(
          'span',
          {
            class: `ccv-seg farol-${FAROL.indexOf(k)}`,
            style: `flex-grow:${item[k]}`,
            onmousemove: (e) => showTip(e, [`Lote ${item.lote} · ${k}`, `${item[k]} de ${item.total} leituras (${label})`]),
            onmouseleave: hideTip,
          },
          share >= 0.12 ? label : '',
        );
      });
      return h(
        'button',
        {
          class: `ccv-bar-row${state.filters.lote === item.lote ? ' on' : ''}`,
          type: 'button',
          title: state.filters.lote === item.lote ? 'Mostrar todos os lotes' : `Filtrar o painel pelo lote ${item.lote}`,
          onclick: () => setFilters({ lote: state.filters.lote === item.lote ? '' : item.lote }),
        },
        h('span', { class: 'ccv-bar-label' }, item.lote),
        h('span', { class: 'ccv-bar' }, segments),
      );
    });
    return card(
      'Inconsistência de ajuste',
      'Distribuição das leituras de cada lote ativo por farol, no período. Clique num lote para filtrar.',
      [
        legend(FAROL.map((k, i) => ({ label: k, cls: `farol-${i}` }))),
        list.length ? h('div', { class: 'ccv-bars' }, rows) : empty('Nenhuma leitura avaliada no período.'),
        list.length ? h('div', { class: 'ccv-axis', 'aria-hidden': 'true' }, ['0%', '25%', '50%', '75%', '100%'].map((t) => h('span', {}, t))) : null,
      ],
      'ccv-incons',
    );
  }

  // ---------- IBC por dia da semana ----------

  function ibcCard() {
    const c = state.data.cards;
    const canvas = h('canvas', { role: 'img', 'aria-label': 'IBC médio por dia da semana, com a última semana em linha' });
    const table = h(
      'table',
      { class: 'ccv-sr' },
      h('caption', {}, 'IBC por dia da semana'),
      h('tr', {}, h('th', {}, 'Dia'), h('th', {}, 'Média do período'), h('th', {}, 'Última semana')),
      state.data.ibcDia.map((d) => h('tr', {}, h('td', {}, d.dia), h('td', {}, fmtDec(d.media)), h('td', {}, fmtDec(d.ultimaSemana)))),
    );
    const el = card(
      'IBC por dia',
      'Média do período em barras; a última semana em linha.',
      [
        legend([
          { label: 'Média IBC', cls: 'ibc-bar' },
          { label: 'Última semana', cls: 'ibc-line' },
          { label: `Referência ${fmtDec(IBC_REFERENCIA, 0)}`, cls: 'ibc-ref' },
        ]),
        h('div', { class: 'ccv-chart' }, canvas),
        table,
        h('div', { class: 'ccv-ibc-foot' }, h('strong', {}, fmtInt(c.curraisAbaixo)), c.curraisAbaixoTexto ? h('span', { class: 'ccv-chip warn' }, c.curraisAbaixoTexto) : null),
      ],
      'ccv-ibc',
    );
    requestAnimationFrame(() => drawIbc(canvas));
    return el;
  }

  function drawIbc(canvas) {
    state.chart?.destroy();
    state.chart = null;
    if (!window.Chart || !canvas.isConnected) return;
    const dias = state.data.ibcDia;
    const ink = cssVar('--ink');
    const muted = cssVar('--muted');
    const line = cssVar('--line');
    const surface = cssVar('--surface');
    const bar = cssVar('--chart-bar');
    const values = dias.flatMap((d) => [d.media, d.ultimaSemana]).filter((v) => v !== null);
    const min = Math.max(0, Math.floor(Math.min(IBC_REFERENCIA, ...values) - 1));
    const reference = {
      id: 'referencia',
      afterDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        const y = scales.y.getPixelForValue(IBC_REFERENCIA);
        ctx.save();
        ctx.strokeStyle = muted;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left, y);
        ctx.lineTo(chartArea.right, y);
        ctx.stroke();
        ctx.restore();
      },
    };
    state.chart = new window.Chart(canvas, {
      data: {
        labels: dias.map((d) => d.dia),
        datasets: [
          {
            type: 'line',
            label: 'Última semana',
            data: dias.map((d) => d.ultimaSemana),
            borderColor: ink,
            backgroundColor: ink,
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBorderColor: surface,
            pointBorderWidth: 2,
            tension: 0,
            order: 0,
          },
          { type: 'bar', label: 'Média IBC', data: dias.map((d) => d.media), backgroundColor: bar, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 24, order: 1 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 8 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtDec(ctx.parsed.y)}` } },
        },
        scales: {
          x: { grid: { display: false }, border: { color: line }, ticks: { color: muted } },
          y: { min, max: 10, grid: { color: line }, border: { display: false }, ticks: { color: muted, stepSize: 1, callback: (v) => fmtDec(v, 0) } },
        },
      },
      plugins: [reference],
    });
  }

  // ---------- Conformidade de leitura (matriz por dia, com currais ao expandir) ----------

  function conformidadeCard() {
    const c = state.data.cards;
    const tile = (label, value, cls) => h('div', { class: `ccv-status ${cls}` }, h('span', { class: 'ccv-status-label' }, label), h('strong', {}, value === null || value === undefined ? '—' : fmtInt(value)), h('span', { class: 'muted' }, 'lotes'));
    const body = h('tbody');
    const head = h('thead', {}, h('tr', {}, ['Dia', 'Faixa de sobra', 'Leitura', 'Decisão', 'Status'].map((t) => h('th', { scope: 'col' }, t))));
    const statusPill = (s) => (s ? h('span', { class: `ccv-pill ${statusClass(s)}` }, s) : '');

    async function toggle(day, row, button) {
      const open = state.expanded.has(day.dia);
      body.querySelectorAll(`tr[data-parent="${day.dia}"]`).forEach((r) => r.remove());
      if (open) {
        state.expanded.delete(day.dia);
        button.textContent = '+';
        button.setAttribute('aria-expanded', 'false');
        return;
      }
      state.expanded.add(day.dia);
      button.textContent = '–';
      button.setAttribute('aria-expanded', 'true');
      const loading = h('tr', { class: 'ccv-sub', 'data-parent': day.dia }, h('td', { colspan: 5, class: 'muted' }, 'Carregando currais…'));
      row.after(loading);
      try {
        const { currais } = await api(`${base}/dia?${query({ dia: day.dia })}`);
        loading.replaceWith(
          ...(currais.length
            ? currais.map((c) =>
                h(
                  'tr',
                  { class: 'ccv-sub', 'data-parent': day.dia },
                  h('td', {}, h('strong', {}, c.curral), h('span', { class: 'sub' }, [c.lote && `Lote ${c.lote}`, c.diasCocho].filter(Boolean).join(' · '))),
                  h('td', { class: 'num' }, c.faixa),
                  h('td', {}, c.leitura),
                  h('td', {}, c.decisao),
                  h('td', {}, statusPill(c.status)),
                ),
              )
            : [h('tr', { class: 'ccv-sub', 'data-parent': day.dia }, h('td', { colspan: 5, class: 'muted' }, 'Sem currais neste dia.'))]),
        );
      } catch (err) {
        loading.replaceWith(h('tr', { class: 'ccv-sub', 'data-parent': day.dia }, h('td', { colspan: 5, class: 'muted' }, err.message)));
      }
    }

    for (const day of state.data.conformidade) {
      const button = h('button', { class: 'ccv-expand', type: 'button', 'aria-expanded': 'false', 'aria-label': `Ver currais de ${fmtDay(day.dia)}` }, '+');
      const row = h('tr', {}, h('td', {}, h('span', { class: 'ccv-day' }, button, fmtDay(day.dia))), h('td', { class: 'num' }, day.faixa), h('td', {}, day.leitura), h('td', { class: 'num' }, day.decisao), h('td', {}, statusPill(day.status)));
      button.onclick = () => toggle(day, row, button);
      body.append(row);
    }
    return card(
      'Conformidade de leitura',
      'Status por dia: leituras esperadas contra as realizadas. Use + para ver os currais.',
      [
        h('div', { class: 'ccv-statuses' }, tile('Conforme', c.lotesConforme, 'ok'), tile('Atenção', c.lotesAtencao, 'warn'), tile('Não conforme', c.lotesNaoConforme, 'crit')),
        state.data.conformidade.length ? h('div', { class: 'ccv-table-wrap' }, h('table', { class: 'ccv-table' }, head, body)) : empty('Nenhuma leitura de sobra no período.'),
      ],
      'ccv-conf',
    );
  }

  // ---------- Alerta prioritário ----------

  function alertasCard() {
    const list = state.data.alertas;
    const nivel = (n) => (n >= 4 ? 'Agir' : n === 3 ? 'Monit.' : 'Observar');
    const ago = (iso) => {
      if (!iso) return '';
      const n = daysBetween(iso, state.filters.to);
      return n <= 0 ? 'no último dia' : n === 1 ? 'há 1 dia' : `há ${n} dias`;
    };
    return h(
      'section',
      { class: 'ccv-card ccv-alerts' },
      h('header', { class: 'ccv-card-head' }, h('h3', {}, '⚠ Alerta prioritário'), h('p', {}, 'Lotes ativos com maior proporção de leituras críticas no período.')),
      list.length
        ? h(
            'ol',
            { class: 'ccv-alert-list' },
            list.map((a, i) =>
              h(
                'li',
                {},
                h(
                  'button',
                  { type: 'button', title: `Filtrar o painel pelo lote ${a.lote}`, onclick: () => setFilters({ lote: a.lote }) },
                  h('span', { class: 'ccv-rank' }, i + 1),
                  h('span', { class: 'ccv-alert-main' }, h('strong', {}, `Lote ${a.lote}`), h('span', {}, [a.curral, a.ibc !== null ? `IBC ${fmtDec(a.ibc, 1)}` : null, `${a.criticas} ${a.criticas === 1 ? 'crítica' : 'críticas'}`].filter(Boolean).join(' · '))),
                  h('span', { class: 'ccv-alert-side' }, h('strong', {}, nivel(a.nivel).toUpperCase()), h('span', {}, ago(a.ultimaCritica))),
                ),
              ),
            ),
          )
        : h('p', { class: 'ccv-alerts-empty' }, 'Nenhum lote ativo com leitura crítica no período. 🎉'),
    );
  }

  // ---------- Peças comuns ----------

  function card(title, subtitle, children, cls = '') {
    return h('section', { class: `ccv-card ${cls}` }, h('header', { class: 'ccv-card-head' }, h('h3', {}, title), subtitle ? h('p', {}, subtitle) : null), ...children);
  }

  function legend(items) {
    return h('ul', { class: 'ccv-legend' }, items.map((i) => h('li', {}, h('span', { class: `ccv-key ${i.cls}`, 'aria-hidden': 'true' }), i.label)));
  }

  function empty(text) {
    return h('p', { class: 'muted ccv-empty' }, text);
  }

  function render() {
    const d = state.data;
    const last = d.cards.ultimaLeitura ? new Date(d.cards.ultimaLeitura) : null;
    root.replaceChildren(
      h(
        'div',
        { class: 'ccv' },
        filtersBar(),
        kpis(),
        h('div', { class: 'ccv-row' }, inconsistencia(), ibcCard()),
        h('div', { class: 'ccv-row ccv-row-b' }, conformidadeCard(), alertasCard()),
        h(
          'p',
          { class: 'muted ccv-foot' },
          `${d.filters.farm} · ${fmtDay(d.filters.from)} a ${fmtDay(d.filters.to)}`,
          last ? ` · última leitura no período: ${last.toLocaleDateString('pt-BR')} às ${last.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '',
          ` · variações comparadas aos ${daysBetween(d.filters.from, d.filters.to) + 1} dias anteriores`,
        ),
      ),
    );
  }

  // Tema claro/escuro mudou: redesenha o gráfico com as cores novas.
  const themeWatch = new MutationObserver(() => {
    const canvas = root.querySelector('.ccv-ibc canvas');
    if (canvas && state.data) drawIbc(canvas);
  });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  start();

  return {
    reload: () => (state.data ? load() : start()),
    farm: () => state.filters?.farm || null,
    destroy() {
      state.seq += 1;
      themeWatch.disconnect();
      state.chart?.destroy();
      hideTip();
      root.replaceChildren();
    },
  };
}

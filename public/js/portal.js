import { initAssistant } from './assistant.js';
import { mountCcv } from './ccv.js';
import { initChat } from './chat.js';
import { initTicker } from './ticker.js';
import { initNps } from './nps.js';
import { setupViews } from './views.js';
import { api, h, loadConfig, logout, openPasswordDialog, setupMenu, toast } from './common.js';

const { models } = window['powerbi-client'];
const service = window.powerbi;

const els = {
  list: document.getElementById('report-list'),
  count: document.getElementById('report-count'),
  search: document.getElementById('search'),
  head: document.getElementById('viewer-head'),
  title: document.getElementById('report-title'),
  description: document.getElementById('report-description'),
  updated: document.getElementById('report-updated'),
  asClient: document.getElementById('as-client'),
  embed: document.getElementById('embed'),
  state: document.getElementById('state'),
  sidebar: document.getElementById('sidebar'),
  navToggle: document.getElementById('nav-toggle'),
  clientSwitch: document.getElementById('client-switch'),
  clientField: document.getElementById('client-field'),
  clientName: document.getElementById('client-name'),
  exportButton: document.getElementById('export-button'),
  exportStatus: document.getElementById('export-status'),
  home: document.getElementById('home'),
  homeGroups: document.getElementById('home-groups'),
  homeClient: document.getElementById('home-client'),
  homeLink: document.getElementById('home-link'),
  embedWrap: document.getElementById('embed-wrap'),
  favButton: document.getElementById('fav-button'),
  viewsButton: document.getElementById('views-button'),
  ccvRoot: document.getElementById('ccv-root'),
};

let me;
const toolStatus = {}; // por ferramenta: none | pending | approved | denied (admin sempre "approved")
let reports = [];
let clients = [];
let views = []; // visões salvas da pessoa (sem os filtros, que vêm só ao aplicar)
let currentViewId = null;
let activeClient = null; // cliente selecionado (só para usuários de cliente)
let current = null;
let embedded = null;
let ccv = null; // painel nativo da Ferramenta CCV aberto (em vez do relatório incorporado)
let refreshTimer = null;
let loadSeq = 0;
let portalName = document.title;

function showState(title, text, { spinner = false, action } = {}) {
  els.state.replaceChildren(...[spinner ? h('div', { class: 'spinner', 'aria-hidden': 'true' }) : null, title ? h('h2', {}, title) : null, text ? h('p', {}, text) : null, action].filter(Boolean));
  els.state.hidden = false;
}

const CLIENT_KEY = 'bi-probeef:cliente';

// Relatórios do cliente selecionado (admin vê todos).
function clientReports() {
  return activeClient ? reports.filter((r) => r.clientIds.includes(activeClient)) : reports;
}

function setActiveClient(id, { remember = true } = {}) {
  activeClient = id;
  els.clientSwitch.value = id || '';
  els.clientName.textContent = clients.find((c) => c.id === id)?.name || '';
  if (remember) {
    try {
      localStorage.setItem(CLIENT_KEY, id);
    } catch {
      // Sem armazenamento local (janela anônima, por exemplo): só não lembra a escolha.
    }
  }
}

function savedClient() {
  try {
    const id = localStorage.getItem(CLIENT_KEY);
    return clients.some((c) => c.id === id) ? id : null;
  } catch {
    return null;
  }
}

// Imagem do relatório, ou um quadro com o símbolo da marca quando não há imagem.
function thumb(report, className) {
  return report.imageUrl
    ? h('span', { class: className }, h('img', { src: report.imageUrl, alt: '', loading: 'lazy', decoding: 'async' }))
    : h('span', { class: `${className} placeholder`, 'aria-hidden': 'true' });
}

function groupByCategory(list) {
  const groups = new Map();
  for (const r of list) {
    const key = r.category || 'Geral';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR')).map(([category, items]) => [category, items.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))]);
}

// Seções da lista: favoritos primeiro, depois as categorias (sem repetir os favoritos).
function sections(list) {
  const favorites = list.filter((r) => r.favorite).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const rest = groupByCategory(list.filter((r) => !r.favorite)).map(([category, items]) => ({ title: category, items, description: items[0].categoryDescription }));
  return favorites.length ? [{ title: '★ Favoritos', items: favorites, favorites: true }, ...rest] : rest;
}

// Visões salvas que valem para o cliente selecionado.
function clientViews() {
  const ids = new Set(clientReports().map((r) => r.id));
  return views.filter((v) => ids.has(v.reportId) && (!v.clientId || !activeClient || v.clientId === activeClient));
}

function starButton(report) {
  return h(
    'button',
    {
      class: `fav-star${report.favorite ? ' on' : ''}`,
      type: 'button',
      'aria-pressed': String(Boolean(report.favorite)),
      'aria-label': report.favorite ? `Remover ${report.name} dos favoritos` : `Adicionar ${report.name} aos favoritos`,
      title: report.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos',
      onclick: () => toggleFavorite(report),
    },
    report.favorite ? '★' : '☆',
  );
}

function updateFavButton() {
  if (!current) return;
  els.favButton.textContent = current.favorite ? '★ Favorito' : '☆ Favoritar';
  els.favButton.setAttribute('aria-pressed', String(Boolean(current.favorite)));
  els.favButton.classList.toggle('on', Boolean(current.favorite));
  els.favButton.title = current.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos (aparece primeiro na lista)';
}

async function toggleFavorite(report) {
  const favorite = !report.favorite;
  const rerender = () => {
    renderList();
    if (!els.home.hidden) renderHome();
    updateFavButton();
  };
  report.favorite = favorite;
  rerender();
  try {
    await api(`/api/reports/${encodeURIComponent(report.id)}/favorite`, { method: 'PUT', body: { favorite } });
    toast(favorite ? `"${report.name}" está nos favoritos.` : `"${report.name}" saiu dos favoritos.`);
  } catch (err) {
    report.favorite = !favorite;
    rerender();
    toast(err.message, 'error');
  }
}

// Atalhos para as visões salvas na tela inicial.
function viewsSection() {
  const term = els.search.value.trim().toLowerCase();
  const byId = new Map(reports.map((r) => [r.id, r]));
  const list = clientViews()
    .filter((v) => !term || `${v.name} ${byId.get(v.reportId)?.name}`.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (!list.length) return null;
  return h(
    'section',
    { class: 'home-group' },
    h('h2', { class: 'label' }, `Minhas visões · ${list.length}`),
    h('p', { class: 'home-group-desc' }, 'Relatórios com os filtros que você salvou. Um clique abre do jeito que você deixou.'),
    h(
      'div',
      { class: 'view-chips' },
      list.map((v) => h('a', { class: 'view-chip', href: `#${v.reportId}/visao/${v.id}` }, h('strong', {}, v.name), h('span', {}, byId.get(v.reportId)?.name || ''))),
    ),
  );
}

function filteredReports() {
  const term = els.search.value.trim().toLowerCase();
  return clientReports().filter((r) => [r.name, r.category, r.description, r.categoryDescription].some((v) => (v || '').toLowerCase().includes(term)));
}

// ---------- Tela inicial ----------

// Ferramentas fora do Power BI: cada uma tem acesso por pedido e aprovação (admin sempre usa).
// id: rota da API (/api/<id>) e endereço da ferramenta (/<id>).
const TOOL_CARDS = [
  { id: 'confinamento', name: '4M Confinamento', description: 'Calculadora de risco e modelos de negócio para confinamento de bovinos.' },
  { id: 'pasto', name: '3P · Desempenho a Pasto', description: 'Projeção de peso, GMD e resultado econômico na recria a pasto com suplementação Probeef, comparando dois cenários.' },
];

// Card de uma ferramenta: pedir acesso, aguardar aprovação ou abrir.
async function requestTool(tool) {
  try {
    ({ status: toolStatus[tool.id] } = await api(`/api/${tool.id}/request`, { method: 'POST', body: {} }));
    toast('Pedido enviado. Você poderá usar a ferramenta assim que o administrador aprovar.');
  } catch (err) {
    toast(err.message, 'error');
  }
  renderHome();
}

function toolsSection() {
  // Usuário só do Benchmarking não vê as ferramentas da plataforma.
  if (me.bmkOnly) return null;
  return h(
    'section',
    { class: 'home-group' },
    h('h2', { class: 'label' }, 'Ferramentas'),
    h('div', { class: 'cards' }, TOOL_CARDS.map((t) => h('div', { class: 'card-wrap' }, toolCard(t)))),
  );
}

// Benchmarking: seção própria (não é ferramenta nem tem pedido de acesso). Aparece para o cliente
// participante e para o Time e os Canais Cargill com fazendas no benchmarking (o Time também sem
// fazenda, para cadastrar a primeira).
let benchmarkInfo = null;
function benchmarkSection() {
  const b = benchmarkInfo;
  if (!b || (!b.clients.length && !b.canCreateFarm)) return null;
  const n = b.clients.length;
  const desc =
    b.kind === 'cliente'
      ? 'Envie os dados dos lotes e o questionário, com validação na hora, e veja o seu resultado.'
      : b.isValidator
        ? `Acompanhe e valide a coleta de ${n} fazenda(s) da sua equipe.`
        : `Acompanhe a coleta de ${n} fazenda(s) da sua equipe${b.canCreateFarm ? ' e cadastre novas' : ''}.`;
  return h(
    'section',
    { class: 'home-group' },
    h('h2', { class: 'label' }, 'Benchmarking'),
    h(
      'div',
      { class: 'cards' },
      h(
        'div',
        { class: 'card-wrap' },
        h(
          'a',
          { class: 'card', href: '/benchmark' },
          h('span', { class: 'card-media placeholder', 'aria-hidden': 'true' }),
          h('span', { class: 'card-body' }, h('strong', {}, 'Benchmarking Confinamento'), h('span', {}, desc), h('span', { class: 'muted' }, `Ciclo ${b.ano} · coleta ${b.aberta ? 'aberta' : 'fechada'}`)),
        ),
      ),
    ),
  );
}

function toolCard(tool) {
  const status = me.role === 'admin' ? 'approved' : toolStatus[tool.id] || 'none';
  const media = h('span', { class: 'card-media placeholder', 'aria-hidden': 'true' });
  const title = h('strong', {}, tool.name);
  const desc = h('span', {}, tool.description);
  let body;
  if (status === 'approved') {
    body = h('a', { class: 'card', href: `/${tool.id}` }, media, h('span', { class: 'card-body' }, title, desc));
  } else if (status === 'pending') {
    body = h('div', { class: 'card', style: 'opacity:.75' }, media, h('span', { class: 'card-body' }, title, h('span', {}, 'Pedido enviado — aguardando aprovação do administrador.')));
  } else {
    body = h(
      'div',
      { class: 'card', style: 'opacity:.9' },
      media,
      h(
        'span',
        { class: 'card-body' },
        title,
        status === 'denied' ? h('span', {}, 'Seu último pedido não foi aprovado.') : desc,
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', style: 'margin-top:6px', onclick: () => requestTool(tool) }, status === 'denied' ? 'Pedir novamente' : 'Solicitar acesso'),
      ),
    );
  }
  return body;
}

function renderHome() {
  const list = filteredReports();
  els.homeClient.textContent = activeClient ? clients.find((c) => c.id === activeClient)?.name || '' : me?.role === 'admin' ? 'Administrador' : '';
  const groups = sections(list).map(({ title, items, description, favorites }) => ({
    favorites,
    el: h(
      'section',
      { class: 'home-group' },
      h('h2', { class: 'label' }, `${title} · ${items.length}`),
      description ? h('p', { class: 'home-group-desc' }, description) : null,
      h(
        'div',
        { class: 'cards' },
        items.map((r) =>
          h(
            'div',
            { class: 'card-wrap' },
            h(
              'a',
              { class: 'card', href: `#${r.id}` },
              thumb(r, 'card-media'),
              h(
                'span',
                { class: 'card-body' },
                h('strong', {}, r.name),
                // Descrição, ou a categoria quando ela acrescenta algo ao nome.
                r.description || r.name !== r.category ? h('span', {}, r.description || r.category) : null,
                r.freshness?.stale ? h('span', { class: 'card-stale' }, `Dados de ${new Date(r.freshness.dataDate).toLocaleDateString('pt-BR')}`) : null,
              ),
            ),
            starButton(r),
          ),
        ),
      ),
    ),
  }));
  // Favoritos primeiro, depois as visões salvas, depois as categorias.
  const favCount = groups[0]?.favorites ? 1 : 0;
  els.homeGroups.replaceChildren(
    ...[benchmarkSection()].filter(Boolean),
    toolsSection(),
    ...(list.length
      ? [...groups.slice(0, favCount).map((g) => g.el), viewsSection(), ...groups.slice(favCount).map((g) => g.el)].filter(Boolean)
      : // Quem não é de nenhum cliente usa só as ferramentas: não há relatório a esperar.
        els.search.value || clients.length || me.role === 'admin'
        ? [h('p', { class: 'muted' }, els.search.value ? 'Nenhum relatório encontrado.' : 'Ainda não há relatórios liberados.')]
        : []),
  );
}

// ---------- Tempo de uso ----------
// Um batimento por minuto enquanto o relatório está aberto e a aba visível. Ao sair do
// relatório (ou fechar a aba), avisa o fim. Só conta para clientes (o servidor ignora admins).

const usage = { viewId: null, page: null, timer: null };

function postUsage(path, body, { beacon = false } = {}) {
  const payload = JSON.stringify(body);
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon(path, new Blob([payload], { type: 'application/json' }));
    return;
  }
  fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
}

function startUsage(viewId) {
  stopUsage();
  if (!viewId) return;
  usage.viewId = viewId;
  usage.page = null;
  usage.timer = setInterval(() => {
    if (document.visibilityState === 'visible') postUsage('/api/usage/beat', { viewId, page: usage.page });
  }, 60 * 1000);
}

function stopUsage({ beacon = false } = {}) {
  if (!usage.viewId) return;
  clearInterval(usage.timer);
  postUsage('/api/usage/end', { viewId: usage.viewId, page: usage.page }, { beacon });
  usage.viewId = null;
}

document.addEventListener('visibilitychange', () => {
  if (!usage.viewId) return;
  // Oculta: registra até aqui. Visível de novo: retoma sem contar o tempo em que ficou oculta.
  if (document.visibilityState === 'hidden') postUsage('/api/usage/beat', { viewId: usage.viewId, page: usage.page }, { beacon: true });
  else postUsage('/api/usage/beat', { viewId: usage.viewId, page: usage.page, resume: true });
});
window.addEventListener('pagehide', () => stopUsage({ beacon: true }));

function closeCcv() {
  ccv?.destroy();
  ccv = null;
  els.ccvRoot.hidden = true;
}

function showHome() {
  stopUsage();
  loadSeq += 1;
  current = null;
  closeCcv();
  clearTimeout(refreshTimer);
  service.reset(els.embed);
  embedded = null;
  els.head.hidden = true;
  els.embedWrap.hidden = true;
  if (!exporting) els.exportStatus.hidden = true;
  els.home.hidden = false;
  els.homeLink.setAttribute('aria-current', 'page');
  document.title = portalName;
  renderList();
  renderHome();
}

function renderList() {
  const term = els.search.value.trim().toLowerCase();
  const available = clientReports();
  const filtered = filteredReports();
  els.count.textContent = `${available.length} ${available.length === 1 ? 'relatório' : 'relatórios'}`;

  if (!filtered.length) {
    els.list.replaceChildren(h('p', { class: 'muted', style: 'padding: 12px 10px; margin: 0' }, term ? 'Nenhum relatório encontrado.' : 'Nenhum relatório liberado.'));
    return;
  }

  els.list.replaceChildren(
    ...sections(filtered).map(({ title, items }) =>
      h(
        'div',
        { class: 'report-group' },
        h('p', { class: 'label' }, title),
        items.map((r) =>
          h(
            'button',
            {
              class: 'report-item',
              type: 'button',
              'aria-current': current?.id === r.id ? 'true' : 'false',
              onclick: () => {
                els.sidebar.classList.remove('open');
                els.navToggle.setAttribute('aria-expanded', 'false');
                if (current?.id !== r.id) location.hash = r.id;
              },
            },
            thumb(r, 'report-thumb'),
            h('span', { class: 'report-text' }, h('strong', {}, r.name), r.description ? h('span', {}, r.description) : null),
          ),
        ),
      ),
    ),
  );
}

function scheduleRefresh(expiration) {
  clearTimeout(refreshTimer);
  // Renova o token 5 minutos antes de expirar, sem recarregar o relatório.
  const ms = Math.max(new Date(expiration).getTime() - Date.now() - 5 * 60 * 1000, 30 * 1000);
  refreshTimer = setTimeout(async () => {
    if (!embedded || !current) return;
    try {
      const cfg = await fetchEmbed(current, { renewal: true });
      await embedded.setAccessToken(cfg.accessToken);
      scheduleRefresh(cfg.expiration);
    } catch (err) {
      toast(`Não foi possível renovar o acesso: ${err.message}`, 'error');
    }
  }, ms);
}

// renewal: renovação do token do relatório já aberto (não conta como novo acesso).
function fetchEmbed(report, { renewal = false } = {}) {
  const params = new URLSearchParams();
  if (report.rls && els.asClient.value) params.set('asClient', els.asClient.value);
  if (activeClient) params.set('client', activeClient);
  if (renewal) params.set('renewal', '1');
  const query = params.toString();
  return api(`/api/reports/${encodeURIComponent(report.id)}/embed${query ? `?${query}` : ''}`);
}

// Selo "Dados de …": usa a data dos dados verificada pelo portal; sem ela, a última atualização do Power BI.
function showLastRefresh(iso, { stale = false } = {}) {
  els.updated.hidden = !iso;
  if (!iso) return;
  const date = new Date(iso);
  const when = `${date.toLocaleDateString('pt-BR')} às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  els.updated.textContent = stale ? `Dados de ${when} · desatualizados` : `Dados atualizados em ${when}`;
  els.updated.className = `pill updated ${stale ? 'pill-warn' : 'pill-ok'}`;
  els.updated.title = stale ? 'Os dados deste relatório não são atualizados há algum tempo.' : date.toLocaleString('pt-BR');
}

// Painel CCV: desenhado pelo próprio portal (public/js/ccv.js), sem visões salvas nem PDF do Power BI.
function openCcv(report, farm) {
  service.reset(els.embed);
  embedded = null;
  els.embedWrap.hidden = true;
  els.ccvRoot.hidden = false;
  showLastRefresh(report.freshness?.dataDate || null, { stale: Boolean(report.freshness?.stale) });
  ccv = mountCcv(els.ccvRoot, {
    report,
    clientId: activeClient,
    farm,
    onUsage: (viewId) => {
      if (!viewId) return;
      startUsage(viewId);
      usage.page = 'Painel CCV';
    },
  });
}

async function open(report, { viewId = null, farm = null } = {}) {
  stopUsage();
  const seq = ++loadSeq;
  current = report;
  currentViewId = null;
  updateFavButton();
  clearTimeout(refreshTimer);
  closeCcv();
  const native = report.kind === 'ccv';
  els.viewsButton.parentElement.hidden = native;
  els.exportButton.parentElement.hidden = native;
  els.home.hidden = true;
  els.embedWrap.hidden = false;
  els.homeLink.removeAttribute('aria-current');
  renderList();
  els.head.hidden = false;
  els.title.textContent = report.name;
  els.description.textContent = report.description || report.categoryDescription || '';
  showLastRefresh(null);
  if (!exporting) els.exportStatus.hidden = true;
  els.asClient.hidden = !(me.role === 'admin' && report.rls);
  document.title = `${report.name} · ${portalName}`;
  if (native) {
    openCcv(report, farm);
    return;
  }

  service.reset(els.embed);
  embedded = null;
  showState(null, 'Carregando relatório…', { spinner: true });

  if (me.role === 'admin' && report.rls && !els.asClient.value) {
    showState('Escolha um cliente', 'Este relatório usa segurança por linha (RLS). Selecione acima como qual cliente você quer visualizar.');
    return;
  }

  try {
    // Abrindo por uma visão salva: busca os filtros junto com o acesso ao relatório.
    const viewRequest = viewId
      ? api(`/api/views/${encodeURIComponent(viewId)}`)
          .then((d) => d.view)
          .catch(() => null)
      : null;
    const [cfg, view] = await Promise.all([fetchEmbed(report), viewRequest]);
    if (seq !== loadSeq) return;
    if (viewId && !view) toast('Essa visão não existe mais. Abrindo o relatório sem ela.', 'error');
    if (view) currentViewId = view.id;
    if (report.freshness) showLastRefresh(report.freshness.dataDate, { stale: report.freshness.stale });
    else showLastRefresh(cfg.lastRefresh);
    const narrow = window.matchMedia('(max-width: 600px)').matches;
    embedded = service.embed(els.embed, {
      type: 'report',
      id: cfg.reportId,
      embedUrl: cfg.embedUrl,
      accessToken: cfg.accessToken,
      tokenType: models.TokenType.Embed,
      settings: {
        layoutType: narrow ? models.LayoutType.MobilePortrait : models.LayoutType.Master,
        panes: { filters: { visible: false, expanded: false }, pageNavigation: { visible: true } },
        // Mantém o fundo e as imagens de plano de fundo definidos no próprio relatório.
        background: models.BackgroundType.Default,
      },
      ...(view ? { bookmark: { state: view.state } } : {}),
    });
    let loaded = false;
    embedded.on('loaded', () => {
      loaded = true;
      if (seq === loadSeq) els.state.hidden = true;
    });
    if (cfg.viewId) {
      startUsage(cfg.viewId);
      const viewId = cfg.viewId;
      // Aba (página do relatório) aberta: ao carregar e a cada troca, para medir as abas mais vistas.
      const setPage = (page) => {
        if (!page || usage.viewId !== viewId || page === usage.page) return;
        usage.page = page;
        postUsage('/api/usage/beat', { viewId, page });
      };
      embedded.on('loaded', () => {
        embedded
          ?.getActivePage()
          .then((p) => setPage(p?.displayName || p?.name))
          .catch(() => {});
      });
      embedded.on('pageChanged', (event) => setPage(event?.detail?.newPage?.displayName || event?.detail?.newPage?.name));
    }
    embedded.on('error', (event) => {
      if (seq !== loadSeq) return;
      const info = event?.detail || {};
      const detail = info.detailedMessage || info.message || 'Erro ao exibir o relatório.';
      // Avisos (ex.: "layout móvel não encontrado, usando o padrão") não impedem o relatório de abrir.
      if (String(info.level).toLowerCase() === 'warning' || /^warning/i.test(detail)) return;
      // Erro depois de carregado (um visual que falhou, por exemplo): avisa sem esconder o relatório.
      if (loaded) {
        toast(detail, 'error');
        return;
      }
      showState('Não foi possível exibir o relatório', detail, {
        action: h('button', { class: 'btn', type: 'button', onclick: () => open(report) }, 'Tentar de novo'),
      });
    });
    scheduleRefresh(cfg.expiration);
  } catch (err) {
    if (seq !== loadSeq) return;
    showState('Não foi possível abrir o relatório', err.message, {
      action: h('button', { class: 'btn', type: 'button', onclick: () => open(report) }, 'Tentar de novo'),
    });
  }
}

// ---------- Exportar PDF ----------

let exporting = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function showExportStatus(text, kind = 'info', action = null) {
  els.exportStatus.className = `export-status ${kind}`;
  els.exportStatus.replaceChildren(h('span', {}, text), ...(action ? [action] : []));
  els.exportStatus.hidden = false;
}

async function exportPdf(scope) {
  if (exporting || !embedded || !current) return;
  const report = current;
  exporting = true;
  els.exportButton.disabled = true;
  showExportStatus('Preparando o PDF com os filtros que você aplicou…');
  try {
    // Leva os filtros e segmentações aplicados na tela para o PDF.
    let bookmarkState = null;
    try {
      const bookmark = await embedded.bookmarksManager.capture({ personalizeVisuals: true, allPagesSelected: scope === 'all' });
      bookmarkState = bookmark?.state || null;
    } catch {
      bookmarkState = null;
    }
    if (bookmarkState && bookmarkState.length > 85000) bookmarkState = null;
    const pageName = scope === 'page' ? (await embedded.getActivePage())?.name : null;

    const body = { pageName, bookmarkState };
    if (activeClient) body.client = activeClient;
    if (report.rls && els.asClient.value) body.asClient = els.asClient.value;
    const { exportId } = await api(`/api/reports/${encodeURIComponent(report.id)}/export`, { method: 'POST', body });

    const base = `/api/reports/${encodeURIComponent(report.id)}/export/${encodeURIComponent(exportId)}`;
    const started = Date.now();
    for (;;) {
      await pause(3000);
      const st = await api(base);
      if (st.status === 'Succeeded') break;
      if (st.status === 'Failed') throw new Error(st.error || 'O Power BI não conseguiu gerar o PDF.');
      if (Date.now() - started > 6 * 60 * 1000) throw new Error('O PDF está demorando demais. Tente exportar só a página atual.');
      showExportStatus(`Gerando o PDF de "${report.name}"… ${st.percentComplete ? `${st.percentComplete}%` : ''}`);
    }

    const link = h('a', { class: 'btn btn-sm btn-primary', href: `${base}/file` }, 'Baixar de novo');
    showExportStatus(`PDF de "${report.name}" pronto. O download começou.`, 'ok', link);
    // Dispara o download direto (o servidor responde como anexo, então a página não muda).
    const auto = h('a', { href: `${base}/file`, hidden: true });
    document.body.append(auto);
    auto.click();
    auto.remove();
  } catch (err) {
    showExportStatus(`Não foi possível gerar o PDF: ${err.message}`, 'error');
  } finally {
    exporting = false;
    els.exportButton.disabled = false;
  }
}

// Sem relatório no endereço (#inicio ou vazio): tela inicial com os cards.
// Endereço: #<relatório>, #<relatório>/visao/<visão salva> ou, no painel CCV, #<relatório>/fazenda/<nome>.
function openFromHash() {
  const [id, kind, extra] = location.hash.slice(1).split('/').map((part) => decodeURIComponent(part));
  const viewId = kind === 'visao' ? extra : null;
  const farm = kind === 'fazenda' ? extra : null;
  const linked = reports.find((r) => r.id === id);
  if (!linked) {
    showHome();
    return;
  }
  // Link para um relatório de outro cliente do usuário: troca para esse cliente.
  if (activeClient && !linked.clientIds.includes(activeClient)) setActiveClient(linked.clientIds[0]);
  // Tira a visão (ou a fazenda) do endereço, para que o mesmo atalho funcione de novo depois.
  if (viewId || farm) history.replaceState(null, '', `#${linked.id}`);
  open(linked, { viewId, farm });
}

// Trocar de cliente volta para a tela inicial com os relatórios dele.
function switchClient() {
  setActiveClient(els.clientSwitch.value);
  assistant?.clientChanged();
  els.search.value = '';
  if (location.hash === '#inicio') showHome();
  else location.hash = 'inicio';
}

async function init() {
  setupMenu(document.getElementById('menu-button'), document.getElementById('menu-list'));
  document.getElementById('logout').onclick = logout;
  document.getElementById('change-password').onclick = () => openPasswordDialog();
  document.getElementById('reload').onclick = () => {
    if (ccv) ccv.reload();
    else if (current) open(current);
  };
  setupMenu(els.exportButton, document.getElementById('export-menu'));
  document.querySelectorAll('[data-export]').forEach((b) => {
    b.onclick = () => {
      document.getElementById('export-menu').hidden = true;
      exportPdf(b.dataset.export);
    };
  });
  document.getElementById('fullscreen').onclick = () => {
    if (ccv) els.ccvRoot.requestFullscreen?.().catch(() => {});
    else embedded?.fullscreen();
  };
  els.favButton.onclick = () => current && toggleFavorite(current);
  setupViews({
    button: els.viewsButton,
    menu: document.getElementById('views-menu'),
    getState: () => ({ report: current, embedded, client: activeClient, views: clientViews(), currentViewId }),
    onChange: (next, viewId) => {
      views = next;
      currentViewId = viewId;
    },
  });
  els.search.addEventListener('input', () => {
    renderList();
    if (!els.home.hidden) renderHome();
  });
  els.homeLink.addEventListener('click', () => {
    els.sidebar.classList.remove('open');
    els.navToggle.setAttribute('aria-expanded', 'false');
  });
  els.navToggle.onclick = () => {
    const open = els.sidebar.classList.toggle('open');
    els.navToggle.setAttribute('aria-expanded', String(open));
  };
  window.addEventListener('hashchange', openFromHash);

  loadConfig()
    .then((cfg) => {
      portalName = cfg.portalName;
    })
    .catch(() => {});
  ({ user: me } = await api('/api/auth/me'));
  benchmarkInfo = await api('/api/benchmark/clients').catch(() => null);
  if (me.role !== 'admin') {
    await Promise.all(
      TOOL_CARDS.map((t) =>
        api(`/api/${t.id}/status`)
          .then((d) => (toolStatus[t.id] = d.status))
          .catch(() => (toolStatus[t.id] = 'none')),
      ),
    );
  }
  document.getElementById('user-name').textContent = me.name;
  els.clientName.textContent = me.role === 'admin' ? 'Administrador' : '';
  document.getElementById('admin-link').hidden = me.role !== 'admin';
  if (me.impersonatedBy) {
    // Admin vendo o portal como este usuário: avisa e não pede troca de senha.
    document.getElementById('impersonation-text').textContent = `Você (${me.impersonatedBy.name}) está vendo o portal como ${me.name}. Seus acessos não contam no uso do cliente.`;
    document.getElementById('impersonation').hidden = false;
    document.body.classList.add('impersonating');
    document.getElementById('change-password').hidden = true;
    document.getElementById('stop-impersonation').onclick = async () => {
      await api('/api/auth/stop-impersonation', { method: 'POST', body: {} }).catch(() => {});
      location.href = '/admin#users';
    };
  } else if (me.mustChangePassword) {
    openPasswordDialog({ required: true });
  }

  initTicker();

  // Mensagens com a equipe (só usuários de cliente; admin "entrando como" só lê).
  if (me.role === 'client') {
    initChat({
      button: document.getElementById('chat-button'),
      badge: document.getElementById('chat-badge'),
      readOnly: Boolean(me.impersonatedBy),
      getContext: () => {
        if (!current) return null;
        const farm = ccv?.farm() || null;
        return { reportId: current.id, farm, label: `${current.name}${farm ? ` · ${farm}` : ''}` };
      },
    });
  }

  if (me.role === 'admin') {
    const { clients } = await api('/api/admin/clients');
    els.asClient.replaceChildren(
      h('option', { value: '' }, 'Visualizar como…'),
      clients.map((c) => h('option', { value: c.id }, c.name)),
    );
    els.asClient.onchange = () => current && open(current);
  }

  ({ reports, clients, views = [] } = await api('/api/reports'));
  if (me.role !== 'admin' && clients.length) {
    els.clientSwitch.replaceChildren(...clients.map((c) => h('option', { value: c.id }, c.name)));
    els.clientField.hidden = clients.length < 2;
    els.clientSwitch.onchange = switchClient;
    setActiveClient(savedClient() || clients[0].id, { remember: false });
  }
  renderList();
  // Usuário sem cliente (só ferramentas): sem a lista de relatórios e com o título das ferramentas.
  if (me.role !== 'admin' && !clients.length && !reports.length) {
    document.querySelector('.portal').classList.add('tools-only');
    document.getElementById('home-title').textContent = me.bmkOnly ? 'Benchmarking' : 'Suas ferramentas';
    document.querySelector('#home .home-head .muted').textContent = me.bmkOnly ? 'Abra o Benchmarking para preencher e acompanhar a coleta.' : 'Escolha uma ferramenta para abrir.';
  }

  // Sem relatórios, a tela inicial ainda mostra as ferramentas (4M, 3P), que têm acesso próprio.
  if (!reports.length && me.role === 'admin') {
    showState('Nenhum relatório liberado', 'Cadastre relatórios na área de administração para vê-los aqui.', { action: h('a', { class: 'btn btn-primary', href: '/admin' }, 'Ir para administração') });
    return;
  }
  openFromHash();
  if (!reports.length) return;

  // Assistente: cada usuário conversa sobre os relatórios dele (e da fazenda selecionada).
  assistant = initAssistant({
    getContext: () => ({
      client: activeClient,
      clientName: clients.find((c) => c.id === activeClient)?.name || '',
      reportId: current?.id || null,
    }),
    onNavigate: (hash) => {
      if (location.hash.slice(1) === hash) openFromHash();
      else location.hash = hash;
    },
  });
  assistant.enableIfAvailable();
  // Pesquisa de satisfação (o servidor decide se é hora; nunca para admins).
  if (me.role !== 'admin' && !me.impersonatedBy) initNps(() => portalName);
  const settings = document.getElementById('assistant-settings');
  settings.hidden = Boolean(me.impersonatedBy);
  settings.onclick = () => {
    document.getElementById('menu-list').hidden = true;
    assistant.openKeySettings().catch((err) => toast(err.message, 'error'));
  };
}

let assistant = null;

init().catch((err) => showState('Algo deu errado', err.message));

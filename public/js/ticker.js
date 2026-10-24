// Faixa de cotações no rodapé do portal, rolando como nas TVs (dados de /api/quotes, ver
// src/quotes.js). Passar o mouse pausa; com "reduzir movimento" do sistema, fica parada e rola na mão.
import { api, h } from './common.js';

const REFRESH_MS = 5 * 60 * 1000;
const SPEED_PX_S = 55;

const fmt = (v, digits) => v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtDate = (iso) => (iso && iso.length === 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));

function valueText(q) {
  const n = fmt(q.value, q.digits ?? 2);
  if (q.unit === 'pts') return `${n} pts`;
  const [currency, per] = q.unit.split('/');
  return `${currency} ${n}${per ? `/${per}` : ''}`;
}

function item(q) {
  const pct = q.changePct;
  const dir = pct === null || pct === undefined || Math.abs(pct) < 0.005 ? 'flat' : pct > 0 ? 'up' : 'down';
  const arrow = { up: '▲', down: '▼', flat: '■' }[dir];
  const change = pct === null || pct === undefined ? 'sem variação' : `${pct > 0 ? '+' : ''}${fmt(pct, 2)}%`;
  const when = q.asOf ? fmtDate(q.asOf) : '';
  return h(
    'span',
    { class: 'ticker-item', title: [q.source, q.auto ? 'atualização automática' : 'valor lançado pela equipe', when && `em ${when}`].filter(Boolean).join(' · ') },
    h('strong', {}, q.label),
    h('span', { class: 'ticker-value' }, valueText(q)),
    h('span', { class: `ticker-change ${dir}`, 'aria-label': dir === 'up' ? `alta de ${change}` : dir === 'down' ? `queda de ${change}` : change }, `${arrow} ${change}`),
  );
}

export function initTicker() {
  const track = h('div', { class: 'ticker-track' });
  const bar = h('div', { class: 'ticker', role: 'region', 'aria-label': 'Cotações', hidden: true }, h('span', { class: 'ticker-tag' }, 'Cotações'), h('div', { class: 'ticker-window' }, track));
  document.body.append(bar);

  async function load() {
    let data;
    try {
      data = await api('/api/quotes');
    } catch {
      return; // sem cotações agora: mantém o que já está na tela
    }
    const show = data.enabled && data.items.length > 0;
    bar.hidden = !show;
    document.body.classList.toggle('has-ticker', show);
    if (!show) return;
    // Conteúdo duplicado: a animação anda metade da largura e recomeça sem emenda visível.
    const once = data.items.map(item);
    track.replaceChildren(...once, ...data.items.map(item).map((el) => (el.setAttribute('aria-hidden', 'true'), el)));
    requestAnimationFrame(() => {
      const half = track.scrollWidth / 2;
      track.style.setProperty('--ticker-duration', `${Math.max(20, half / SPEED_PX_S)}s`);
    });
  }

  load();
  setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
}

// Faixa de cotações do portal (rodapé, estilo TV). Duas origens:
// - automáticas: câmbio (AwesomeAPI) e bolsas americanas (Yahoo Finance, ~15 min de atraso);
// - lançadas pelo admin: preços brasileiros (indicadores CEPEA etc.), que saem uma vez por dia e
//   não têm fonte aberta que possamos ler automaticamente (o CEPEA bloqueia e os dados da B3 são
//   licenciados). O admin digita o valor do dia e o portal calcula a tendência.
// O navegador nunca chama essas fontes direto (CSP connectSrc 'self'): passa por /api/quotes.
import { db, newId, save } from './store.js';

const AUTO_TTL_MS = 5 * 60 * 1000;
const STALE_MS = 3 * 24 * 60 * 60 * 1000; // cotação automática sem atualizar há 3 dias some da faixa

// Cotações automáticas disponíveis (o admin liga e desliga cada uma).
export const AUTO_QUOTES = [
  { id: 'usd', label: 'Dólar', source: 'awesome', code: 'USD-BRL', unit: 'R$', digits: 3 },
  { id: 'eur', label: 'Euro', source: 'awesome', code: 'EUR-BRL', unit: 'R$', digits: 3 },
  { id: 'ibov', label: 'Ibovespa', source: 'yahoo', code: '^BVSP', unit: 'pts', digits: 0 },
  { id: 'soja-cbot', label: 'Soja Chicago', source: 'yahoo', code: 'ZS=F', unit: 'US$/bu', cents: true, digits: 2 },
  { id: 'milho-cbot', label: 'Milho Chicago', source: 'yahoo', code: 'ZC=F', unit: 'US$/bu', cents: true, digits: 2 },
  { id: 'boi-cme', label: 'Boi gordo CME', source: 'yahoo', code: 'LE=F', unit: 'US$/lb', cents: true, digits: 3 },
  { id: 'bezerro-cme', label: 'Bezerro CME', source: 'yahoo', code: 'GF=F', unit: 'US$/lb', cents: true, digits: 3 },
];

// Preços brasileiros sugeridos na primeira vez (o admin edita, apaga ou cria outros).
const DEFAULT_MANUAL = [
  { label: 'Boi gordo', unit: 'R$/@', source: 'CEPEA/B3 · SP' },
  { label: 'Bezerro (boi magro)', unit: 'R$/cab', source: 'CEPEA · MS' },
  { label: 'Soja', unit: 'R$/sc', source: 'CEPEA · Paranaguá' },
  { label: 'Milho', unit: 'R$/sc', source: 'CEPEA · Campinas' },
];

class QuoteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------- Configuração (fica no db.json) ----------

export function quoteSettings() {
  const data = db();
  if (!data.quotes) {
    data.quotes = {
      enabled: true,
      auto: Object.fromEntries(AUTO_QUOTES.map((q) => [q.id, true])),
      manual: DEFAULT_MANUAL.map((m) => ({ id: newId(), ...m, history: [] })),
    };
  }
  return data.quotes;
}

// ---------- Automáticas ----------

let autoCache = { at: 0, items: new Map() };
let refreshing = null;

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (BI Probeef)' }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchAwesome(list) {
  if (!list.length) return [];
  const data = await getJson(`https://economia.awesomeapi.com.br/json/last/${list.map((q) => q.code).join(',')}`);
  return list.map((q) => {
    const row = data[q.code.replace('-', '')];
    if (!row) return null;
    const value = Number(row.bid);
    const pct = Number(row.pctChange);
    return { id: q.id, value, changePct: Number.isFinite(pct) ? pct : null, asOf: new Date(Number(row.timestamp) * 1000).toISOString() };
  });
}

// Variação contra o fechamento do pregão anterior (as duas últimas barras diárias).
async function fetchYahoo(q) {
  const data = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(q.code)}?range=5d&interval=1d`);
  const result = data?.chart?.result?.[0];
  const price = result?.meta?.regularMarketPrice;
  if (!Number.isFinite(price)) return null;
  const closes = (result.indicators?.quote?.[0]?.close || []).filter(Number.isFinite);
  const previous = closes.length >= 2 ? closes.at(-2) : result.meta.chartPreviousClose;
  const scale = q.cents ? 0.01 : 1;
  return {
    id: q.id,
    value: price * scale,
    changePct: Number.isFinite(previous) && previous ? (price / previous - 1) * 100 : null,
    asOf: new Date(result.meta.regularMarketTime * 1000).toISOString(),
  };
}

async function refreshAuto() {
  const on = AUTO_QUOTES.filter((q) => quoteSettings().auto[q.id]);
  const jobs = [
    fetchAwesome(on.filter((q) => q.source === 'awesome')).catch((err) => {
      console.error('Cotações (câmbio) falharam:', err.message);
      return [];
    }),
    ...on
      .filter((q) => q.source === 'yahoo')
      .map((q) =>
        fetchYahoo(q).catch((err) => {
          console.error(`Cotação ${q.label} falhou:`, err.message);
          return null;
        }),
      ),
  ];
  const results = (await Promise.all(jobs)).flat().filter(Boolean);
  // Quem falhou agora fica com o último valor bom (até ficar velho demais).
  const items = new Map(autoCache.items);
  for (const r of results) items.set(r.id, r);
  autoCache = { at: Date.now(), items };
}

async function autoQuotes() {
  if (Date.now() - autoCache.at > AUTO_TTL_MS) {
    refreshing ??= refreshAuto().finally(() => (refreshing = null));
    // Primeira vez: espera; depois, responde com o que tem e atualiza em segundo plano.
    if (!autoCache.at) await refreshing;
  }
  const settings = quoteSettings();
  return AUTO_QUOTES.filter((q) => settings.auto[q.id])
    .map((q) => {
      const r = autoCache.items.get(q.id);
      if (!r || Date.now() - Date.parse(r.asOf) > STALE_MS) return null;
      const source = q.source === 'awesome' ? 'Câmbio comercial (AwesomeAPI)' : `Bolsa (${q.code}), com até 15 min de atraso`;
      return { id: q.id, label: q.label, unit: q.unit, digits: q.digits, value: r.value, changePct: r.changePct, asOf: r.asOf, source, auto: true };
    })
    .filter(Boolean);
}

// ---------- Lançadas pelo admin ----------

// Valor mais recente e variação contra o lançamento anterior (de outra data).
function manualView(m) {
  const [last, prev] = [...m.history].sort((a, b) => b.date.localeCompare(a.date));
  return {
    id: m.id,
    label: m.label,
    unit: m.unit,
    source: m.source,
    digits: 2,
    value: last?.value ?? null,
    previous: prev?.value ?? null,
    changePct: last && prev?.value ? (last.value / prev.value - 1) * 100 : null,
    asOf: last?.date || null,
    auto: false,
  };
}

export async function tickerQuotes() {
  const settings = quoteSettings();
  if (!settings.enabled) return { enabled: false, items: [] };
  const manual = settings.manual.map(manualView).filter((q) => q.value !== null);
  return { enabled: true, items: [...manual, ...(await autoQuotes())] };
}

// Tela do admin: tudo, inclusive itens ainda sem valor e o histórico recente.
export async function adminQuotes() {
  const settings = quoteSettings();
  return {
    enabled: settings.enabled,
    manual: settings.manual.map((m) => ({ ...manualView(m), history: [...m.history].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10) })),
    auto: AUTO_QUOTES.map((q) => ({ id: q.id, label: q.label, unit: q.unit, on: Boolean(settings.auto[q.id]), last: autoCache.items.get(q.id) || null })),
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v, max) => String(v ?? '').trim().slice(0, max);

function findManual(id) {
  const m = quoteSettings().manual.find((x) => x.id === id);
  if (!m) throw new QuoteError('Cotação não encontrada.', 404);
  return m;
}

export async function saveManual(id, body) {
  const fields = { label: text(body.label, 40), unit: text(body.unit, 20), source: text(body.source, 60) };
  if (!fields.label) throw new QuoteError('Informe o nome da cotação.');
  if (id) Object.assign(findManual(id), fields);
  else quoteSettings().manual.push({ id: newId(), ...fields, history: [] });
  await save();
}

export async function deleteManual(id) {
  findManual(id);
  const settings = quoteSettings();
  settings.manual = settings.manual.filter((m) => m.id !== id);
  await save();
}

// Lança (ou corrige) o valor de um dia. Um valor por data; guarda os últimos 60.
export async function setManualValue(id, { value, date }, admin) {
  const m = findManual(id);
  // Aceita "1.312,50", "312,50" e "2.910" (padrão brasileiro) e também "312.50".
  const raw = String(value ?? '').trim();
  const thousandsOnly = /^\d{1,3}(\.\d{3})+$/.test(raw);
  const number = Number(raw.includes(',') || thousandsOnly ? raw.replace(/\./g, '').replace(',', '.') : raw);
  if (!Number.isFinite(number) || number <= 0) throw new QuoteError('Informe um valor válido (ex.: 312,50).');
  if (!ISO_DAY.test(date || '')) throw new QuoteError('Informe a data do valor.');
  m.history = [{ date, value: number, by: admin.id, at: new Date().toISOString() }, ...m.history.filter((h) => h.date !== date)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 60);
  await save();
}

export async function setQuoteOptions({ enabled, auto }) {
  const settings = quoteSettings();
  if (typeof enabled === 'boolean') settings.enabled = enabled;
  if (auto && typeof auto === 'object') {
    for (const q of AUTO_QUOTES) if (typeof auto[q.id] === 'boolean') settings.auto[q.id] = auto[q.id];
    autoCache.at = 0; // busca de novo com a lista nova
  }
  await save();
}

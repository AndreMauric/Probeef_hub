// Medição de uso do portal, guardada em JSON Lines ao lado do arquivo de cadastros.
// Tipos de evento (registros antigos, sem "type", são aberturas):
//   view       – abriu um relatório (reaberturas em 30 min contam uma vez)
//   time       – tempo com o relatório aberto e visível (segundos) e páginas vistas
//   tool_view  – abriu uma ferramenta (ex.: 4M Confinamento), mesma regra de reabertura
//   tool_time  – tempo com a ferramenta aberta e visível (segundos)
//   login      – entrou no portal
//   export     – gerou um PDF
//   ask        – fez uma pergunta ao assistente
// Só clientes contam: acessos de administradores (e de admin "entrando como") não são registrados.

// Ferramentas fora do Power BI que o portal passou a distribuir (a primeira foi o 4M Confinamento).
// Para adicionar uma nova, basta incluir aqui e usar esse id nas chamadas de recordToolAccess/startToolView.
export const TOOLS = [{ id: 'confinamento', name: '4M Confinamento' }];
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { db } from './store.js';

const FILE = path.join(path.dirname(config.dataFile), 'access-log.jsonl');
const KEEP_DAYS = 400;
const DEDUPE_MS = 30 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const TZ = 'America/Sao_Paulo';
// Dias e horas contados no horário de Brasília, não em UTC.
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const hourOf = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
const weekdayOf = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

let events = [];
let writing = Promise.resolve();

const typeOf = (e) => e.type || 'view';

export async function loadAccessLog() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    const cutoff = Date.now() - KEEP_DAYS * DAY;
    events = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((e) => e && Date.parse(e.at) >= cutoff);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    events = [];
  }
}

function append(event) {
  events.push(event);
  const line = `${JSON.stringify(event)}\n`;
  writing = writing
    .then(async () => {
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      await fs.appendFile(FILE, line);
    })
    .catch((err) => console.error('Falha ao gravar o histórico de uso:', err.message));
}

export function recordEvent(type, { userId, clientId = null, reportId = null, ...extra }) {
  append({ at: new Date().toISOString(), type, userId, clientId, reportId, ...extra });
}

// Abertura de relatório. Reaberturas do mesmo relatório pelo mesmo usuário em 30 minutos contam uma vez.
export function recordAccess({ userId, clientId, reportId }) {
  const now = Date.now();
  const recent = events.findLast((e) => typeOf(e) === 'view' && e.userId === userId && e.reportId === reportId);
  if (recent && now - Date.parse(recent.at) < DEDUPE_MS) return;
  recordEvent('view', { userId, clientId, reportId });
}

// Abertura de ferramenta (ex.: 4M Confinamento). Mesma regra de reabertura do recordAccess.
export function recordToolAccess({ userId, clientId, toolId }) {
  const now = Date.now();
  const recent = events.findLast((e) => typeOf(e) === 'tool_view' && e.userId === userId && e.toolId === toolId);
  if (recent && now - Date.parse(recent.at) < DEDUPE_MS) return;
  append({ at: new Date().toISOString(), type: 'tool_view', userId, clientId, toolId });
}

// ---------- Tempo de uso: sessões de visualização com "batimentos" a cada minuto ----------

const BEAT_MAX_S = 75; // um batimento vale no máximo isso (o portal manda a cada 60 s)
const IDLE_MS = 3 * 60 * 1000; // sem batimento por 3 min: a sessão é encerrada
// viewId -> { userId, clientId, reportId, start, last, seconds, page (aba atual), pageStats: Map(aba -> { seconds, visits }) }
const sessions = new Map();

export function startView({ userId, clientId, reportId }) {
  const viewId = crypto.randomUUID();
  sessions.set(viewId, { userId, clientId, reportId, start: Date.now(), last: Date.now(), seconds: 0, page: null, pageStats: new Map() });
  return viewId;
}

// Mesma sessão de tempo acima, mas para uma ferramenta em vez de um relatório — beatView/endView
// (chamadas por /api/usage/beat e /api/usage/end) funcionam igual, sem saber a diferença.
export function startToolView({ userId, clientId, toolId }) {
  const viewId = crypto.randomUUID();
  sessions.set(viewId, { userId, clientId, toolId, start: Date.now(), last: Date.now(), seconds: 0, page: null, pageStats: new Map() });
  return viewId;
}

// Soma o tempo desde o último batimento (com teto, para abas esquecidas não inflarem o total) e
// atribui esse tempo à aba (página do relatório) que estava aberta no intervalo.
// page: aba aberta agora; se mudou, conta uma visita a ela.
// resume: a aba do navegador voltou a ficar visível; recomeça a contar sem somar o tempo oculto.
export function beatView(viewId, userId, page, { resume = false } = {}) {
  const s = sessions.get(viewId);
  if (!s || s.userId !== userId) return false;
  const now = Date.now();
  if (!resume) {
    const elapsed = Math.min(BEAT_MAX_S, Math.max(0, Math.round((now - s.last) / 1000)));
    s.seconds += elapsed;
    if (s.page) s.pageStats.get(s.page).seconds += elapsed;
  }
  s.last = now;
  const name = page ? String(page).slice(0, 100) : null;
  if (name && name !== s.page) {
    if (!s.pageStats.has(name)) s.pageStats.set(name, { seconds: 0, visits: 0 });
    s.pageStats.get(name).visits += 1;
    s.page = name;
  }
  return true;
}

function finish(viewId) {
  const s = sessions.get(viewId);
  if (!s) return;
  sessions.delete(viewId);
  if (s.seconds < 5) return;
  append({
    at: new Date(s.start).toISOString(),
    type: s.toolId ? 'tool_time' : 'time',
    userId: s.userId,
    clientId: s.clientId,
    reportId: s.reportId || null,
    toolId: s.toolId || null,
    seconds: s.seconds,
    pages: s.pageStats.size,
    pageStats: [...s.pageStats].map(([page, v]) => ({ page, seconds: v.seconds, visits: v.visits })),
  });
}

export function endView(viewId, userId, page) {
  if (beatView(viewId, userId, page)) finish(viewId);
}

setInterval(() => {
  const now = Date.now();
  for (const [viewId, s] of sessions) if (now - s.last > IDLE_MS) finish(viewId);
}, 60 * 1000).unref();

// ---------- Resumos para o painel "Uso" ----------

const clientOnly = () => {
  const ids = new Set(db().users.filter((u) => u.role === 'client').map((u) => u.id));
  return (e) => ids.has(e.userId);
};

function windowOf(days, offset = 0) {
  const end = Date.now() - offset * days * DAY;
  return { from: end - days * DAY, to: end };
}

const inWindow = (w) => (e) => {
  const t = Date.parse(e.at);
  return t >= w.from && t < w.to;
};

function totalsOf(list) {
  const views = list.filter((e) => typeOf(e) === 'view');
  return {
    views: views.length,
    activeUsers: new Set(list.filter((e) => typeOf(e) !== 'login').map((e) => e.userId)).size,
    activeClients: new Set(views.map((e) => e.clientId).filter(Boolean)).size,
    minutes: Math.round(list.filter((e) => typeOf(e) === 'time').reduce((s, e) => s + (e.seconds || 0), 0) / 60),
    exports: list.filter((e) => typeOf(e) === 'export').length,
    questions: list.filter((e) => typeOf(e) === 'ask').length,
    logins: list.filter((e) => typeOf(e) === 'login').length,
  };
}

// Situação do cliente pelo último acesso: ativo (até 7 dias), esfriando (8 a 30), inativo (mais de 30).
function healthOf(lastAccess) {
  if (!lastAccess) return 'nunca';
  const days = (Date.now() - Date.parse(lastAccess)) / DAY;
  if (days <= 7) return 'ativo';
  if (days <= 30) return 'esfriando';
  return 'inativo';
}

function dailySeries(list, days) {
  const views = new Map();
  const users = new Map();
  for (const e of list) {
    const day = dayKey.format(new Date(e.at));
    if (typeOf(e) === 'view') views.set(day, (views.get(day) || 0) + 1);
    if (typeOf(e) !== 'login') {
      if (!users.has(day)) users.set(day, new Set());
      users.get(day).add(e.userId);
    }
  }
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = dayKey.format(new Date(Date.now() - i * DAY));
    out.push({ day, views: views.get(day) || 0, users: users.get(day)?.size || 0 });
  }
  return out;
}

function heatmapOf(list) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const e of list) {
    if (typeOf(e) !== 'view') continue;
    const d = new Date(e.at);
    grid[WEEKDAYS[weekdayOf.format(d)]][Number(hourOf.format(d))] += 1;
  }
  return grid;
}

function reportRows(list, reportsInScope, clientsInScope) {
  const all = events.filter(clientOnly());
  return reportsInScope
    .map((r) => {
      const mine = list.filter((e) => e.reportId === r.id);
      const views = mine.filter((e) => typeOf(e) === 'view');
      const seconds = mine.filter((e) => typeOf(e) === 'time').reduce((s, e) => s + (e.seconds || 0), 0);
      const sessionsCount = mine.filter((e) => typeOf(e) === 'time').length;
      const last = all.findLast((e) => e.reportId === r.id && typeOf(e) === 'view');
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        clients: clientsInScope.filter((c) => c.reportIds.includes(r.id)).map((c) => c.name),
        views: views.length,
        users: new Set(views.map((e) => e.userId)).size,
        minutes: Math.round(seconds / 60),
        avgMinutes: sessionsCount ? Math.round((seconds / sessionsCount / 60) * 10) / 10 : 0,
        exports: mine.filter((e) => typeOf(e) === 'export').length,
        lastView: last?.at || null,
      };
    })
    .sort((a, b) => b.views - a.views || b.minutes - a.minutes || a.name.localeCompare(b.name, 'pt-BR'));
}

function toolRows(list) {
  const all = events.filter(clientOnly());
  return TOOLS.map((t) => {
    const mine = list.filter((e) => e.toolId === t.id);
    const views = mine.filter((e) => typeOf(e) === 'tool_view');
    const timeEvents = mine.filter((e) => typeOf(e) === 'tool_time');
    const seconds = timeEvents.reduce((s, e) => s + (e.seconds || 0), 0);
    const last = all.findLast((e) => e.toolId === t.id && typeOf(e) === 'tool_view');
    return {
      id: t.id,
      name: t.name,
      views: views.length,
      users: new Set(views.map((e) => e.userId)).size,
      minutes: Math.round(seconds / 60),
      avgMinutes: timeEvents.length ? Math.round((seconds / timeEvents.length / 60) * 10) / 10 : 0,
      lastView: last?.at || null,
    };
  }).sort((a, b) => b.views - a.views || b.minutes - a.minutes);
}

function userRows(list, usersInScope) {
  const all = events.filter(clientOnly());
  const clientNames = new Map(db().clients.map((c) => [c.id, c.name]));
  return usersInScope
    .map((u) => {
      const mine = list.filter((e) => e.userId === u.id);
      const last = all.findLast((e) => e.userId === u.id && typeOf(e) !== 'login');
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        clients: (u.clientIds || []).map((id) => clientNames.get(id)).filter(Boolean),
        views: mine.filter((e) => typeOf(e) === 'view').length,
        minutes: Math.round(mine.filter((e) => typeOf(e) === 'time').reduce((s, e) => s + (e.seconds || 0), 0) / 60),
        questions: mine.filter((e) => typeOf(e) === 'ask').length,
        lastAccess: last?.at || null,
        lastLogin: u.lastLoginAt || null,
        active: u.active,
      };
    })
    .sort((a, b) => b.views - a.views || b.minutes - a.minutes || a.name.localeCompare(b.name, 'pt-BR'));
}

function feed(list) {
  const { users, clients, reports } = db();
  const name = (arr, id) => arr.find((x) => x.id === id)?.name;
  const toolName = (id) => TOOLS.find((t) => t.id === id)?.name || id;
  return list
    .filter((e) => typeOf(e) !== 'time' && typeOf(e) !== 'tool_time')
    .slice(-60)
    .reverse()
    .map((e) => ({
      at: e.at,
      type: typeOf(e),
      user: name(users, e.userId) || '(removido)',
      client: name(clients, e.clientId) || '—',
      report: e.reportId ? name(reports, e.reportId) || '(removido)' : null,
      tool: e.toolId ? toolName(e.toolId) : null,
    }));
}

// Filtro por tags: dentro do mesmo grupo vale qualquer tag (Grande ou Médio); entre grupos,
// todas (Grande e Região Sul). Tags sem grupo contam como um grupo só. Sem filtro: null.
export function clientsWithTags(tagIds = []) {
  const { clients, tags } = db();
  const chosen = tags.filter((t) => tagIds.includes(t.id));
  if (!chosen.length) return null;
  const groups = new Map();
  for (const t of chosen) {
    const key = (t.group || '').toLowerCase();
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(t.id);
  }
  return new Set(
    clients.filter((c) => [...groups.values()].every((ids) => (c.tagIds || []).some((id) => ids.has(id)))).map((c) => c.id),
  );
}

// Eventos dos clientes do filtro (logins não têm fazenda: entram os dos usuários desses clientes).
function eventFilterFor(clientIds) {
  if (!clientIds) return () => true;
  const people = new Set(db().users.filter((u) => u.clientIds?.some((id) => clientIds.has(id))).map((u) => u.id));
  return (e) => (e.clientId ? clientIds.has(e.clientId) : people.has(e.userId));
}

function clientRowsOf(current, previous, all, clientList) {
  const clientUsers = db().users.filter((u) => u.role === 'client');
  const lastByClient = new Map();
  for (const e of all) if (e.clientId && typeOf(e) !== 'login') lastByClient.set(e.clientId, e.at);
  return clientList
    .map((c) => {
      const cur = current.filter((e) => e.clientId === c.id);
      const prev = previous.filter((e) => e.clientId === c.id);
      const lastAccess = lastByClient.get(c.id) || null;
      return {
        id: c.id,
        name: c.name,
        tagIds: c.tagIds || [],
        views: cur.filter((e) => typeOf(e) === 'view').length,
        prevViews: prev.filter((e) => typeOf(e) === 'view').length,
        minutes: Math.round(cur.filter((e) => typeOf(e) === 'time').reduce((sum, e) => sum + (e.seconds || 0), 0) / 60),
        activeUsers: new Set(cur.filter((e) => typeOf(e) !== 'login').map((e) => e.userId)).size,
        totalUsers: clientUsers.filter((u) => u.clientIds?.includes(c.id)).length,
        lastAccess,
        health: healthOf(lastAccess),
      };
    })
    .sort((a, b) => b.views - a.views || b.minutes - a.minutes || a.name.localeCompare(b.name, 'pt-BR'));
}

// Comparação entre tags no período (sempre com todos os clientes, independente do filtro).
function tagBreakdown(rows) {
  return [...db().tags]
    .sort((a, b) => (a.group || '').localeCompare(b.group || '', 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR'))
    .map((t) => {
      const mine = rows.filter((c) => c.tagIds.includes(t.id));
      const views = mine.reduce((sum, c) => sum + c.views, 0);
      const prevViews = mine.reduce((sum, c) => sum + c.prevViews, 0);
      const minutes = mine.reduce((sum, c) => sum + c.minutes, 0);
      const active = mine.filter((c) => c.views > 0).length;
      return {
        id: t.id,
        name: t.name,
        group: t.group || '',
        color: t.color || 0,
        clients: mine.length,
        activeClients: active,
        activeShare: mine.length ? Math.round((active / mine.length) * 100) : 0,
        views,
        prevViews,
        minutes,
        viewsPerClient: mine.length ? Math.round((views / mine.length) * 10) / 10 : 0,
        minutesPerClient: mine.length ? Math.round(minutes / mine.length) : 0,
        health: ['ativo', 'esfriando', 'inativo', 'nunca'].reduce((acc, h) => ({ ...acc, [h]: mine.filter((c) => c.health === h).length }), {}),
      };
    });
}

export function usageSummary(days, { tagIds = [] } = {}) {
  const { users, clients, reports } = db();
  const all = events.filter(clientOnly());
  const activeClients = clients.filter((c) => c.active);

  // Comparação por tag: sempre sobre todos os clientes.
  const fullRows = clientRowsOf(all.filter(inWindow(windowOf(days))), all.filter(inWindow(windowOf(days, 1))), all, activeClients);

  // Filtro por tags: restringe clientes e eventos.
  const chosen = clientsWithTags(tagIds);
  const mine = all.filter(eventFilterFor(chosen));
  const current = mine.filter(inWindow(windowOf(days)));
  const previous = mine.filter(inWindow(windowOf(days, 1)));
  const scopeClients = chosen ? activeClients.filter((c) => chosen.has(c.id)) : activeClients;
  const clientRows = chosen ? fullRows.filter((c) => chosen.has(c.id)) : fullRows;
  const scopeUsers = users.filter((u) => u.role === 'client' && (!chosen || u.clientIds?.some((id) => chosen.has(id))));

  const assigned = reports.filter((r) => scopeClients.some((c) => c.reportIds.includes(r.id)));
  const reportTable = reportRows(current, assigned, scopeClients);
  const everViewed = new Set(all.filter((e) => typeOf(e) === 'view').map((e) => e.reportId));

  return {
    days,
    filter: { tagIds: chosen ? tagIds : [], clients: clientRows.length },
    totals: totalsOf(current),
    previous: totalsOf(previous),
    health: ['ativo', 'esfriando', 'inativo', 'nunca'].reduce((acc, h) => ({ ...acc, [h]: clientRows.filter((c) => c.health === h).length }), {}),
    byDay: dailySeries(current, days),
    heatmap: heatmapOf(current),
    clients: clientRows,
    tags: tagBreakdown(fullRows),
    reports: reportTable.filter((r) => r.views || r.minutes).slice(0, 30),
    tools: toolRows(current),
    neverOpened: reportTable.filter((r) => !everViewed.has(r.id)).map(({ id, name, category, clients: owners }) => ({ id, name, category, clients: owners })),
    users: userRows(current, scopeUsers).slice(0, 50),
    recent: feed(current),
  };
}

// Detalhe de um cliente: usuários, relatórios e uso dia a dia.
export function clientUsage(clientId, days) {
  const { users, clients, reports } = db();
  const client = clients.find((c) => c.id === clientId);
  if (!client) return null;
  const people = users.filter((u) => u.role === 'client' && u.clientIds?.includes(clientId));
  const peopleIds = new Set(people.map((u) => u.id));
  // Logins não têm fazenda: contam os dos usuários deste cliente.
  const current = events
    .filter(clientOnly())
    .filter(inWindow(windowOf(days)))
    .filter((e) => e.clientId === clientId || (typeOf(e) === 'login' && peopleIds.has(e.userId)));
  return {
    client: { id: client.id, name: client.name },
    days,
    totals: totalsOf(current),
    byDay: dailySeries(current, days),
    users: userRows(current, people),
    reports: reportRows(current, reports.filter((r) => client.reportIds.includes(r.id)), [client]),
  };
}

// Abas (páginas) de um relatório: visitas, tempo e pessoas, a partir das sessões com tempo registrado.
export function reportPages(reportId, days) {
  const report = db().reports.find((r) => r.id === reportId);
  if (!report) return null;
  const list = events
    .filter(clientOnly())
    .filter(inWindow(windowOf(days)))
    .filter((e) => e.reportId === reportId && typeOf(e) === 'time' && Array.isArray(e.pageStats));
  const pages = new Map();
  for (const e of list) {
    for (const p of e.pageStats) {
      if (!pages.has(p.page)) pages.set(p.page, { page: p.page, visits: 0, seconds: 0, sessions: 0, people: new Set() });
      const row = pages.get(p.page);
      row.visits += p.visits || 0;
      row.seconds += p.seconds || 0;
      row.sessions += 1;
      row.people.add(e.userId);
    }
  }
  const totalSeconds = [...pages.values()].reduce((sum, r) => sum + r.seconds, 0);
  return {
    report: { id: report.id, name: report.name, category: report.category },
    days,
    sessions: list.length,
    pages: [...pages.values()]
      .map((r) => ({
        page: r.page,
        visits: r.visits,
        people: r.people.size,
        reach: list.length ? Math.round((r.sessions / list.length) * 100) : 0,
        seconds: r.seconds,
        minutes: Math.round((r.seconds / 60) * 10) / 10,
        avgSeconds: r.visits ? Math.round(r.seconds / r.visits) : 0,
        timeShare: totalSeconds ? Math.round((r.seconds / totalSeconds) * 100) : 0,
      }))
      .sort((a, b) => b.visits - a.visits || b.minutes - a.minutes),
  };
}

// Eventos do período em CSV (abre no Excel em português: separador ";").
export function usageCsv(days, { tagIds = [] } = {}) {
  const { users, clients, reports } = db();
  const name = (arr, id) => arr.find((x) => x.id === id)?.name || '';
  const email = (id) => users.find((u) => u.id === id)?.email || '';
  const toolName = (id) => TOOLS.find((t) => t.id === id)?.name || id;
  const labels = { view: 'abertura', time: 'tempo de uso', tool_view: 'abertura de ferramenta', tool_time: 'tempo de uso (ferramenta)', login: 'login', export: 'PDF', ask: 'pergunta ao assistente' };
  const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = events
    .filter(clientOnly())
    .filter(eventFilterFor(clientsWithTags(tagIds)))
    .filter(inWindow(windowOf(days)))
    .map((e) => [
      fmt.format(new Date(e.at)),
      labels[typeOf(e)] || typeOf(e),
      name(users, e.userId),
      email(e.userId),
      name(clients, e.clientId),
      e.reportId ? name(reports, e.reportId) : '',
      e.toolId ? toolName(e.toolId) : '',
      typeOf(e) === 'time' || typeOf(e) === 'tool_time' ? String(Math.round(((e.seconds || 0) / 60) * 10) / 10).replace('.', ',') : '',
      typeOf(e) === 'time' ? e.pages || 0 : '',
    ]);
  const header = ['Data e hora', 'Tipo', 'Usuário', 'E-mail', 'Cliente', 'Relatório', 'Ferramenta', 'Minutos', 'Páginas'];
  // O BOM no início faz o Excel reconhecer os acentos (UTF-8).
  const BOM = String.fromCharCode(0xfeff);
  return `${BOM}${[header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
}

// Quanto a pessoa já usou o portal: relatórios abertos e em quantos dias diferentes.
export function userActivity(userId) {
  const views = events.filter((e) => e.userId === userId && typeOf(e) === 'view');
  return { views: views.length, days: new Set(views.map((e) => dayKey.format(new Date(e.at)))).size };
}

// Pesquisa de satisfação (NPS): "De 0 a 10, quanto o portal te ajuda no dia a dia?".
// Aparece só para clientes que já usam o portal de verdade (relatórios abertos em dias diferentes)
// e no máximo uma vez a cada 90 dias. Quem fecha sem responder é perguntado de novo em 30 dias.
//   9–10 promotores · 7–8 neutros · 0–6 detratores · NPS = % promotores − % detratores
import { clientsWithTags, userActivity } from './accessLog.js';
import { userClients } from './auth.js';
import { db, newId, save } from './store.js';

const DAY = 24 * 60 * 60 * 1000;
const ASK_EVERY_DAYS = 90;
const RETRY_AFTER_DISMISS_DAYS = 30;
const MIN_VIEWS = 3;
const MIN_ACTIVE_DAYS = 2;

export class NpsError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const npsEnabled = () => db().settings?.npsEnabled !== false;

const since = (iso) => (iso ? (Date.now() - Date.parse(iso)) / DAY : Infinity);

// Deve perguntar agora? Nunca para admins, admin "entrando como" ou quem ainda não usa o portal.
export function shouldAsk(user, { impersonating = false } = {}) {
  if (!npsEnabled() || impersonating || user.role !== 'client' || user.mustChangePassword) return false;
  if (since(user.npsAnsweredAt) < ASK_EVERY_DAYS || since(user.npsDismissedAt) < RETRY_AFTER_DISMISS_DAYS) return false;
  const { views, days } = userActivity(user.id);
  return views >= MIN_VIEWS && days >= MIN_ACTIVE_DAYS;
}

export async function answer(user, { score, comment }) {
  const n = Number(score);
  if (!Number.isInteger(n) || n < 0 || n > 10) throw new NpsError('Escolha uma nota de 0 a 10.');
  const data = db();
  const response = {
    id: newId(),
    userId: user.id,
    clientIds: userClients(user).map((c) => c.id),
    score: n,
    comment: String(comment ?? '').trim().slice(0, 1000),
    at: new Date().toISOString(),
  };
  data.nps = [...(data.nps || []), response].slice(-5000);
  user.npsAnsweredAt = response.at;
  await save();
}

export async function dismiss(user) {
  user.npsDismissedAt = new Date().toISOString();
  await save();
}

export const category = (score) => (score >= 9 ? 'promotor' : score >= 7 ? 'neutro' : 'detrator');

function scoreOf(list) {
  if (!list.length) return null;
  const pro = list.filter((r) => r.score >= 9).length;
  const det = list.filter((r) => r.score <= 6).length;
  return Math.round(((pro - det) / list.length) * 100);
}

// Resumo para o painel de uso, no mesmo período e filtro de tags.
export function npsSummary(days, { tagIds = [] } = {}) {
  const { users, clients } = db();
  const chosen = clientsWithTags(tagIds);
  const all = (db().nps || []).filter((r) => !chosen || r.clientIds.some((id) => chosen.has(id)));
  const now = Date.now();
  const cur = all.filter((r) => Date.parse(r.at) >= now - days * DAY);
  const prev = all.filter((r) => Date.parse(r.at) >= now - 2 * days * DAY && Date.parse(r.at) < now - days * DAY);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  return {
    enabled: npsEnabled(),
    score: scoreOf(cur),
    previousScore: scoreOf(prev),
    responses: cur.length,
    promoters: cur.filter((r) => r.score >= 9).length,
    passives: cur.filter((r) => r.score >= 7 && r.score <= 8).length,
    detractors: cur.filter((r) => r.score <= 6).length,
    distribution: Array.from({ length: 11 }, (_, s) => cur.filter((r) => r.score === s).length),
    recent: [...cur]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 50)
      .map((r) => ({
        id: r.id,
        at: r.at,
        score: r.score,
        category: category(r.score),
        comment: r.comment,
        user: userName.get(r.userId) || '(removido)',
        clients: r.clientIds.map((id) => clientName.get(id)).filter(Boolean),
      })),
  };
}

// Respostas de detratores nos últimos 30 dias, para a central de alertas.
export function recentDetractors() {
  const { users, clients } = db();
  return (db().nps || [])
    .filter((r) => r.score <= 6 && Date.parse(r.at) >= Date.now() - 30 * DAY)
    .map((r) => ({
      ...r,
      user: users.find((u) => u.id === r.userId),
      clients: clients.filter((c) => r.clientIds.includes(c.id)),
    }));
}

// Preferências de cada pessoa no portal: relatórios favoritos e visões salvas (filtros guardados).
// Uma visão é o "estado" do relatório capturado pelo Power BI (filtros, segmentações e página),
// reaplicado ao abrir. Ela só guarda filtros: o que a pessoa pode ver continua decidido pelo
// servidor (clientes liberados e segurança por linha).
import { visibleReports } from './access.js';
import { userClients } from './auth.js';
import { db, newId, save } from './store.js';

const MAX_FAVORITES = 200;
const MAX_VIEWS_PER_REPORT = 20;
const MAX_VIEWS = 100;
const MAX_STATE = 90_000;

export class PersonalError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const canSee = (user, reportId) => visibleReports(user).some((r) => r.id === reportId);

export function favoritesOf(user) {
  return new Set(Array.isArray(user.favorites) ? user.favorites : []);
}

export async function setFavorite(user, reportId, favorite) {
  if (!canSee(user, reportId)) throw new PersonalError('Relatório não encontrado.', 404);
  const list = (user.favorites || []).filter((id) => id !== reportId);
  if (favorite) list.unshift(reportId);
  user.favorites = list.slice(0, MAX_FAVORITES);
  await save();
  return favorite;
}

// Visões sem o estado (que é grande): para listas e menus.
const summary = (v) => ({ id: v.id, reportId: v.reportId, clientId: v.clientId, name: v.name, createdAt: v.createdAt });

// Visões dos relatórios que a pessoa ainda vê (relatórios removidos ou retirados somem da lista).
export function viewsOf(user) {
  const visible = new Map(visibleReports(user).map((r) => [r.id, r]));
  return (user.savedViews || [])
    .filter((v) => visible.has(v.reportId) && (!v.clientId || user.role === 'admin' || visible.get(v.reportId).clientIds.includes(v.clientId)))
    .map(summary);
}

export function getView(user, viewId) {
  const view = (user.savedViews || []).find((v) => v.id === viewId);
  if (!view || !viewsOf(user).some((v) => v.id === viewId)) throw new PersonalError('Visão não encontrada.', 404);
  return { ...summary(view), state: view.state };
}

export async function saveView(user, reportId, { name, state, client }) {
  if (!canSee(user, reportId)) throw new PersonalError('Relatório não encontrado.', 404);
  const title = String(name ?? '').trim().slice(0, 60);
  if (!title) throw new PersonalError('Dê um nome para a visão, por exemplo "Fazenda X, último mês".');
  if (typeof state !== 'string' || !state || state.length > MAX_STATE) {
    throw new PersonalError('Não foi possível guardar os filtros deste relatório (filtros demais). Tente com menos seleções.');
  }
  let clientId = null;
  if (client) {
    if (user.role !== 'admin' && !userClients(user).some((c) => c.id === client)) throw new PersonalError('Cliente inválido.');
    clientId = user.role === 'admin' ? null : String(client);
  }
  const views = user.savedViews || [];
  const sameReport = views.filter((v) => v.reportId === reportId && v.clientId === clientId);
  const existing = sameReport.find((v) => v.name.toLowerCase() === title.toLowerCase());
  if (!existing && sameReport.length >= MAX_VIEWS_PER_REPORT) throw new PersonalError(`Limite de ${MAX_VIEWS_PER_REPORT} visões por relatório. Apague alguma para salvar outra.`);
  if (!existing && views.length >= MAX_VIEWS) throw new PersonalError(`Limite de ${MAX_VIEWS} visões salvas. Apague alguma para salvar outra.`);
  // Mesmo nome no mesmo relatório: atualiza a visão em vez de duplicar.
  const view = existing || { id: newId(), reportId, clientId, createdAt: new Date().toISOString() };
  Object.assign(view, { name: title, state, updatedAt: new Date().toISOString() });
  if (!existing) user.savedViews = [...views, view];
  await save();
  return { view: summary(view), updated: Boolean(existing) };
}

export async function deleteView(user, viewId) {
  const views = user.savedViews || [];
  if (!views.some((v) => v.id === viewId)) throw new PersonalError('Visão não encontrada.', 404);
  user.savedViews = views.filter((v) => v.id !== viewId);
  await save();
}

// Limpeza quando um relatório é removido do portal.
export function forgetReport(reportId) {
  for (const u of db().users) {
    if (u.favorites?.includes(reportId)) u.favorites = u.favorites.filter((id) => id !== reportId);
    if (u.savedViews?.some((v) => v.reportId === reportId)) u.savedViews = u.savedViews.filter((v) => v.reportId !== reportId);
  }
}

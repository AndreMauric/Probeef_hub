// Benchmarking Confinamento: coleta por cliente (fazenda), validação e aprovação pela Cargill.
// As regras de campos, validação e resultado ficam em public/benchmark/fields.js (as mesmas no
// navegador e aqui). Um envio por cliente por ano: db().bmkSubmissions. Limites e listas
// editáveis pelo admin: db().bmkSettings (o padrão é o da aba Configurações da planilha).
//
// Fluxo: rascunho → enviado → (correcao ↔ enviado) → aprovado. O cliente edita em rascunho e
// correcao; o admin pode editar sempre e reabrir um aprovado. Validadores (user.bmkValidator, do
// Time Cargill) aprovam/devolvem/reabrem como o admin, nas fazendas que enxergam pela equipe.
// Quem vê o quê (perfis, gestores, "responde a", responsável pela fazenda): src/bmkTeam.js.
// O ciclo é o "ano" das configurações; com a coleta fechada (settings.aberta = false) ninguém além
// do admin cadastra fazenda nem altera ou envia dados.
import { adminSend, userSend } from './chat.js';
import { cleanAnswer, cleanLote, editableStatus, mergeSettings, QUESTIONS, validateLotes, validateQuestionario } from '../public/benchmark/fields.js';
import { bmkMember, canCreateFarm, canSetOwner, isInternal, kindOf, ownerCandidates, ownerScope } from './bmkTeam.js';
import { db, newId, save } from './store.js';

const MAX_LOTES = 2000;

class BenchmarkError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const settings = () => mergeSettings(db().bmkSettings || {});

export const isValidator = (user) => user.role === 'admin' || (kindOf(user) === 'cargill' && Boolean(user.bmkValidator));

// Fazendas do benchmarking que o usuário pode abrir. Admin: todas. Cliente: as vinculadas a ele.
// Time e Canais: as que têm como responsável alguém do alcance dele (ownerScope), mais as
// vinculadas diretamente no cadastro (como era antes das equipes).
export function participantClients(user) {
  const list = db().clients.filter((c) => c.benchmark && c.active !== false);
  if (user.role === 'admin') return list;
  const scope = isInternal(user) ? ownerScope(user) : null;
  return list.filter((c) => user.clientIds?.includes(c.id) || (scope && c.bmkOwner && scope.has(c.bmkOwner)));
}

// Time, Canais e logins "só Benchmarking" entram mesmo sem fazenda ainda (para cadastrar a primeira).
export const canUseBenchmark = (user) => bmkMember(user) || participantClients(user).length > 0;

export const coletaAberta = () => settings().aberta !== false;
function assertAberta(user) {
  if (user.role !== 'admin' && !coletaAberta()) throw new BenchmarkError(`A coleta do Benchmarking ${settings().ano} está fechada.`, 409);
}

function clientOr404(user, clientId) {
  const client = participantClients(user).find((c) => c.id === clientId);
  if (!client) throw new BenchmarkError('Cliente não encontrado ou fora do benchmarking.', 404);
  return client;
}

function submissionOf(clientId, { create = false } = {}) {
  const data = db();
  const ano = settings().ano;
  let sub = data.bmkSubmissions.find((s) => s.clientId === clientId && s.ano === ano);
  if (!sub && create) {
    sub = { id: newId(), clientId, ano, status: 'rascunho', version: 0, engorda: [], recria: [], respostas: {}, messages: [], createdAt: new Date().toISOString(), updatedAt: null };
    data.bmkSubmissions.push(sub);
  }
  return sub;
}

const userName = (id) => db().users.find((u) => u.id === id)?.name || null;

// Situação resumida: o que falta e quantos problemas há (usada na tela e na lista do admin).
export function summary(sub) {
  const s = settings();
  const eng = validateLotes(sub?.engorda || [], s);
  const rec = validateLotes(sub?.recria || [], s, { recria: true });
  const q = validateQuestionario(sub?.respostas || {});
  return {
    lotesEngorda: sub?.engorda.length || 0,
    lotesRecria: sub?.recria.length || 0,
    erros: eng.erros + rec.erros,
    alertas: eng.alertas + rec.alertas,
    lotesComErro: eng.lotesComErro + rec.lotesComErro,
    questionario: { respondidas: q.respondidas, visiveis: q.visiveis, faltando: q.faltando.length },
    prontoParaEnviar: (sub?.engorda.length || 0) + (sub?.recria.length || 0) > 0 && eng.erros + rec.erros === 0 && q.faltando.length === 0,
  };
}

const withoutMetrics = ({ metrics, ...rest }) => rest;

// ---------- Métricas do processo (projeto DMAIC; ver src/benchmarkMetrics.js) ----------

const SESSION_GAP_MS = 30 * 60 * 1000; // salvamentos com menos de 30 min entre si são a mesma sessão
const MAX_SESSIONS = 3000;

// Retrato da validação num momento: quantos lotes, erros e alertas, e em quais campos.
export function snapshot(sub) {
  const s = settings();
  const porCampo = {};
  const count = (lotes, recria) => {
    const v = validateLotes(lotes, s, { recria });
    for (const issues of v.porLote) {
      for (const i of issues) {
        porCampo[i.field] ??= { erro: 0, alerta: 0 };
        porCampo[i.field][i.level] += 1;
      }
    }
    return v;
  };
  const eng = count(sub.engorda, false);
  const rec = count(sub.recria, true);
  const q = validateQuestionario(sub.respostas || {});
  return {
    at: new Date().toISOString(),
    lotes: sub.engorda.length + sub.recria.length,
    erros: eng.erros + rec.erros,
    alertas: eng.alertas + rec.alertas,
    lotesComErro: eng.lotesComErro + rec.lotesComErro,
    porCampo,
    questionario: { respondidas: q.respondidas, visiveis: q.visiveis, faltando: q.faltando.length },
  };
}

// Cada salvamento entra numa sessão de trabalho da pessoa (início, fim, quantos salvamentos e
// o que mudou). Duas sessões separadas por mais de 30 min sem salvar contam como duas.
function recordWork(sub, user, changed) {
  sub.metrics ??= { sessions: [] };
  const now = new Date().toISOString();
  const last = sub.metrics.sessions.findLast((x) => x.userId === user.id);
  let session = last && Date.parse(now) - Date.parse(last.end) < SESSION_GAP_MS ? last : null;
  if (!session) {
    session = { userId: user.id, role: user.role, start: now, end: now, saves: 0, parts: { engorda: 0, recria: 0, respostas: 0 } };
    sub.metrics.sessions.push(session);
    if (sub.metrics.sessions.length > MAX_SESSIONS) sub.metrics.sessions.shift();
  }
  session.end = now;
  session.saves += 1;
  for (const p of changed) session.parts[p] += 1;
  // Primeira vez que entram lotes: a qualidade do dado como chegou (antes das correções).
  if (!sub.metrics.primeiro && sub.engorda.length + sub.recria.length > 0) sub.metrics.primeiro = { ...snapshot(sub), by: user.id };
}

function view(user, client, sub) {
  const status = sub?.status || 'rascunho';
  return {
    // O que este usuário pode fazer aqui (a tela esconde os botões; as rotas conferem de novo).
    access: { edit: user.role === 'admin' || (coletaAberta() && editableStatus(status)), review: isValidator(user) },
    client: { id: client.id, name: client.name },
    // sub.metrics (sessões de trabalho de cada pessoa) é só para o admin: fica fora da tela.
    submission: sub
      ? {
          ...withoutMetrics(sub),
          messages: sub.messages.map((m) => ({ ...m, byName: userName(m.by) })),
          updatedByName: userName(sub.updatedBy),
          decidedByName: userName(sub.decidedBy),
        }
      : { status: 'rascunho', version: 0, engorda: [], recria: [], respostas: {}, messages: [] },
    summary: summary(sub),
    settings: settings(),
  };
}

export function getForUser(user, clientId) {
  const client = clientOr404(user, clientId);
  return view(user, client, submissionOf(clientId));
}

function cleanRespostas(raw = {}) {
  const out = {};
  for (const q of QUESTIONS) {
    if (!(q.id in raw)) continue;
    const { value } = cleanAnswer(q, raw[q.id]);
    // Resposta inválida não é salva como lixo: guarda o texto para a pessoa corrigir.
    out[q.id] = value ?? (raw[q.id] === null || raw[q.id] === '' ? null : String(raw[q.id]).slice(0, 300));
  }
  return out;
}

function cleanLotes(list, label) {
  if (!Array.isArray(list)) return null;
  if (list.length > MAX_LOTES) throw new BenchmarkError(`Máximo de ${MAX_LOTES} lotes de ${label}.`);
  return list.map(cleanLote).filter((l) => Object.keys(l).length);
}

// Salva o rascunho. version evita que duas pessoas sobrescrevam o trabalho uma da outra.
export async function saveDraft(user, clientId, body = {}) {
  const client = clientOr404(user, clientId);
  assertAberta(user);
  const sub = submissionOf(clientId, { create: true });
  if (user.role !== 'admin' && !editableStatus(sub.status)) throw new BenchmarkError('Este benchmarking já foi enviado e está travado para edição.', 409);
  if (Number(body.version) !== sub.version) throw new BenchmarkError('Outra pessoa salvou alterações neste benchmarking. Recarregue a página para ver a versão mais nova.', 409);
  const engorda = cleanLotes(body.engorda, 'engorda');
  const recria = cleanLotes(body.recria, 'recria');
  const before = { engorda: JSON.stringify(sub.engorda), recria: JSON.stringify(sub.recria), respostas: JSON.stringify(sub.respostas) };
  if (engorda) sub.engorda = engorda;
  if (recria) sub.recria = recria;
  if (body.respostas && typeof body.respostas === 'object') sub.respostas = { ...sub.respostas, ...cleanRespostas(body.respostas) };
  const changed = Object.keys(before).filter((p) => JSON.stringify(sub[p]) !== before[p]);
  if (changed.length) recordWork(sub, user, changed);
  sub.version += 1;
  sub.updatedAt = new Date().toISOString();
  sub.updatedBy = user.id;
  await save();
  return view(user, client, sub);
}

// Apaga de uma vez o que foi preenchido (lotes de engorda, de recria e/ou o questionário).
// Mesmas travas do rascunho; fica registrado no histórico quem apagou e o quê.
const CLEAR_PARTS = { engorda: 'lotes de engorda', recria: 'lotes de recria', respostas: 'questionário' };
export async function clearDraft(user, clientId, { version, parts } = {}) {
  const client = clientOr404(user, clientId);
  assertAberta(user);
  const sub = submissionOf(clientId, { create: true });
  if (user.role !== 'admin' && !editableStatus(sub.status)) throw new BenchmarkError('Este benchmarking já foi enviado e está travado para edição.', 409);
  if (Number(version) !== sub.version) throw new BenchmarkError('Outra pessoa salvou alterações neste benchmarking. Recarregue a página para ver a versão mais nova.', 409);
  const chosen = Object.keys(CLEAR_PARTS).filter((p) => Array.isArray(parts) && parts.includes(p));
  if (!chosen.length) throw new BenchmarkError('Escolha o que apagar.');
  const counts = { engorda: sub.engorda.length, recria: sub.recria.length, respostas: Object.keys(sub.respostas).length };
  for (const p of chosen) sub[p] = p === 'respostas' ? {} : [];
  log(sub, user, 'limpar', `Apagou: ${chosen.map((p) => `${CLEAR_PARTS[p]} (${counts[p]})`).join(', ')}.`);
  sub.version += 1;
  sub.updatedAt = new Date().toISOString();
  sub.updatedBy = user.id;
  await save();
  return view(user, client, sub);
}

function log(sub, user, action, text = '', extra = {}) {
  sub.messages.push({ id: newId(), at: new Date().toISOString(), by: user.id, role: user.role, action, text: String(text || '').trim().slice(0, 2000), ...extra });
}

// Cliente envia para a Cargill validar: sem erros e com o questionário obrigatório respondido.
export async function submit(user, clientId, { text, impersonating = false } = {}) {
  const client = clientOr404(user, clientId);
  assertAberta(user);
  const sub = submissionOf(clientId);
  if (!sub) throw new BenchmarkError('Preencha os dados antes de enviar.');
  if (!editableStatus(sub.status)) throw new BenchmarkError('Este benchmarking já foi enviado.', 409);
  const s = summary(sub);
  if (!s.prontoParaEnviar) {
    throw new BenchmarkError(
      s.erros ? `Corrija os ${s.erros} erro(s) nos lotes antes de enviar.` : s.questionario.faltando ? `Faltam ${s.questionario.faltando} pergunta(s) obrigatória(s) no questionário.` : 'Inclua ao menos um lote.',
    );
  }
  sub.status = 'enviado';
  sub.submittedAt = new Date().toISOString();
  // Retrato no envio: os alertas que sobraram (erros não deixam enviar) e por campo.
  log(sub, user, 'enviado', text, { snapshot: snapshot(sub) });
  await save();
  // Avisa a equipe pelas Mensagens do portal (não quando é o admin "entrando como").
  if (user.role === 'client' && !impersonating) {
    await userSend(user, { text: `Enviei o Benchmarking ${sub.ano} de ${client.name} para validação.${text ? `\n\n${text}` : ''}` }).catch(() => {});
  }
  return view(user, client, sub);
}

// Decisão da Cargill: devolver para correção (com o motivo), aprovar ou reabrir.
export async function review(admin, clientId, { action, text }) {
  if (!isValidator(admin)) throw new BenchmarkError('Só quem valida o benchmarking pode aprovar ou devolver.', 403);
  const client = clientOr404(admin, clientId);
  const sub = submissionOf(clientId);
  if (!sub) throw new BenchmarkError('Este cliente ainda não começou o benchmarking.');
  const next = { devolver: 'correcao', aprovar: 'aprovado', reabrir: 'rascunho' }[action];
  if (!next) throw new BenchmarkError('Ação inválida.');
  if (action === 'devolver' && !String(text || '').trim()) throw new BenchmarkError('Explique o que precisa ser corrigido.');
  sub.status = next;
  sub.decidedAt = new Date().toISOString();
  sub.decidedBy = admin.id;
  log(sub, admin, action, text);
  // Quem preenche fica sabendo pelo botão Mensagens do portal, com o link da ferramenta.
  const aviso = {
    devolver: `O Benchmarking ${sub.ano} de ${client.name} voltou para correção:\n\n${String(text).trim()}`,
    aprovar: `O Benchmarking ${sub.ano} de ${client.name} foi aprovado. Obrigado pelo envio!${text ? `\n\n${String(text).trim()}` : ''}`,
    reabrir: `O Benchmarking ${sub.ano} de ${client.name} foi reaberto para edição.${text ? `\n\n${String(text).trim()}` : ''}`,
  }[action];
  const people = db().users.filter((u) => u.role === 'client' && kindOf(u) === 'cliente' && u.active && u.clientIds?.includes(clientId));
  for (const u of people) await adminSend(admin, u.id, { text: aviso, origin: { type: 'benchmark', action } }, { persist: false });
  await save();
  return view(admin, client, sub);
}

// Qualquer pessoa do Benchmarking cadastra fazenda (só para o benchmarking: entra participando,
// sem relatórios). Responsável padrão: Time = quem cadastrou (ou alguém da equipe que ele escolher);
// Canais e Cliente = a pessoa do Time Cargill que criou o login dele (sem ela, o gestor a quem
// responde) — e a fazenda entra nas dele (clientIds) para ele continuar vendo. O Time e o admin
// trocam o responsável depois (setOwner). Os logins são criados pelos gestores (aba Equipe).
// Nome repetido é recusado para não duplicar um cliente que já existe.
const foldName = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
function ownerFor(user, ownerId) {
  if (user.role !== 'admin' && kindOf(user) !== 'cargill') {
    const cargill = (id) => db().users.find((u) => u.id === id && u.active && kindOf(u) === 'cargill');
    return (cargill(user.createdBy) || cargill(user.reportsTo))?.id || null;
  }
  const id = ownerId || (user.role === 'admin' ? null : user.id);
  if (!id) return null;
  if (!ownerCandidates(user).some((u) => u.id === id)) throw new BenchmarkError('O responsável precisa ser você ou alguém da sua equipe (Time ou Canais Cargill).', 403);
  return id;
}

export async function createClientFor(user, { name, ownerId } = {}) {
  if (!canCreateFarm(user) || !canUseBenchmark(user)) throw new BenchmarkError('Você não participa do benchmarking.', 403);
  assertAberta(user);
  const nome = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (nome.length < 3) throw new BenchmarkError('Informe o nome do cliente (empresa + unidade do confinamento).');
  const data = db();
  if (data.clients.some((c) => foldName(c.name) === foldName(nome))) throw new BenchmarkError('Já existe um cliente com esse nome no portal. Se é o mesmo, peça ao admin para incluí-lo na sua equipe.', 409);
  const client = { id: newId(), name: nome, rlsUsername: '', rlsRoles: [], reportIds: [], active: true, tagIds: [], ccvFarms: [], benchmark: true, bmkOwner: ownerFor(user, ownerId), createdBy: user.id, createdVia: 'benchmark', createdAt: new Date().toISOString() };
  data.clients.push(client);
  // Cliente e Canais ficam com a fazenda que cadastraram pelo vínculo (clientIds); o Time, pelo responsável.
  if (user.role !== 'admin' && kindOf(user) !== 'cargill') {
    const me = data.users.find((u) => u.id === user.id);
    me.clientIds = [...new Set([...(me.clientIds || []), client.id])];
  }
  await save();
  return { id: client.id, name: client.name };
}

// Troca o responsável de uma fazenda que a pessoa enxerga (Time Cargill e admin).
export async function setOwner(user, clientId, { ownerId } = {}) {
  if (!canSetOwner(user)) throw new BenchmarkError('Só o Time Cargill define o responsável pela fazenda.', 403);
  const client = clientOr404(user, clientId);
  client.bmkOwner = ownerFor(user, ownerId);
  await save();
  return { id: client.id, bmkOwner: client.bmkOwner };
}

// Andamento dos clientes participantes: todos para o admin; para os demais, as fazendas que
// enxergam (participantClients).
export function adminList({ clientIds = null } = {}) {
  const ano = settings().ano;
  return db()
    .clients.filter((c) => c.benchmark && (!clientIds || (clientIds.includes(c.id) && c.active !== false)))
    .map((c) => {
      const sub = db().bmkSubmissions.find((s) => s.clientId === c.id && s.ano === ano) || null;
      return {
        clientId: c.id,
        client: c.name,
        active: c.active !== false,
        ownerId: c.bmkOwner || null,
        owner: userName(c.bmkOwner),
        status: sub?.status || 'nao_iniciado',
        updatedAt: sub?.updatedAt || null,
        updatedBy: userName(sub?.updatedBy),
        submittedAt: sub?.submittedAt || null,
        ...summary(sub),
      };
    })
    .sort((a, b) => a.client.localeCompare(b.client, 'pt-BR'));
}

// Tudo do ano, para o Excel consolidado (os cálculos são refeitos no navegador do admin).
export function exportAll() {
  const ano = settings().ano;
  const clients = new Map(db().clients.map((c) => [c.id, c.name]));
  return {
    ano,
    settings: settings(),
    submissions: db()
      .bmkSubmissions.filter((s) => s.ano === ano && clients.has(s.clientId))
      .map((s) => ({ client: clients.get(s.clientId), clientId: s.clientId, status: s.status, engorda: s.engorda, recria: s.recria, respostas: s.respostas, submittedAt: s.submittedAt || null })),
  };
}

const numOr = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// Limites e listas (aba Configurações da planilha), editados no admin.
export async function saveSettings(body = {}) {
  const cur = settings();
  const next = { ...cur };
  if (body.ano !== undefined) {
    const ano = Number.parseInt(body.ano, 10);
    if (!(ano >= 2020 && ano <= 2100)) throw new BenchmarkError('Ano inválido.');
    next.ano = ano;
  }
  if (body.aberta !== undefined) next.aberta = body.aberta !== false;
  if (body.prazo !== undefined) next.prazo = /^\d{4}-\d{2}-\d{2}$/.test(body.prazo || '') ? body.prazo : null;
  if (body.tolerancias) for (const k of Object.keys(cur.tolerancias)) next.tolerancias[k] = Math.max(0, numOr(body.tolerancias[k], cur.tolerancias[k]));
  if (body.faixas) {
    for (const k of Object.keys(cur.faixas)) {
      const [min, max] = Array.isArray(body.faixas[k]) ? body.faixas[k] : cur.faixas[k];
      const a = numOr(min, cur.faixas[k][0]);
      const b = numOr(max, cur.faixas[k][1]);
      if (a >= b) throw new BenchmarkError('Em cada faixa, o mínimo precisa ser menor que o máximo.');
      next.faixas[k] = [a, b];
    }
  }
  if (body.listas) {
    for (const k of Object.keys(cur.listas)) {
      if (!Array.isArray(body.listas[k])) continue;
      const items = [...new Set(body.listas[k].map((x) => String(x).trim().slice(0, 60)).filter(Boolean))];
      if (!items.length) throw new BenchmarkError('Cada lista precisa de ao menos um item.');
      next.listas[k] = items;
    }
  }
  db().bmkSettings = next;
  await save();
  return next;
}

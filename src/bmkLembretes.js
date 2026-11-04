// Cobrança do Benchmarking: lembretes para quem ainda não enviou (não iniciados, em preenchimento ou em
// correção), pelas Mensagens do portal. O admin manda pelo acompanhamento (um, vários ou todos os pendentes);
// com o lembrete automático ligado (Ciclo, limites e listas), sai sozinho X dias antes do prazo.
// Vão para os logins do participante e, se marcado, para o responsável (Time ou Canais), que acompanha a
// fazenda; participante sem login avisa só o responsável. Cada envio fica em db().bmkLembretes e no Histórico.
import { adminSend } from './chat.js';
import { adminList, settings } from './benchmark.js';
import { kindOf } from './bmkTeam.js';
import { db, newId, save } from './store.js';

const DAY = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const AUTO_FROM_HOUR = 8; // o automático só sai a partir das 8h (Brasília)
export const PENDENTES = ['nao_iniciado', 'rascunho', 'correcao'];
// Remetente do automático: sem usuário, a conversa mostra "Equipe Probeef".
const SISTEMA = { id: 'bmk-lembrete-automatico', role: 'admin' };

export class LembreteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const horaSP = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date()));
const dataBR = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
export const diasAtePrazo = (prazo) => (prazo ? Math.round((Date.parse(`${prazo}T12:00:00Z`) - Date.parse(`${hojeSP()}T12:00:00Z`)) / DAY) : null);

// O que falta, em palavras (para o texto do lembrete).
function pendencias(p) {
  const lotes = p.lotesEngorda + p.lotesRecria;
  const partes = [lotes ? `${lotes} lote(s) lançado(s)` : 'nenhum lote lançado'];
  if (p.lotesComErro) partes.push(`${p.lotesComErro} lote(s) com erro`);
  partes.push(p.questionario.faltando ? `faltam ${p.questionario.faltando} pergunta(s) obrigatória(s) do questionário` : 'questionário completo');
  return partes.join(', ');
}

function prazoTexto(prazo) {
  const d = diasAtePrazo(prazo);
  if (d === null) return '';
  if (d > 1) return ` O prazo de envio é ${dataBR(prazo)} (faltam ${d} dias).`;
  if (d === 1) return ` O prazo de envio é amanhã, ${dataBR(prazo)}.`;
  if (d === 0) return ` O prazo de envio é hoje, ${dataBR(prazo)}.`;
  return ` O prazo de envio era ${dataBR(prazo)}.`;
}

// Texto padrão de cada situação. {fazenda}, {ano}, {prazo} e {pendencias} também valem no texto do admin.
export const MODELOS = {
  nao_iniciado: 'Olá! O Benchmarking {ano} de {fazenda} ainda não foi começado.{prazo} Entre no portal, em Benchmarking, para lançar os lotes e responder o questionário. Se tiver dúvida, é só responder esta mensagem.',
  rascunho: 'Olá! O Benchmarking {ano} de {fazenda} está em preenchimento: {pendencias}.{prazo} Quando estiver tudo certo, clique em "Enviar para validação". Se tiver dúvida, é só responder esta mensagem.',
  correcao: 'Olá! O Benchmarking {ano} de {fazenda} voltou para correção e ainda aguarda os ajustes ({pendencias}).{prazo} Depois de corrigir, envie de novo para validação. Se tiver dúvida, é só responder esta mensagem.',
};

const montar = (texto, p, s) =>
  String(texto)
    .replaceAll('{fazenda}', p.client)
    .replaceAll('{ano}', String(s.ano))
    .replaceAll('{prazo}', prazoTexto(s.prazo))
    .replaceAll('{pendencias}', pendencias(p))
    .trim();

const participantes = (clientId) => db().users.filter((u) => u.role === 'client' && kindOf(u) === 'cliente' && u.active && u.clientIds?.includes(clientId));
const responsavel = (p) => db().users.find((u) => u.id === p.ownerId && u.active && u.role === 'client') || null;

// Último lembrete de cada participante no ciclo (para a coluna do acompanhamento).
export function ultimosLembretes(ano) {
  const out = new Map();
  for (const l of db().bmkLembretes || []) if (l.ano === ano && !l.pulado && (!out.has(l.clientId) || l.at > out.get(l.clientId).at)) out.set(l.clientId, l);
  return out;
}

// Envia para uma lista de participantes. texto vazio = o modelo de cada situação.
// Devolve o que foi enviado e quem ficou sem ninguém para receber.
async function enviar(admin, lista, { texto = '', responsavel: comResponsavel = true, auto = null } = {}) {
  const s = settings();
  const enviados = [];
  const semDestino = [];
  for (const p of lista) {
    const msg = montar(texto || MODELOS[p.status], p, s);
    const pessoas = participantes(p.clientId);
    const dono = comResponsavel ? responsavel(p) : null;
    for (const u of pessoas) await adminSend(admin, u.id, { text: msg, origin: { type: 'benchmark', action: 'lembrete' } }, { persist: false });
    if (dono && !pessoas.some((u) => u.id === dono.id)) {
      const aviso = pessoas.length ? `Lembrete enviado para ${p.client} (você é o responsável):\n\n${msg}` : `${p.client} não tem login no portal para receber o lembrete. Você é o responsável: fale com a fazenda.\n\n${msg}`;
      await adminSend(admin, dono.id, { text: aviso, origin: { type: 'benchmark', action: 'lembrete' } }, { persist: false });
    }
    const n = pessoas.length + (dono && !pessoas.some((u) => u.id === dono.id) ? 1 : 0);
    if (!n) {
      semDestino.push(p.client);
      continue;
    }
    const registro = { id: newId(), clientId: p.clientId, ano: s.ano, at: new Date().toISOString(), by: auto ? null : admin.id, auto, status: p.status, participantes: pessoas.length, responsavel: Boolean(dono) };
    db().bmkLembretes = [...(db().bmkLembretes || []), registro].slice(-5000);
    // No Histórico do participante (quando ele já começou).
    const sub = db().bmkSubmissions.find((x) => x.clientId === p.clientId && x.ano === s.ano);
    if (sub) sub.messages.push({ id: newId(), at: registro.at, by: registro.by, role: 'admin', action: 'lembrete', text: `${auto ? `Lembrete automático (${auto} dia(s) antes do prazo)` : 'Lembrete'} enviado para ${pessoas.length} login(s) do participante${dono ? ' e o responsável' : ''}.` });
    enviados.push({ clientId: p.clientId, client: p.client, pessoas: n });
  }
  await save();
  return { enviados, semDestino };
}

export async function sendReminders(admin, { clientIds, texto, responsavel: comResponsavel = true } = {}) {
  if (!Array.isArray(clientIds) || !clientIds.length) throw new LembreteError('Escolha ao menos um participante.');
  const texto2 = String(texto || '').trim().slice(0, 2000);
  const lista = adminList().filter((p) => clientIds.includes(p.clientId) && p.active && PENDENTES.includes(p.status));
  if (!lista.length) throw new LembreteError('Nenhum dos escolhidos está pendente (não iniciado, em preenchimento ou em correção).');
  return enviar(admin, lista, { texto: texto2, responsavel: comResponsavel !== false });
}

// Prévia do texto para a janela do admin (o primeiro escolhido de cada situação).
export function previewReminders({ clientIds, texto } = {}) {
  const s = settings();
  const lista = adminList().filter((p) => (!clientIds || clientIds.includes(p.clientId)) && p.active && PENDENTES.includes(p.status));
  const porStatus = {};
  for (const p of lista) porStatus[p.status] ??= montar(String(texto || '').trim() || MODELOS[p.status], p, s);
  return {
    porStatus,
    semLogin: lista.filter((p) => !participantes(p.clientId).length).map((p) => ({ client: p.client, temResponsavel: Boolean(responsavel(p)) })),
  };
}

// Automático: a cada hora confere se chegou um dos dias marcados antes do prazo. Se o servidor ficou fora
// no dia, manda na volta (uma vez só, mesmo que mais de um dia marcado tenha passado).
export async function autoReminders() {
  const s = settings();
  const cfg = s.lembretes || {};
  if (!cfg.auto || !s.prazo || s.aberta === false || horaSP() < AUTO_FROM_HOUR) return null;
  const faltam = diasAtePrazo(s.prazo);
  if (faltam < 0) return null;
  const dias = (cfg.dias || []).filter((d) => faltam <= d);
  if (!dias.length) return null;
  const jaFeitos = new Set((db().bmkLembretes || []).filter((l) => l.ano === s.ano && l.auto).map((l) => `${l.clientId}:${l.auto}`));
  const lista = adminList().filter((p) => p.active && PENDENTES.includes(p.status) && dias.some((d) => !jaFeitos.has(`${p.clientId}:${d}`)));
  if (!lista.length) return null;
  const marco = Math.min(...dias);
  const r = await enviar(SISTEMA, lista, { auto: marco });
  // Os dias marcados que já passaram contam como feitos (não manda dois lembretes no mesmo dia).
  for (const p of lista) for (const d of dias) if (d !== marco && r.enviados.some((e) => e.clientId === p.clientId)) db().bmkLembretes.push({ id: newId(), clientId: p.clientId, ano: s.ano, at: new Date().toISOString(), by: null, auto: d, status: p.status, participantes: 0, responsavel: false, pulado: true });
  await save();
  return r;
}

export function startReminderJob() {
  const run = () => autoReminders().catch((err) => console.error('Falha no lembrete automático do Benchmarking:', err.message));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, CHECK_EVERY_MS).unref();
}

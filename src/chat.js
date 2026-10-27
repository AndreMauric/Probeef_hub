// Mensagens entre cada usuário de cliente e a equipe de administradores do portal.
// Uma conversa por usuário (chatThreads[].userId); qualquer admin lê e responde. As mensagens
// ficam em chatMessages, com o "contexto" de onde o usuário estava (relatório e fazenda do CCV).
// Mensagens do admin podem levar um PDF anexo (alertas CCV): o arquivo fica na pasta "files" ao
// lado do db.json e a mensagem guarda só { id, name, size }.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { db, newId, save } from './store.js';

const FILE_DIR = path.join(path.dirname(config.dataFile), 'files');

const MAX_TEXT = 2000;
const MAX_MESSAGES = 20000; // as mais antigas saem do arquivo quando passar disso
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 30; // mensagens de um usuário a cada 10 minutos

class ChatError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function thread(userId, { create = false } = {}) {
  const data = db();
  let t = data.chatThreads.find((x) => x.userId === userId);
  if (!t && create) {
    t = { userId, status: 'aberta', lastAt: null, userReadAt: null, adminReadAt: null };
    data.chatThreads.push(t);
  }
  return t || null;
}

const messagesOf = (userId) => db().chatMessages.filter((m) => m.userId === userId);

function cleanText(text) {
  const value = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!value) throw new ChatError('Escreva a mensagem.');
  if (value.length > MAX_TEXT) throw new ChatError(`A mensagem passa de ${MAX_TEXT} caracteres.`);
  return value;
}

// Ferramentas que podem ser citadas como contexto (além dos relatórios).
const TOOL_CONTEXT = { benchmark: 'Benchmarking Confinamento' };

// Onde o usuário estava ao escrever: só ids/nomes conhecidos, nunca texto livre do navegador.
function cleanContext(context, user) {
  if (!context || typeof context !== 'object') return null;
  if (context.tool) {
    if (!TOOL_CONTEXT[context.tool]) return null;
    // O cliente citado precisa ser dele (e participar do benchmarking); senão vai só a ferramenta.
    const client = db().clients.find((c) => c.id === context.clientId && c.benchmark && (user.role === 'admin' || user.clientIds.includes(c.id)));
    return { tool: context.tool, toolName: TOOL_CONTEXT[context.tool], ...(client ? { clientId: client.id, clientName: client.name } : {}) };
  }
  const report = db().reports.find((r) => r.id === context.reportId);
  if (!report) return null;
  let farm = report.kind === 'ccv' && typeof context.farm === 'string' ? context.farm.slice(0, 120) : null;
  if (user.role !== 'admin') {
    // O usuário só cita relatórios (e fazendas do CCV) dos clientes dele.
    const own = db().clients.filter((c) => user.clientIds.includes(c.id) && c.reportIds.includes(report.id));
    if (!own.length) return null;
    if (farm && !own.some((c) => (c.ccvFarms || []).includes(farm))) farm = null;
  }
  return { reportId: report.id, reportName: report.name, ...(farm ? { farm } : {}) };
}

function append(userId, { from, authorId, text, context = null, origin = null, attachment = null }) {
  const data = db();
  const t = thread(userId, { create: true });
  const message = { id: newId(), userId, from, authorId, text, at: new Date().toISOString(), ...(context ? { context } : {}), ...(origin ? { origin } : {}), ...(attachment ? { attachment } : {}) };
  data.chatMessages.push(message);
  if (data.chatMessages.length > MAX_MESSAGES) data.chatMessages.splice(0, data.chatMessages.length - MAX_MESSAGES);
  t.lastAt = message.at;
  // Mensagem nova do usuário reabre a conversa; quem escreve já leu tudo até ali.
  if (from === 'user') {
    t.status = 'aberta';
    t.userReadAt = message.at;
  } else {
    t.adminReadAt = message.at;
  }
  return message;
}

// Nome de quem escreveu, para mostrar na conversa (o usuário vê o nome do admin que respondeu).
function withAuthor(message) {
  const author = db().users.find((u) => u.id === message.authorId);
  return { ...message, authorName: author?.name || (message.from === 'admin' ? 'Equipe Probeef' : 'Usuário removido') };
}

const unreadFor = (userId, side) => {
  const t = thread(userId);
  const since = side === 'user' ? t?.userReadAt : t?.adminReadAt;
  const other = side === 'user' ? 'admin' : 'user';
  return messagesOf(userId).filter((m) => m.from === other && (!since || m.at > since)).length;
};

// ---------- Lado do usuário ----------

export function userConversation(user) {
  return { messages: messagesOf(user.id).map(withAuthor), unread: unreadFor(user.id, 'user') };
}

export const userUnread = (user) => unreadFor(user.id, 'user');

export async function userSend(user, { text, context }) {
  const recent = messagesOf(user.id).filter((m) => m.from === 'user' && Date.now() - Date.parse(m.at) < RATE_WINDOW_MS).length;
  if (recent >= RATE_MAX) throw new ChatError('Você mandou muitas mensagens seguidas. Aguarde alguns minutos.', 429);
  const message = append(user.id, { from: 'user', authorId: user.id, text: cleanText(text), context: cleanContext(context, user) });
  await save();
  return withAuthor(message);
}

export async function userMarkRead(user) {
  const t = thread(user.id);
  if (!t) return;
  t.userReadAt = new Date().toISOString();
  await save();
}

// ---------- Lado do admin ----------

export function adminInbox() {
  const { users, clients, chatThreads } = db();
  const threads = chatThreads
    .map((t) => {
      const user = users.find((u) => u.id === t.userId);
      if (!user) return null;
      const last = messagesOf(t.userId).at(-1) || null;
      return {
        userId: t.userId,
        name: user.name,
        email: user.email,
        active: user.active,
        clients: clients.filter((c) => user.clientIds?.includes(c.id)).map((c) => c.name),
        status: t.status,
        lastAt: t.lastAt,
        last: last ? { from: last.from, text: last.text.replace(/\*/g, '').replace(/\s+/g, ' ').slice(0, 140) } : null,
        unread: unreadFor(t.userId, 'admin'),
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
  return { threads, unread: threads.reduce((n, t) => n + t.unread, 0), waiting: threads.filter((t) => t.unread > 0).length };
}

function clientUserOr404(userId) {
  const user = db().users.find((u) => u.id === userId);
  if (!user || user.role !== 'client') throw new ChatError('Usuário não encontrado.', 404);
  return user;
}

export function adminConversation(userId) {
  const user = clientUserOr404(userId);
  const t = thread(userId);
  return { user: { id: user.id, name: user.name, email: user.email }, status: t?.status || 'aberta', userReadAt: t?.userReadAt || null, messages: messagesOf(userId).map(withAuthor) };
}

export async function adminMarkRead(userId) {
  const t = thread(userId);
  if (!t) return;
  t.adminReadAt = new Date().toISOString();
  await save();
}

// origin: de onde veio a mensagem do admin (ex.: { type: 'ccv', farm }), para mostrar na conversa.
// attachment: o que saveChatFile devolveu (o mesmo arquivo pode ir em várias conversas).
export async function adminSend(admin, userId, { text, context = null, origin = null, attachment = null }, { persist = true } = {}) {
  clientUserOr404(userId);
  const message = append(userId, { from: 'admin', authorId: admin.id, text: cleanText(text), context: cleanContext(context, admin), origin, attachment });
  if (persist) await save();
  return withAuthor(message);
}

export async function setThreadStatus(userId, status) {
  clientUserOr404(userId);
  if (!['aberta', 'resolvida'].includes(status)) throw new ChatError('Situação inválida.');
  thread(userId, { create: true }).status = status;
  await save();
}

// ---------- Anexos (PDF) ----------

export async function saveChatFile(buffer, name) {
  const id = newId();
  await fs.mkdir(FILE_DIR, { recursive: true });
  await fs.writeFile(path.join(FILE_DIR, `${id}.pdf`), buffer);
  return { id, name, size: buffer.length };
}

// Arquivo anexado a uma mensagem da conversa deste usuário (nunca de outra conversa).
export function chatFile(userId, fileId) {
  const message = messagesOf(userId).find((m) => m.attachment?.id === fileId);
  if (!message) throw new ChatError('Arquivo não encontrado.', 404);
  return { path: path.join(FILE_DIR, `${message.attachment.id}.pdf`), name: message.attachment.name };
}

// Usuário excluído: some com a conversa dele (e com os anexos que só ele tinha).
export function forgetChat(userId) {
  const data = db();
  const files = new Set(messagesOf(userId).map((m) => m.attachment?.id).filter(Boolean));
  data.chatThreads = data.chatThreads.filter((t) => t.userId !== userId);
  data.chatMessages = data.chatMessages.filter((m) => m.userId !== userId);
  for (const m of data.chatMessages) if (m.attachment) files.delete(m.attachment.id);
  for (const id of files) fs.unlink(path.join(FILE_DIR, `${id}.pdf`)).catch(() => {});
}

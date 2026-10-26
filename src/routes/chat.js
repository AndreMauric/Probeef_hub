// Mensagens do usuário com a equipe do portal (ver src/chat.js). As rotas do lado do admin
// ficam em admin.js (/api/admin/chat).
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { chatFile, userConversation, userMarkRead, userSend, userUnread } from '../chat.js';

export const chatRouter = Router();

chatRouter.use(requireAuth);

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// Admins conversam pela aba Mensagens do admin, não por aqui.
chatRouter.use((req, res, next) => {
  if (req.user.role !== 'client') return res.status(403).json({ error: 'Administradores respondem pela aba Mensagens do admin.' });
  next();
});

chatRouter.get('/', (req, res) => res.json(userConversation(req.user)));

// Consulta leve, feita de tempos em tempos para o contador do botão Mensagens.
chatRouter.get('/unread', (req, res) => res.json({ unread: userUnread(req.user) }));

chatRouter.post('/', route(async (req, res) => {
  // Admin "entrando como" o usuário só lê: não escreve em nome dele.
  if (req.impersonator) return res.status(403).json({ error: 'Você está vendo o portal como este usuário. Responda pela aba Mensagens do admin.' });
  res.status(201).json({ message: await userSend(req.user, req.body || {}) });
}));

// PDF anexado pela equipe (só das mensagens da conversa deste usuário).
chatRouter.get('/files/:fileId', (req, res, next) => {
  try {
    const file = chatFile(req.user.id, req.params.fileId);
    res.download(file.path, file.name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Arquivo não encontrado.' });
    });
  } catch (err) {
    next(err);
  }
});

chatRouter.post('/read', route(async (req, res) => {
  if (!req.impersonator) await userMarkRead(req.user);
  res.json({ unread: userUnread(req.user) });
}));

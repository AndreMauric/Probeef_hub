import path from 'node:path';
import cookieSession from 'cookie-session';
import express from 'express';
import helmet from 'helmet';
import { loadAccessLog } from './src/accessLog.js';
import { generatePassword, hashPassword, loadUser } from './src/auth.js';
import { startDailyBackups } from './src/backup.js';
import { config } from './src/config.js';
import { adminRouter } from './src/routes/admin.js';
import { assistantRouter } from './src/routes/assistant.js';
import { authRouter } from './src/routes/auth.js';
import { ccvRouter } from './src/routes/ccv.js';
import { chatRouter } from './src/routes/chat.js';
import { confinamentoRouter } from './src/routes/confinamento.js';
import { portalRouter } from './src/routes/portal.js';
import { teamRouter } from './src/routes/team.js';
import { whatsappRouter } from './src/routes/whatsapp.js';
import { startRefreshWatcher } from './src/bot/notify.js';
import { startDataHealthWatcher } from './src/dataHealth.js';
import { resealAll } from './src/secretBox.js';
import { db, load, newId, save } from './src/store.js';

await load();
await loadAccessLog();

// Troca da chave de criptografia (KEY_ENCRYPTION_SECRET_OLD → KEY_ENCRYPTION_SECRET).
const resealed = resealAll(db().users.filter((u) => u.anthropicKey?.box).map((u) => u.anthropicKey));
if (resealed) {
  await save();
  console.log(`Chave de criptografia trocada: ${resealed} segredo(s) recriptografado(s). Já pode apagar KEY_ENCRYPTION_SECRET_OLD.`);
}

// Na primeira execução em um servidor novo, cria o administrador indicado em BOOTSTRAP_ADMIN_EMAIL
// e mostra a senha temporária no log. Não faz nada se já existir algum administrador.
const bootstrapEmail = String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
if (bootstrapEmail && !db().users.some((u) => u.role === 'admin')) {
  const password = generatePassword();
  db().users.push({
    id: newId(),
    email: bootstrapEmail,
    name: 'Administrador',
    role: 'admin',
    clientIds: [],
    confinamento: { status: 'approved', requestedAt: null, decidedAt: new Date().toISOString() },
    active: true,
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    sessionVersion: 1,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  });
  await save();
  console.log(`Administrador ${bootstrapEmail} criado. Senha temporária: ${password}`);
}

const app = express();
app.disable('x-powered-by');
if (config.isProduction) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ['https://app.powerbi.com', 'https://*.powerbi.com'],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
  }),
);

// Webhook do WhatsApp: corpo bruto (para conferir a assinatura da Meta), sem sessão nem CSRF.
app.use('/webhooks/whatsapp', express.raw({ type: '*/*', limit: '1mb' }), whatsappRouter);

app.use(
  cookieSession({
    name: 'mybi.sid',
    secret: config.sessionSecret,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: 12 * 60 * 60 * 1000,
  }),
);
app.use(loadUser);

// A restauração de backup recebe o arquivo inteiro, mas só de um administrador logado;
// todas as outras requisições aceitam apenas corpos pequenos.
const smallJson = express.json({ limit: '100kb' });
const largeJson = express.json({ limit: '20mb' });
app.use((req, res, next) => {
  const restore = req.path === '/api/admin/restore' && req.user?.role === 'admin';
  return (restore ? largeJson : smallJson)(req, res, next);
});

// Envio de imagens: corpo bruto, só para administradores logados.
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const rawImage = express.raw({ type: IMAGE_TYPES, limit: '5mb' });
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/admin/images' && req.user?.role === 'admin') return rawImage(req, res, next);
  next();
});

// Proteção contra CSRF: toda requisição que altera dados precisa ser JSON enviado pelo próprio site.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  // Imagens chegam como image/*; navegadores não conseguem enviar esse tipo de outro site sem permissão (CORS).
  if (req.path === '/admin/images' && req.method === 'POST' && req.is(IMAGE_TYPES)) return next();
  if (!req.is('application/json')) return res.status(415).json({ error: 'Envie os dados como JSON.' });
  next();
});

app.get('/api/config', (_req, res) => {
  res.json({ portalName: config.portalName, needsSetup: !db().users.some((u) => u.role === 'admin') });
});
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/assistant', assistantRouter);
app.use('/api/team', teamRouter);
app.use('/api/confinamento', confinamentoRouter);
app.use('/api/ccv', ccvRouter);
app.use('/api/chat', chatRouter);
app.use('/api', portalRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.get('/vendor/powerbi.min.js', (_req, res) => {
  res.sendFile(path.join(config.root, 'node_modules/powerbi-client/dist/powerbi.min.js'));
});
app.get('/vendor/chart.min.js', (_req, res) => {
  res.sendFile(path.join(config.root, 'node_modules/chart.js/dist/chart.umd.js'));
});

// 4M Confinamento: só para quem está logado e já foi liberado (ou é admin); ver src/routes/confinamento.js.
app.use(
  '/confinamento',
  (req, res, next) => {
    if (!req.user) return res.redirect('/portal');
    if (req.user.role !== 'admin' && req.user.confinamento?.status !== 'approved') return res.redirect('/portal#confinamento');
    next();
  },
  express.static(path.join(config.root, 'public/confinamento'), { extensions: ['html'] }),
);

app.use(express.static(path.join(config.root, 'public'), { extensions: ['html'] }));

// Tratamento central de erros.
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  const message = status >= 500 && !err.status ? 'Erro interno. Tente novamente em instantes.' : err.message;
  res.status(status).json({ error: message });
});

startDailyBackups();
startRefreshWatcher();
startDataHealthWatcher();

app.listen(config.port, () => {
  console.log(`${config.portalName} rodando em http://localhost:${config.port}`);
  if (!db().users.some((u) => u.role === 'admin')) {
    console.log('Nenhum administrador cadastrado. Rode: npm run create-admin -- seu@email.com "Seu Nome"');
  }
});

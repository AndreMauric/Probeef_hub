// "Minha equipe": o gestor de um cliente cadastra e gerencia as pessoas das fazendas dele,
// sem depender do administrador. Limites:
//   - só vê e altera usuários de cliente que tenham acesso a pelo menos uma das fazendas dele;
//   - só concede acesso às fazendas que ele mesmo tem;
//   - não altera administradores, outros gestores nem a si mesmo;
//   - só desativa ou troca a senha de quem tem acesso apenas a fazendas dele.
import { Router } from 'express';
import { generatePassword, hashPassword, userClients } from '../auth.js';
import { db, newId, save } from '../store.js';

export const teamRouter = Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v, max) => String(v ?? '').trim().slice(0, max);

class TeamError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

teamRouter.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  if (req.user.role !== 'client' || !req.user.isManager) {
    return res.status(403).json({ error: 'Só os gestores da empresa podem gerenciar a equipe.' });
  }
  next();
});

const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// Fazendas (clientes ativos) do gestor.
const scopeOf = (manager) => new Set(userClients(manager).map((c) => c.id));

function audit(req, action, userId) {
  const data = db();
  data.audit = [...(data.audit || []), { at: new Date().toISOString(), action, managerId: req.user.id, adminId: req.impersonator?.id || null, userId }].slice(-1000);
}

function teamMember(req, id) {
  const scope = scopeOf(req.user);
  const user = db().users.find((u) => u.id === id && u.role === 'client' && u.clientIds?.some((c) => scope.has(c)));
  if (!user) throw new TeamError('Pessoa não encontrada na sua equipe.', 404);
  return { user, scope };
}

// Pode alterar acesso e senha? Só quem não é gestor, não é o próprio e só tem fazendas do gestor.
function fullyManaged(req, user, scope) {
  if (user.id === req.user.id) throw new TeamError('Use "Trocar senha" no menu Conta para alterar o seu próprio acesso.');
  if (user.isManager) throw new TeamError('Gestores só podem ser alterados pelo administrador do portal.');
  return user.clientIds.every((c) => scope.has(c));
}

teamRouter.get('/', (req, res) => {
  const scope = scopeOf(req.user);
  const clients = userClients(req.user).map((c) => ({ id: c.id, name: c.name }));
  const users = db()
    .users.filter((u) => u.role === 'client' && u.clientIds?.some((c) => scope.has(c)))
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      active: u.active,
      isManager: Boolean(u.isManager),
      isMe: u.id === req.user.id,
      clientIds: u.clientIds.filter((c) => scope.has(c)),
      otherClients: u.clientIds.filter((c) => !scope.has(c)).length,
      lastLoginAt: u.lastLoginAt || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  res.json({ clients, users });
});

teamRouter.post('/', route(async (req, res) => {
  const scope = scopeOf(req.user);
  const name = text(req.body?.name, 120);
  const email = text(req.body?.email, 200).toLowerCase();
  const clientIds = [...new Set(Array.isArray(req.body?.clientIds) ? req.body.clientIds : [])].filter((c) => scope.has(c));
  if (!name) throw new TeamError('Informe o nome da pessoa.');
  if (!EMAIL.test(email)) throw new TeamError('Informe um e-mail válido.');
  if (!clientIds.length) throw new TeamError('Escolha ao menos uma fazenda.');
  if (db().users.some((u) => u.email === email)) {
    throw new TeamError('Este e-mail já tem acesso ao portal. Peça ao administrador para incluir a pessoa nas suas fazendas.');
  }
  const password = generatePassword();
  const user = {
    id: newId(),
    email,
    name,
    role: 'client',
    clientIds,
    isManager: false,
    active: true,
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    sessionVersion: 1,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    lastLoginAt: null,
  };
  db().users.push(user);
  audit(req, 'team.create', user.id);
  await save();
  res.status(201).json({ user: { id: user.id, name, email }, password });
}));

teamRouter.put('/:id', route(async (req, res) => {
  const { user, scope } = teamMember(req, req.params.id);
  const full = fullyManaged(req, user, scope);
  const name = text(req.body?.name, 120);
  if (!name) throw new TeamError('Informe o nome da pessoa.');
  // Fazendas: mantém as de fora do gestor e troca só as dele.
  const mine = [...new Set(Array.isArray(req.body?.clientIds) ? req.body.clientIds : [])].filter((c) => scope.has(c));
  const others = user.clientIds.filter((c) => !scope.has(c));
  const clientIds = [...others, ...mine];
  if (!clientIds.length) throw new TeamError('A pessoa precisa ter ao menos uma fazenda. Para tirar o acesso, desative.');
  const active = req.body?.active !== false;
  if (active !== user.active && !full) throw new TeamError('Esta pessoa também tem acesso a fazendas de outra empresa; só o administrador pode desativá-la.');
  const revoke = active !== user.active;
  Object.assign(user, { name, clientIds, active });
  if (revoke) user.sessionVersion += 1;
  audit(req, 'team.update', user.id);
  await save();
  res.json({ ok: true });
}));

teamRouter.post('/:id/reset-password', route(async (req, res) => {
  const { user, scope } = teamMember(req, req.params.id);
  if (!fullyManaged(req, user, scope)) throw new TeamError('Esta pessoa também tem acesso a fazendas de outra empresa; só o administrador pode trocar a senha dela.');
  const password = generatePassword();
  user.passwordHash = await hashPassword(password);
  user.mustChangePassword = true;
  user.sessionVersion += 1;
  audit(req, 'team.reset-password', user.id);
  await save();
  res.json({ password });
}));

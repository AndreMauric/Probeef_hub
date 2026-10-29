// Equipes do Benchmarking: quem é cada pessoa (perfil), a quem responde e o que pode fazer.
//
// Perfis (user.kind, só para role 'client'): 'cliente' (Cliente Cargill: a fazenda), 'cargill'
// (Time Cargill) e 'canal' (Canais Cargill). Poderes, só para o Time Cargill:
//   bmkGestor      — cria usuários de Canais e de Cliente abaixo dele (Time Cargill só o admin cria);
//   bmkValidator   — vê e valida as fazendas da equipe do gestor direto dele (e da própria, se for gestor);
//   bmkCreateTeam  — pode tornar outra pessoa gestor (montar uma equipe nova).
// Hierarquia: user.reportsTo aponta para um gestor; a equipe de alguém é todo mundo abaixo dele,
// em qualquer nível. Cada fazenda do benchmarking tem um responsável (client.bmkOwner: alguém do
// Time ou de Canais) e é vista por ele e por quem está acima dele. Canais não cria nada: usa o
// Benchmarking nas fazendas em que é responsável. O cliente nunca cria usuário nem fazenda.
// Quem o gestor cria (Canais e Cliente) é "só Benchmarking" (user.bmkOnly): não acessa relatórios,
// CCV nem ferramentas, mesmo que a fazenda também seja cliente da plataforma (ver userClients).
// Por enquanto tudo isso vale só para o Benchmarking; relatórios e ferramentas seguem como antes.
import { generatePassword, hashPassword } from './auth.js';
import { db, newId, save } from './store.js';

export const KINDS = { cliente: 'Cliente Cargill', cargill: 'Time Cargill', canal: 'Canais Cargill' };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class TeamError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const kindOf = (user) => (user.role === 'admin' ? 'admin' : KINDS[user.kind] ? user.kind : 'cliente');
export const isInternal = (user) => ['cargill', 'canal'].includes(kindOf(user));
export const isGestor = (user) => user.role === 'admin' || (kindOf(user) === 'cargill' && Boolean(user.bmkGestor));
export const canCreateTeam = (user) => user.role === 'admin' || (isGestor(user) && Boolean(user.bmkCreateTeam));
export const canCreateFarm = (user) => user.role === 'admin' || kindOf(user) === 'cargill';

// Todo mundo abaixo de userId, em qualquer nível (protegido contra ciclos).
export function teamIds(userId) {
  const users = db().users;
  const out = new Set();
  let frontier = [userId];
  while (frontier.length) {
    const next = [];
    for (const u of users) {
      if (u.reportsTo && frontier.includes(u.reportsTo) && !out.has(u.id) && u.id !== userId) {
        out.add(u.id);
        next.push(u.id);
      }
    }
    frontier = next;
  }
  return out;
}

// Responsáveis cujas fazendas a pessoa vê: ela mesma e a equipe dela; quem valida soma a equipe do
// gestor direto (o próprio gestor incluso).
export function ownerScope(user) {
  const scope = new Set([user.id, ...teamIds(user.id)]);
  if (user.bmkValidator && kindOf(user) === 'cargill' && user.reportsTo) {
    scope.add(user.reportsTo);
    for (const id of teamIds(user.reportsTo)) scope.add(id);
  }
  return scope;
}

const userById = (id) => db().users.find((u) => u.id === id);

// Quem pode ser responsável por uma fazenda cadastrada por "user": ele e a equipe (Time ou Canais).
export function ownerCandidates(user) {
  const ids = user.role === 'admin' ? null : new Set([user.id, ...teamIds(user.id)]);
  return db()
    .users.filter((u) => u.active && isInternal(u) && (!ids || ids.has(u.id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// Gestores a quem uma pessoa nova pode responder: o próprio gestor e os gestores da equipe dele.
function gestorCandidates(user) {
  const ids = user.role === 'admin' ? null : new Set([user.id, ...teamIds(user.id)]);
  return db().users.filter((u) => u.active && isGestor(u) && u.role !== 'admin' && (!ids || ids.has(u.id)));
}

// Confere o "responde a": precisa ser um gestor ativo e não pode criar um ciclo na árvore.
export function checkReportsTo(userId, reportsTo) {
  if (!reportsTo) return null;
  const boss = userById(reportsTo);
  if (!boss || !isGestor(boss) || boss.role === 'admin') throw new TeamError('"Responde a" precisa ser um gestor do Time Cargill.');
  if (userId && (reportsTo === userId || teamIds(userId).has(reportsTo))) throw new TeamError('"Responde a" não pode ser a própria pessoa nem alguém da equipe dela.');
  return reportsTo;
}

// Pessoas que o gestor administra: a equipe (Time e Canais) e os logins de cliente cujas fazendas
// estão todas no alcance dele.
function managedBy(user, farmIds) {
  const team = teamIds(user.id);
  return db().users.filter((u) => {
    if (u.role === 'admin' || u.id === user.id) return false;
    if (isInternal(u)) return user.role === 'admin' || team.has(u.id);
    // Logins de cliente da plataforma (com relatórios) são do admin; o gestor cuida dos do Benchmarking.
    return Boolean(u.bmkOnly) && u.clientIds.length > 0 && u.clientIds.every((id) => farmIds.has(id));
  });
}

const publicMember = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  kind: kindOf(u),
  reportsTo: u.reportsTo || null,
  bmkGestor: Boolean(u.bmkGestor),
  bmkValidator: Boolean(u.bmkValidator),
  clientIds: u.clientIds,
  active: u.active,
  bmkOnly: Boolean(u.bmkOnly),
  lastLoginAt: u.lastLoginAt || null,
});

// Tela "Equipe" do benchmarking (só gestores).
export function teamView(user, farms) {
  if (!isGestor(user)) throw new TeamError('Só gestores do Time Cargill administram equipe.', 403);
  const farmIds = new Set(farms.map((f) => f.id));
  const members = managedBy(user, farmIds);
  return {
    me: { id: user.id, name: user.name },
    canCreateTeam: canCreateTeam(user),
    kinds: KINDS,
    members: members.map(publicMember).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    gestores: [...gestorCandidates(user)].map((u) => ({ id: u.id, name: u.name })),
    farms: farms.map((f) => ({ id: f.id, name: f.name })),
  };
}

function readMember(user, body, farmIds, existing) {
  const kind = KINDS[body.kind] ? body.kind : null;
  if (!kind) throw new TeamError('Escolha o perfil: Time Cargill, Canais Cargill ou Cliente Cargill.');
  // Time Cargill só o admin cria (no cadastro de usuários). O gestor edita quem já é do Time na
  // equipe dele, mas não cria nem transforma ninguém em Time Cargill.
  const wasCargill = existing && kindOf(existing) === 'cargill';
  if (user.role !== 'admin' && (kind === 'cargill') !== Boolean(wasCargill)) {
    throw new TeamError(kind === 'cargill' ? 'Só o administrador cadastra pessoas do Time Cargill.' : 'Só o administrador muda o perfil de alguém do Time Cargill.', 403);
  }
  const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) throw new TeamError('Informe o nome da pessoa.');
  const out = { name, kind };
  if (kind === 'cliente') {
    const ids = [...new Set(Array.isArray(body.clientIds) ? body.clientIds : [])];
    if (!ids.length) throw new TeamError('Escolha a fazenda (ou as fazendas) deste cliente.');
    if (ids.some((id) => !farmIds.has(id))) throw new TeamError('Só dá para dar acesso às fazendas da sua equipe.', 403);
    // Fazendas que a pessoa já tinha fora do alcance do gestor ficam como estão.
    const others = (existing?.clientIds || []).filter((id) => !farmIds.has(id));
    Object.assign(out, { clientIds: [...others, ...ids], reportsTo: null, bmkGestor: false });
  } else {
    const allowed = new Set(gestorCandidates(user).map((u) => u.id));
    const reportsTo = body.reportsTo || (user.role === 'admin' ? null : user.id);
    if (reportsTo && !allowed.has(reportsTo)) throw new TeamError('A pessoa precisa responder a você ou a um gestor da sua equipe.', 403);
    out.reportsTo = checkReportsTo(existing?.id, reportsTo);
    // Tornar alguém gestor (ou deixar de ser) só com o poder "Pode criar equipe".
    const wantsGestor = kind === 'cargill' && Boolean(body.bmkGestor);
    if (wantsGestor !== Boolean(existing?.bmkGestor) && !canCreateTeam(user)) throw new TeamError('Você não tem permissão para criar equipe (tornar alguém gestor).', 403);
    out.bmkGestor = wantsGestor;
    if (!existing) out.clientIds = [];
  }
  if (kind !== 'cargill') Object.assign(out, { bmkValidator: false, bmkCreateTeam: false, bmkGestor: false });
  return out;
}

function audit(user, action, userId, impersonator) {
  const data = db();
  data.audit = [...(data.audit || []), { at: new Date().toISOString(), action, managerId: user.id, adminId: impersonator?.id || null, userId }].slice(-1000);
}

export async function createMember(user, body, farms) {
  if (!isGestor(user)) throw new TeamError('Só gestores do Time Cargill criam usuários.', 403);
  const farmIds = new Set(farms.map((f) => f.id));
  const email = String(body.email || '').trim().toLowerCase().slice(0, 200);
  if (!EMAIL.test(email)) throw new TeamError('Informe um e-mail válido.');
  if (db().users.some((u) => u.email === email)) throw new TeamError('Este e-mail já tem acesso ao portal. Peça ao administrador para ajustar o cadastro dessa pessoa.', 409);
  const fields = readMember(user, body, farmIds, null);
  const password = generatePassword();
  const member = {
    id: newId(),
    email,
    role: 'client',
    clientIds: [],
    ccvFarms: [],
    bmkValidator: false,
    bmkCreateTeam: false,
    bmkOnly: true,
    ...fields,
    confinamento: { status: 'none', requestedAt: null, decidedAt: null },
    pasto: { status: 'none', requestedAt: null, decidedAt: null },
    active: true,
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    sessionVersion: 1,
    createdAt: new Date().toISOString(),
    createdBy: user.id,
    lastLoginAt: null,
  };
  db().users.push(member);
  audit(user, 'bmk-team.create', member.id);
  await save();
  return { member: publicMember(member), password };
}

function memberOr404(user, id, farms) {
  const farmIds = new Set(farms.map((f) => f.id));
  const member = managedBy(user, farmIds).find((u) => u.id === id);
  if (!member) throw new TeamError('Pessoa não encontrada na sua equipe.', 404);
  return { member, farmIds };
}

export async function updateMember(user, id, body, farms) {
  if (!isGestor(user)) throw new TeamError('Só gestores do Time Cargill administram equipe.', 403);
  const { member, farmIds } = memberOr404(user, id, farms);
  const fields = readMember(user, { ...body, kind: body.kind || kindOf(member) }, farmIds, member);
  const active = body.active !== false;
  // Quem também usa a plataforma (cadastrado pelo admin) só o admin desativa.
  if (active !== member.active && !member.bmkOnly && user.role !== 'admin') throw new TeamError('Esta pessoa também usa a plataforma: só o administrador pode desativá-la.', 403);
  if (active !== member.active) member.sessionVersion = (member.sessionVersion || 1) + 1;
  Object.assign(member, fields, { active });
  audit(user, 'bmk-team.update', member.id);
  await save();
  return publicMember(member);
}

export async function resetMemberPassword(user, id, farms) {
  if (!isGestor(user)) throw new TeamError('Só gestores do Time Cargill administram equipe.', 403);
  const { member } = memberOr404(user, id, farms);
  if (!member.bmkOnly && user.role !== 'admin') throw new TeamError('Esta pessoa também usa a plataforma: só o administrador troca a senha dela.', 403);
  const password = generatePassword();
  member.passwordHash = await hashPassword(password);
  member.mustChangePassword = true;
  member.sessionVersion = (member.sessionVersion || 1) + 1;
  audit(user, 'bmk-team.reset-password', member.id);
  await save();
  return { password };
}

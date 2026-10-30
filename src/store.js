// Armazenamento simples em arquivo JSON. Adequado para dezenas de clientes;
// para volumes maiores, troque por um banco de dados mantendo a mesma interface.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const empty = () => ({ users: [], clients: [], reports: [], images: [], categories: [], tags: [], confinamentoSimulations: [], ccvAlertLog: [], chatThreads: [], chatMessages: [], pastoSimulations: [], bmkSubmissions: [], gerencias: [] });

// Usuários antigos tinham um único "clientId"; hoje cada usuário tem uma lista "clientIds".
function normalize(raw) {
  const next = { ...empty(), ...raw };
  // "Gestor da empresa" (isManager) deixou de existir: só o admin e os gestores do Time Cargill
  // criam usuários (src/bmkTeam.js). Perfil (kind) de quem não tem: Time Cargill se já validava o
  // benchmarking, senão Cliente Cargill.
  // Quem foi criado na aba Equipe do Benchmarking antes de existir "só Benchmarking" (bmkOnly) é
  // marcado pelo registro de auditoria: esses logins nunca deveriam ver relatórios, CCV ou ferramentas.
  // Gerências: cadastro próprio (db().gerencias, Admin → Usuários → Gerências); o usuário do Time
  // aponta para uma por gerenciaId. A gerência era um texto livre no usuário: vira item do cadastro.
  for (const u of next.users) {
    if (typeof u.gerencia !== 'string' || !u.gerencia.trim()) {
      delete u.gerencia;
      continue;
    }
    const name = u.gerencia.trim();
    let g = next.gerencias.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!g) {
      g = { id: crypto.randomUUID(), name, gerenteId: null, createdAt: new Date().toISOString() };
      next.gerencias.push(g);
    }
    u.gerenciaId ??= g.id;
    delete u.gerencia;
  }
  // O gerente era um texto: vira gerenteId quando o nome bate com um usuário (senão fica sem gerente).
  for (const g of next.gerencias) {
    if (typeof g.gerente !== 'string') continue;
    const name = g.gerente.trim().toLowerCase();
    g.gerenteId ??= (name && next.users.find((u) => u.role !== 'admin' && u.name?.trim().toLowerCase() === name)?.id) || null;
    delete g.gerente;
  }
  const viaBmkTeam = new Set((next.audit || []).filter((a) => a.action === 'bmk-team.create').map((a) => a.userId));
  next.users = next.users.map(({ clientId, isManager, ...user }) => ({
    ...user,
    ...(viaBmkTeam.has(user.id) && user.bmkOnly === undefined ? { bmkOnly: true } : {}),
    ...(user.role === 'admin' ? {} : { kind: ['cliente', 'cargill', 'canal'].includes(user.kind) ? user.kind : user.bmkValidator ? 'cargill' : 'cliente' }),
    clientIds: Array.isArray(user.clientIds) ? user.clientIds : clientId ? [clientId] : [],
    // Acesso à calculadora 4M Confinamento: pedido e aprovação, como o acesso a um relatório.
    confinamento: user.confinamento || { status: 'none', requestedAt: null, decidedAt: null },
    // Acesso à 3P · Predição de Desempenho a Pasto (segunda ferramenta, mesmo fluxo do 4M).
    pasto: user.pasto || { status: 'none', requestedAt: null, decidedAt: null },
    // Painel CCV: fazendas que o usuário vê, dentre as do cliente. Vazio = todas as do cliente.
    ccvFarms: Array.isArray(user.ccvFarms) ? user.ccvFarms : [],
  }));

  // Categorias eram só o texto em cada relatório (e uma imagem por nome em "categoryImages");
  // hoje são um cadastro próprio e cada relatório aponta para uma delas por categoryId.
  const legacyImages = next.categoryImages || {};
  delete next.categoryImages;
  const now = new Date().toISOString();
  const byName = new Map(next.categories.map((c) => [c.name.toLowerCase(), c]));
  const categoryFor = (report) => {
    const found = next.categories.find((c) => c.id === report.categoryId);
    if (found) return found;
    const name = String(report.category || 'Geral').trim() || 'Geral';
    let category = byName.get(name.toLowerCase());
    if (!category) {
      category = { id: crypto.randomUUID(), name, description: '', imageId: legacyImages[name] || null, createdAt: now };
      next.categories.push(category);
      byName.set(name.toLowerCase(), category);
    }
    return category;
  };
  // Tags dos clientes (ex.: Porte → Grande, Médio, Pequeno) e fazendas do painel CCV que cada cliente vê.
  // benchmark: o cliente participa do Benchmarking Confinamento (ver src/benchmark.js).
  next.clients = next.clients.map((c) => ({ ...c, tagIds: Array.isArray(c.tagIds) ? c.tagIds : [], ccvFarms: Array.isArray(c.ccvFarms) ? c.ccvFarms : [], benchmark: Boolean(c.benchmark) }));
  // Relatórios antigos são todos do Power BI incorporado.
  next.reports = next.reports.map((r) => ({ ...r, kind: r.kind === 'ccv' ? 'ccv' : 'powerbi' }));
  next.reports = next.reports.map((r) => {
    const category = categoryFor(r);
    return { ...r, categoryId: category.id, category: category.name };
  });
  return next;
}

let data = empty();
let writing = Promise.resolve();

export async function load() {
  try {
    const raw = await fs.readFile(config.dataFile, 'utf8');
    data = normalize(JSON.parse(raw));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    data = empty();
  }
}

export function db() {
  return data;
}

// Substitui todos os cadastros (usado na restauração de backup) e grava no disco.
export function replaceData(next) {
  data = normalize(next);
  return save();
}

export function newId() {
  return crypto.randomUUID();
}

// Grava em um arquivo temporário e renomeia, para não corromper o JSON se o processo cair no meio.
export function save() {
  const snapshot = JSON.stringify(data, null, 2);
  const run = writing.then(async () => {
    await fs.mkdir(path.dirname(config.dataFile), { recursive: true });
    const tmp = `${config.dataFile}.tmp`;
    await fs.writeFile(tmp, snapshot);
    await fs.rename(tmp, config.dataFile);
  });
  writing = run.catch(() => {});
  return run;
}

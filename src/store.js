// Armazenamento simples em arquivo JSON. Adequado para dezenas de clientes;
// para volumes maiores, troque por um banco de dados mantendo a mesma interface.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const empty = () => ({ users: [], clients: [], reports: [], images: [], categories: [], tags: [], confinamentoSimulations: [], ccvAlertLog: [], chatThreads: [], chatMessages: [] });

// Usuários antigos tinham um único "clientId"; hoje cada usuário tem uma lista "clientIds".
function normalize(raw) {
  const next = { ...empty(), ...raw };
  next.users = next.users.map(({ clientId, ...user }) => ({
    ...user,
    clientIds: Array.isArray(user.clientIds) ? user.clientIds : clientId ? [clientId] : [],
    // Acesso à calculadora 4M Confinamento: pedido e aprovação, como o acesso a um relatório.
    confinamento: user.confinamento || { status: 'none', requestedAt: null, decidedAt: null },
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
  next.clients = next.clients.map((c) => ({ ...c, tagIds: Array.isArray(c.tagIds) ? c.tagIds : [], ccvFarms: Array.isArray(c.ccvFarms) ? c.ccvFarms : [] }));
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

// Backups dos cadastros: exportação/restauração manual e uma cópia automática por dia,
// guardada ao lado do arquivo de dados (pasta "backups"), mantendo os últimos 14 dias.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { db } from './store.js';

const DIR = path.join(path.dirname(config.dataFile), 'backups');
const KEEP = 14;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const NAME = /^db-\d{4}-\d{2}-\d{2}\.json$/;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// Toda coleção nova do store precisa entrar aqui, senão some numa restauração de backup.
export function exportData() {
  const { users, clients, reports, images, categories, tags, settings, nps, confinamentoSimulations, pastoSimulations, ccvAlertLog, chatThreads, chatMessages, quotes, bmkSubmissions, bmkSettings } = db();
  return {
    app: 'bi-probeef',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { users, clients, reports, images, categories, tags, settings, nps, confinamentoSimulations, pastoSimulations, ccvAlertLog, chatThreads, chatMessages, quotes, bmkSubmissions, bmkSettings },
  };
}

// Confere se o arquivo enviado é um backup válido antes de substituir os cadastros.
export function validateBackup(backup) {
  const data = backup?.data;
  if (backup?.app !== 'bi-probeef' || !data) return 'Este arquivo não é um backup do Probeef Analytics.';
  for (const key of ['users', 'clients', 'reports']) {
    if (!Array.isArray(data[key])) return `Backup incompleto: falta a lista "${key}".`;
  }
  const ok = (list, fields) => list.every((item) => item && fields.every((f) => typeof item[f] === 'string' && item[f]));
  if (!ok(data.users, ['id', 'email', 'role', 'passwordHash'])) return 'Backup com usuários inválidos.';
  if (!ok(data.clients, ['id', 'name'])) return 'Backup com clientes inválidos.';
  if (!ok(data.reports, ['id', 'name', 'workspaceId', 'reportId'])) return 'Backup com relatórios inválidos.';
  if (!data.users.some((u) => u.role === 'admin' && u.active)) return 'O backup não tem nenhum administrador ativo.';
  return null;
}

async function dailySnapshot() {
  try {
    const { users, clients, reports } = db();
    if (!users.length && !clients.length && !reports.length) return;
    await fs.mkdir(DIR, { recursive: true });
    const file = path.join(DIR, `db-${today()}.json`);
    await fs.writeFile(file, JSON.stringify(exportData(), null, 2), { flag: 'wx' }).catch((err) => {
      if (err.code !== 'EEXIST') throw err;
    });
    const old = (await listSnapshots()).slice(KEEP);
    await Promise.all(old.map((s) => fs.unlink(path.join(DIR, s.name)).catch(() => {})));
  } catch (err) {
    console.error('Falha no backup automático:', err.message);
  }
}

export function startDailyBackups() {
  dailySnapshot();
  setInterval(dailySnapshot, CHECK_EVERY_MS).unref();
}

// Mais recentes primeiro.
export async function listSnapshots() {
  try {
    const names = (await fs.readdir(DIR)).filter((n) => NAME.test(n)).sort().reverse();
    return Promise.all(
      names.map(async (name) => {
        const stat = await fs.stat(path.join(DIR, name));
        return { name, date: name.slice(3, 13), size: stat.size };
      }),
    );
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export function snapshotPath(name) {
  return NAME.test(name) ? path.join(DIR, name) : null;
}

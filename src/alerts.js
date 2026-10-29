// Central de alertas do admin: clientes esfriando ou parados, quedas de uso, pessoas que nunca
// entraram e problemas nos dados. Cada alerta tem um id estável para poder ser adiado.
import { usageSummary } from './accessLog.js';
import { dataHealthSummary } from './dataHealth.js';
import { recentDetractors } from './nps.js';
import { db, save } from './store.js';

const DAY = 24 * 60 * 60 * 1000;
const NEW_GRACE_DAYS = 7; // cadastros recentes ainda não geram alerta de "nunca usou"

const daysAgo = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / DAY) : null);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function snoozedUntil(id) {
  const until = db().alertSnooze?.[id];
  return until && Date.parse(until) > Date.now() ? until : null;
}

export function computeAlerts() {
  const { users, clients } = db();
  const usage = usageSummary(30);
  const health = dataHealthSummary();
  const alerts = [];
  const old = (iso) => !iso || daysAgo(iso) >= NEW_GRACE_DAYS;

  for (const c of usage.clients) {
    const client = clients.find((x) => x.id === c.id);
    const people = users.filter((u) => u.role === 'client' && u.active && u.clientIds?.includes(c.id));
    if (!people.length) continue; // sem ninguém para acessar, não há o que cobrar
    const base = { clientId: c.id, client: c.name };
    if (c.health === 'inativo') {
      alerts.push({ ...base, id: `inativo:${c.id}`, type: 'inativo', severity: 'alta', title: `${c.name} está inativo`, detail: `Último acesso há ${daysAgo(c.lastAccess)} dias.` });
    } else if (c.health === 'esfriando') {
      alerts.push({ ...base, id: `esfriando:${c.id}`, type: 'esfriando', severity: 'media', title: `${c.name} está esfriando`, detail: `Último acesso há ${daysAgo(c.lastAccess)} dias.` });
    } else if (c.health === 'nunca' && old(client?.createdAt)) {
      alerts.push({ ...base, id: `nunca:${c.id}`, type: 'nunca', severity: 'media', title: `${c.name} nunca acessou`, detail: `${plural(people.length, 'pessoa cadastrada', 'pessoas cadastradas')}, nenhum acesso até agora.` });
    }
    // Queda de uso só para quem ainda está ativo (parados e esfriando já têm alerta próprio).
    if (c.health === 'ativo' && c.prevViews >= 5 && c.views < c.prevViews * 0.5) {
      const drop = Math.round((1 - c.views / c.prevViews) * 100);
      alerts.push({ ...base, id: `queda:${c.id}`, type: 'queda', severity: 'media', title: `Uso de ${c.name} caiu ${drop}%`, detail: `${c.views} acessos nos últimos 30 dias, contra ${c.prevViews} nos 30 anteriores.` });
    }
    const neverIn = people.filter((u) => !u.lastLoginAt && old(u.createdAt));
    if (neverIn.length) {
      alerts.push({
        ...base,
        id: `semlogin:${c.id}:${neverIn.length}`,
        type: 'semlogin',
        severity: 'baixa',
        title: `${plural(neverIn.length, 'pessoa', 'pessoas')} de ${c.name} nunca entrou${neverIn.length === 1 ? '' : 'ram'}`,
        detail: neverIn.map((u) => u.name).slice(0, 4).join(', ') + (neverIn.length > 4 ? '…' : ''),
        userIds: neverIn.map((u) => u.id),
      });
    }
  }

  // Dados: falhas por relatório; desatualizados agrupados por cliente.
  for (const r of health.reports.filter((x) => x.status === 'falha' || x.status === 'erro')) {
    alerts.push({
      id: `falha:${r.id}`,
      type: 'falha',
      severity: 'alta',
      title: `${r.clients.join(', ')}: falha na atualização de ${r.name}`,
      detail: r.failure || 'A atualização no Power BI não está funcionando.',
      reportId: r.id,
      client: r.clients.join(', '),
    });
  }
  const staleByClient = new Map();
  for (const r of health.reports.filter((x) => x.status === 'desatualizado')) {
    for (const name of r.clients) {
      if (!staleByClient.has(name)) staleByClient.set(name, []);
      staleByClient.get(name).push(r);
    }
  }
  for (const [name, reports] of staleByClient) {
    const client = clients.find((c) => c.name === name);
    const oldest = Math.max(...reports.map((r) => r.ageDays || 0));
    alerts.push({
      id: `desatualizado:${client?.id || name}:${reports.length}`,
      type: 'desatualizado',
      severity: 'media',
      title: `${name}: ${plural(reports.length, 'relatório desatualizado', 'relatórios desatualizados')}`,
      detail: `${reports.map((r) => r.name).slice(0, 3).join(', ')}${reports.length > 3 ? '…' : ''} · o mais antigo tem dados de ${oldest} dias atrás.`,
      clientId: client?.id || null,
      client: name,
    });
  }

  // Notas baixas na pesquisa de satisfação: vale uma conversa com o cliente.
  for (const r of recentDetractors()) {
    const names = r.clients.map((c) => c.name).join(', ');
    alerts.push({
      id: `nps:${r.id}`,
      type: 'nps',
      severity: 'media',
      title: `${r.user?.name || 'Um usuário'}${names ? ` (${names})` : ''} deu nota ${r.score} ao portal`,
      detail: r.comment ? `“${r.comment}”` : 'Sem comentário.',
      clientId: r.clients[0]?.id || null,
      client: names,
    });
  }

  const order = { alta: 0, media: 1, baixa: 2 };
  const active = [];
  let snoozed = 0;
  for (const a of alerts) {
    const until = snoozedUntil(a.id);
    if (until) snoozed += 1;
    else active.push(a);
  }
  active.sort((a, b) => order[a.severity] - order[b.severity] || a.title.localeCompare(b.title, 'pt-BR'));
  return {
    alerts: active,
    snoozed,
    counts: { alta: active.filter((a) => a.severity === 'alta').length, media: active.filter((a) => a.severity === 'media').length, baixa: active.filter((a) => a.severity === 'baixa').length },
    dataCheckedAt: health.scan.checkedAt,
  };
}

export async function snoozeAlert(id, days) {
  const data = db();
  data.alertSnooze = Object.fromEntries(Object.entries(data.alertSnooze || {}).filter(([, until]) => Date.parse(until) > Date.now()));
  data.alertSnooze[id] = new Date(Date.now() + days * DAY).toISOString();
  await save();
}

export async function clearSnoozes() {
  db().alertSnooze = {};
  await save();
}

// Resumo em texto para colar no WhatsApp ou num e-mail.
export function alertsDigest() {
  const { alerts } = computeAlerts();
  const date = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const section = (sev, label) => {
    const list = alerts.filter((a) => a.severity === sev);
    return list.length ? [`*${label}*`, ...list.map((a) => `• ${a.title} — ${a.detail}`), ''] : [];
  };
  if (!alerts.length) return `Probeef Analytics · resumo de ${date}\n\nNenhum alerta. Clientes e dados em dia.`;
  return [
    `Probeef Analytics · resumo de ${date}`,
    '',
    ...section('alta', 'Prioridade alta'),
    ...section('media', 'Atenção'),
    ...section('baixa', 'Para acompanhar'),
  ]
    .join('\n')
    .trim();
}

// Avisos "seu relatório foi atualizado" pelo WhatsApp.
// - Manual: botão "Avisar clientes" no admin (para quem atualiza republicando pelo Power BI Desktop).
// - Automático: a cada 2 horas, confere a última atualização registrada no Power BI.
// Avisos são mensagens iniciadas pela empresa, então exigem um modelo (template) aprovado pela Meta.
import { visibleReports } from '../access.js';
import { db, save } from '../store.js';
import { lastRefreshForReport } from '../powerbi.js';
import { sendTemplate, whatsappStatus } from './whatsapp.js';
import { logBotMessage } from './log.js';

const CHECK_EVERY_MS = 2 * 60 * 60 * 1000;

// Usuários que querem e podem receber o aviso deste relatório.
export function recipientsFor(report) {
  return db().users.filter(
    (u) => u.active && u.role === 'client' && u.phone && u.whatsappNotify && visibleReports(u).some((r) => r.id === report.id),
  );
}

export async function notifyReportUpdated(report) {
  const recipients = recipientsFor(report);
  const status = whatsappStatus();
  if (!status.configured || !status.updateTemplate) {
    return { sent: 0, failed: 0, recipients: recipients.map((u) => u.name), ready: false };
  }
  let sent = 0;
  let failed = 0;
  for (const u of recipients) {
    try {
      await sendTemplate(u.phone, status.updateTemplate, [u.name.split(' ')[0], report.name]);
      logBotMessage({ direction: 'out', userId: u.id, text: `[aviso] ${report.name} foi atualizado` });
      sent += 1;
    } catch (err) {
      console.error(`Aviso de ${report.name} para ${u.phone} falhou:`, err.message);
      failed += 1;
    }
  }
  return { sent, failed, recipients: recipients.map((u) => u.name), ready: true };
}

async function checkRefreshes() {
  const status = whatsappStatus();
  if (!status.configured || !status.updateTemplate) return;
  const data = db();
  data.refreshSeen ||= {};
  let changed = false;
  for (const report of data.reports) {
    if (!recipientsFor(report).length) continue;
    try {
      const last = await lastRefreshForReport(report.workspaceId, report.reportId);
      if (!last) continue;
      const seen = data.refreshSeen[report.id];
      data.refreshSeen[report.id] = last;
      changed = true;
      // Na primeira vez só registra; avisa quando aparecer uma atualização mais nova.
      if (seen && Date.parse(last) > Date.parse(seen)) await notifyReportUpdated(report);
    } catch (err) {
      console.error(`Verificação de atualização de ${report.name} falhou:`, err.message);
    }
  }
  if (changed) await save();
}

export function startRefreshWatcher() {
  setInterval(() => checkRefreshes().catch((err) => console.error('Falha nos avisos automáticos:', err.message)), CHECK_EVERY_MS).unref();
}

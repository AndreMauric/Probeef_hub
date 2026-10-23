// Regras de acesso aos relatórios, compartilhadas pelo portal e pelo bot do WhatsApp.
import { userClients } from './auth.js';
import { db } from './store.js';

export class AccessError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Administradores veem todos os relatórios. Clientes veem os relatórios liberados para cada um
// dos clientes (empresas) aos quais têm acesso; "clientIds" diz em quais deles o relatório aparece.
export function visibleReports(user) {
  const { reports } = db();
  if (user.role === 'admin') return reports.map((r) => ({ ...r, clientIds: [] }));
  const clients = userClients(user);
  return reports
    .map((r) => ({ ...r, clientIds: clients.filter((c) => c.reportIds.includes(r.id)).map((c) => c.id) }))
    .filter((r) => r.clientIds.length);
}

// Confere se o usuário pode ver o relatório e resolve o cliente e a identidade de RLS a usar.
// Usado pelo embed, pela exportação e pelo bot, para que todos sigam exatamente as mesmas regras.
export function resolveAccess(user, reportId, { client: clientParam, asClient } = {}) {
  const isAdmin = user.role === 'admin';
  const report = visibleReports(user).find((r) => r.id === reportId);
  if (!report) throw new AccessError('Relatório não encontrado ou sem permissão.', 404);

  // Cliente em nome do qual o relatório é aberto: o escolhido, desde que o relatório esteja
  // liberado para ele; sem escolha válida, o primeiro cliente do usuário que tem o relatório.
  let client = null;
  if (isAdmin) {
    client = db().clients.find((c) => c.id === asClient) || null;
  } else {
    const clientId = report.clientIds.includes(clientParam) ? clientParam : report.clientIds[0];
    client = db().clients.find((c) => c.id === clientId);
  }

  let identity = null;
  if (report.rls) {
    if (!client) throw new AccessError('Este relatório usa RLS. Escolha um cliente para visualizar como ele.', 400);
    // Falha fechada: sem regra configurada, não exibe nada em vez de exibir tudo.
    if (!client.rlsUsername || !client.rlsRoles?.length) {
      throw new AccessError(`O cliente ${client.name} ainda não tem regra de RLS configurada. Fale com o administrador.`, 400);
    }
    identity = { username: client.rlsUsername, roles: client.rlsRoles };
  }
  return { report, client, identity };
}

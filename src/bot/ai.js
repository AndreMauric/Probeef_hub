// Perguntas sobre os dados (ex.: "qual o GMD do lote 10116?"): o Claude consulta a estrutura do
// modelo do Power BI, monta uma consulta DAX, executa e responde em português.
// Segurança: as ferramentas só enxergam os relatórios liberados para o próprio usuário, e consultas
// DAX (EVALUATE) apenas leem dados. Relatórios com RLS ficam de fora.
import Anthropic from '@anthropic-ai/sdk';
import { isCcv, visibleReports } from '../access.js';
import { db } from '../store.js';
import { executeDax, reportDataset } from '../powerbi.js';
import { ASSISTANT_MODEL, getUserKey, hasUserKey } from '../userKeys.js';

const MODEL = ASSISTANT_MODEL;
const MAX_STEPS = 8;
const MAX_ROWS = 60;
const SCHEMA_TTL_MS = 60 * 60 * 1000;
// Trava contra uso descontrolado (cada usuário paga o próprio consumo).
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 150);

// Cada usuário usa a própria chave da Anthropic (cadastrada em Conta → Meu assistente).
export const aiAvailableFor = (user) => hasUserKey(user);

// Erros da Anthropic traduzidos para o usuário.
function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'A Anthropic recusou a sua chave. Cadastre uma chave válida em Conta → Meu assistente.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Sua chave da Anthropic não tem permissão para usar o assistente.';
  if (err instanceof Anthropic.RateLimitError) return 'Sua conta da Anthropic atingiu o limite de uso agora. Tente de novo em alguns minutos.';
  if (err instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(err.message)) {
    return 'Sua conta da Anthropic está sem créditos. Adicione créditos em console.anthropic.com (Billing) e tente de novo.';
  }
  if (err instanceof Anthropic.APIError && (err.status || 0) >= 500) return 'A Anthropic está instável agora. Tente de novo em alguns minutos.';
  return null;
}

// Relatórios que a IA pode consultar para este usuário (sem RLS e sem o painel CCV, cujo modelo
// junta todas as fazendas). Com scope.clientId, só os relatórios daquele cliente (a fazenda selecionada no portal).
function aiReports(user, scope = {}) {
  const clients = db().clients;
  return visibleReports(user)
    .filter((r) => !r.rls && !isCcv(r))
    .filter((r) => !scope.clientId || r.clientIds.includes(scope.clientId))
    .map((r) => ({ ...r, clientNames: r.clientIds.map((id) => clients.find((c) => c.id === id)?.name).filter(Boolean) }));
}

// ---------- Estrutura do modelo (tabelas, colunas e medidas), com cache de 1 hora ----------

const schemaCache = new Map();

async function datasetFor(report) {
  const { datasetId, datasetWorkspaceId } = await reportDataset(report.workspaceId, report.reportId);
  if (!datasetId) throw new Error('Este relatório não tem conjunto de dados consultável.');
  return { datasetId, workspaceId: datasetWorkspaceId };
}

async function modelSchema(report) {
  const ds = await datasetFor(report);
  const cached = schemaCache.get(ds.datasetId);
  if (cached && Date.now() - cached.at < SCHEMA_TTL_MS) return cached.text;

  const [columns, measures] = await Promise.all([
    executeDax(ds.workspaceId, ds.datasetId, 'EVALUATE COLUMNSTATISTICS()'),
    executeDax(ds.workspaceId, ds.datasetId, 'EVALUATE INFO.VIEW.MEASURES()').catch(() => []),
  ]);
  const skipTable = (t) => /^(LocalDateTable|DateTableTemplate)_/.test(t);
  const tables = new Map();
  for (const c of columns) {
    const table = c['[Table Name]'];
    const name = c['[Column Name]'];
    if (skipTable(table) || /^RowNumber-/.test(name)) continue;
    const range = c['[Min]'] !== null && c['[Max]'] !== null ? ` (de ${c['[Min]']} a ${c['[Max]']})` : '';
    if (!tables.has(table)) tables.set(table, []);
    tables.get(table).push(`'${table}'[${name}] - ${c['[Cardinality]']} valores${range}`);
  }
  const lines = ['TABELAS E COLUNAS:'];
  for (const [table, cols] of tables) lines.push(`Tabela '${table}':`, ...cols.map((c) => `  ${c}`));
  lines.push('', 'MEDIDAS (use como [Nome da medida]):');
  for (const m of measures) {
    const desc = m['[Description]'] ? ` - ${m['[Description]']}` : '';
    lines.push(`  [${m['[Name]']}] (tabela '${m['[Table]']}', ${m['[DataType]']})${desc}`);
  }
  const text = lines.join('\n').slice(0, 30000);
  schemaCache.set(ds.datasetId, { at: Date.now(), text });
  return text;
}

// ---------- Ferramentas que o Claude pode usar ----------

const TOOLS = [
  {
    name: 'listar_relatorios',
    description: 'Lista os relatórios do Power BI que este cliente pode consultar, com id, nome, categoria e cliente (fazenda).',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: 'estrutura_do_modelo',
    description:
      'Mostra as tabelas, colunas (com quantidade de valores e intervalo) e medidas do modelo de dados por trás de um relatório. Use antes de escrever uma consulta DAX.',
    input_schema: {
      type: 'object',
      properties: { report_id: { type: 'string', description: 'id do relatório, vindo de listar_relatorios' } },
      required: ['report_id'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'link_do_relatorio',
    description: 'Devolve o endereço para abrir um relatório no portal. Use quando o cliente pedir para ver ou abrir um relatório, ou quando for útil indicar onde está o dado.',
    input_schema: {
      type: 'object',
      properties: { report_id: { type: 'string', description: 'id do relatório, vindo de listar_relatorios' } },
      required: ['report_id'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'consultar_dax',
    description:
      `Executa uma consulta DAX somente leitura (começando com EVALUATE) no modelo do relatório e devolve até ${MAX_ROWS} linhas em JSON. ` +
      'Se der erro, a mensagem explica o problema; corrija a consulta e tente de novo.',
    input_schema: {
      type: 'object',
      properties: {
        report_id: { type: 'string', description: 'id do relatório, vindo de listar_relatorios' },
        query: { type: 'string', description: 'consulta DAX, por exemplo EVALUATE ROW("GMD", [GMD acum periodo])' },
      },
      required: ['report_id', 'query'],
      additionalProperties: false,
    },
    strict: true,
  },
];

// Exportada para testes: executa uma ferramenta como o Claude faria.
export async function runTool(user, name, input, scope = {}) {
  const reports = aiReports(user, scope);
  if (name === 'listar_relatorios') {
    return JSON.stringify(reports.map((r) => ({ id: r.id, nome: r.name, categoria: r.category, cliente: r.clientNames.join(', ') })));
  }
  const report = reports.find((r) => r.id === input?.report_id);
  if (!report) throw new Error('Relatório não encontrado entre os relatórios deste cliente. Use listar_relatorios.');
  if (name === 'estrutura_do_modelo') return modelSchema(report);
  if (name === 'link_do_relatorio') return `/portal#${report.id}`;
  if (name === 'consultar_dax') {
    const query = String(input.query || '').trim();
    if (!/^(DEFINE|EVALUATE)\b/i.test(query)) throw new Error('A consulta precisa começar com EVALUATE (ou DEFINE).');
    const ds = await datasetFor(report);
    const rows = await executeDax(ds.workspaceId, ds.datasetId, query);
    const shown = rows.slice(0, MAX_ROWS);
    const note = rows.length > MAX_ROWS ? ` (mostrando ${MAX_ROWS} de ${rows.length} linhas; filtre ou agregue para ver o resto)` : '';
    return `${JSON.stringify(shown)}${note}`;
  }
  throw new Error(`Ferramenta desconhecida: ${name}`);
}

// ---------- Conversa ----------

const SYSTEM = `Você é o assistente de dados do Probeef Analytics, falando com um cliente pelo WhatsApp.
O cliente é um pecuarista ou consultor; os relatórios do Power BI dele trazem dados de confinamento, forecast, saúde animal, sanidade e afins.

Como trabalhar:
- Responda apenas com base nos dados que você consultar com as ferramentas. Nunca invente números.
- Comece por listar_relatorios. Se a pergunta puder se referir a mais de um relatório ou fazenda e não der para saber qual, pergunte ao cliente antes de consultar.
- Antes de escrever DAX, veja a estrutura do modelo. Prefira as medidas existentes (elas já têm a regra de negócio) a recalcular com colunas.
- Se a pergunta não tiver relação com os dados dos relatórios, diga com educação o que você consegue fazer.

Como responder:
- Português do Brasil, curto e direto: de 1 a 6 linhas na maioria dos casos.
- Números no formato brasileiro (1.234,56), com a unidade quando souber (kg, @, R$, %).
- Diga de qual relatório/fazenda veio o dado, numa frase curta.`;

const STYLE = {
  whatsapp: 'Formatação (WhatsApp): use *negrito* com um asterisco de cada lado só para o número principal. Sem tabelas, títulos ou outros recursos de markdown.',
  portal:
    'Formatação (chat do portal): use **negrito** para os números principais e listas com "- " quando houver vários itens. Sem tabelas e sem títulos. ' +
    'Para indicar um relatório, use um link markdown com o endereço de link_do_relatorio, por exemplo [abrir o Forecast](/portal#id).',
};

const usage = new Map(); // userId -> { day, count }

function underDailyLimit(userId) {
  const day = new Date().toISOString().slice(0, 10);
  const entry = usage.get(userId);
  if (!entry || entry.day !== day) {
    usage.set(userId, { day, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= DAILY_LIMIT;
}

// history: perguntas e respostas anteriores desta conversa, em texto ({ role, content }).
// options.channel: 'whatsapp' | 'portal'; options.clientId: fazenda selecionada;
// options.currentReportId: relatório aberto na tela (vira contexto da pergunta).
export async function answerQuestion(user, question, history = [], options = {}) {
  const { channel = 'whatsapp', clientId = null, currentReportId = null } = options;
  const scope = { clientId };
  const apiKey = getUserKey(user);
  if (!apiKey) return 'Para usar o assistente, cadastre a sua chave da Anthropic em Conta → Meu assistente.';
  const anthropic = new Anthropic({ apiKey });
  const reports = aiReports(user, scope);
  if (!reports.length) return 'Não encontrei relatórios que eu possa consultar para você. Fale com o administrador do portal.';
  if (!underDailyLimit(user.id)) return 'Você atingiu o limite de perguntas de hoje. Amanhã eu respondo mais!';

  // O contexto vai junto da pergunta (e não no prompt de sistema) para o prompt de sistema ficar fixo.
  const current = reports.find((r) => r.id === currentReportId);
  const context = current ? `[Contexto: o cliente está com o relatório "${current.name}" (id ${current.id}) aberto na tela.]\n` : '';
  const messages = [...history, { role: 'user', content: `${context}${question}` }];
  const system = `${SYSTEM}\n${STYLE[channel] || STYLE.whatsapp}`;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    let response;
    try {
      response = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system,
        tools: TOOLS,
        messages,
      });
    } catch (err) {
      const message = friendlyError(err);
      if (message) return message;
      throw err;
    }

    if (response.stop_reason === 'refusal') return 'Não consigo responder a essa pergunta. Tente perguntar de outro jeito.';

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const calls = response.content.filter((b) => b.type === 'tool_use');
      const results = await Promise.all(
        calls.map(async (call) => {
          try {
            return { type: 'tool_result', tool_use_id: call.id, content: await runTool(user, call.name, call.input, scope) };
          } catch (err) {
            return { type: 'tool_result', tool_use_id: call.id, content: String(err.message || err), is_error: true };
          }
        }),
      );
      messages.push({ role: 'user', content: results });
      continue;
    }

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return text || 'Não consegui montar uma resposta. Tente perguntar de outro jeito.';
  }
  return 'Essa pergunta exigiu consultas demais. Tente uma pergunta mais específica, citando o relatório ou o lote.';
}

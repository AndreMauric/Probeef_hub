// Conversa do bot (WhatsApp ou simulador do admin). Recebe o texto de um usuário já identificado
// e responde chamando "send" com mensagens de texto ou documentos (PDF).
import { isCcv, resolveAccess, visibleReports } from '../access.js';
import { recordAccess } from '../accessLog.js';
import { config } from '../config.js';
import { fold } from '../naming.js';
import { createResetToken, resetLink } from '../passwordReset.js';
import { exportPdfBuffer } from '../powerbi.js';
import { db } from '../store.js';
import { aiAvailableFor, answerQuestion } from './ai.js';

const SESSION_TTL_MS = 30 * 60 * 1000;
const HISTORY_TURNS = 4;
const sessions = new Map(); // userId -> { state, options, history, at }

function session(userId) {
  const now = Date.now();
  let s = sessions.get(userId);
  if (!s || now - s.at > SESSION_TTL_MS) {
    s = { state: 'idle', options: [], history: [] };
    sessions.set(userId, s);
  }
  s.at = now;
  return s;
}

const firstName = (user) => String(user.name || '').split(' ')[0] || 'tudo bem';

function menu(user) {
  return [
    `Olá, ${firstName(user)}! Sou o assistente do *Probeef Analytics*.`,
    '',
    '*1* – Receber um relatório em PDF',
    '*2* – Fazer uma pergunta sobre os seus dados',
    '*3* – Redefinir minha senha do portal',
    '',
    aiAvailableFor(user)
      ? 'Você também pode escrever direto a sua pergunta, por exemplo: _qual o GMD acumulado do confinamento?_'
      : 'Responda com o número da opção.',
  ].join('\n');
}

// Relatórios do usuário, um por cliente (quem tem várias fazendas vê o nome da fazenda).
function reportOptions(user) {
  const clients = db().clients;
  const multi = new Set(visibleReports(user).flatMap((r) => r.clientIds)).size > 1;
  const options = [];
  for (const r of visibleReports(user)) {
    if (isCcv(r)) continue; // o painel CCV não vira PDF (o relatório por trás tem todas as fazendas)
    for (const clientId of r.clientIds) {
      const clientName = clients.find((c) => c.id === clientId)?.name || '';
      options.push({ reportId: r.id, clientId, label: multi ? `${clientName} · ${r.name}` : r.name, search: fold(`${clientName} ${r.name} ${r.category}`) });
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

function listOptions(options, title = 'Qual relatório você quer em PDF? Responda com o número:') {
  return [title, '', ...options.map((o, i) => `*${i + 1}* – ${o.label}`)].join('\n');
}

async function sendPdf(user, option, send, channel) {
  const { report, client, identity } = resolveAccess(user, option.reportId, { client: option.clientId });
  await send({ type: 'text', text: `Gerando o PDF de *${option.label}*… isso leva cerca de um minuto.` });
  try {
    const buffer = await exportPdfBuffer({ workspaceId: report.workspaceId, reportId: report.reportId, identity });
    const fileName = `${option.label.replace(/[^\p{L}\p{N} .-]+/gu, '').replace(/\s+/g, '-')}.pdf`;
    await send({ type: 'document', buffer, fileName, caption: option.label });
    if (channel !== 'simulator') recordAccess({ userId: user.id, clientId: client.id, reportId: report.id });
  } catch (err) {
    console.error('Falha ao gerar PDF pelo bot:', err.message);
    await send({ type: 'text', text: 'Não consegui gerar o PDF agora. Tente de novo em alguns minutos ou abra o relatório no portal.' });
  }
}

const isNumber = (t) => /^\d{1,3}$/.test(t);

// channel: 'whatsapp' | 'simulator'; baseUrl: endereço do portal (para o link de senha).
export async function handleMessage({ user, text, send, channel = 'whatsapp', baseUrl = config.publicUrl }) {
  const s = session(user.id);
  const raw = String(text || '').trim();
  const t = fold(raw).replace(/[!?.,;]+$/g, '');

  if (!raw) {
    await send({ type: 'text', text: 'Por enquanto eu só entendo mensagens de texto. ' + menu(user) });
    return;
  }

  // Escolhendo um relatório da lista.
  if (s.state === 'pick-report') {
    if (isNumber(t)) {
      const option = s.options[Number(t) - 1];
      if (!option) {
        await send({ type: 'text', text: `Não encontrei a opção ${t}. ${listOptions(s.options, 'Responda com um destes números:')}` });
        return;
      }
      s.state = 'idle';
      await sendPdf(user, option, send, channel);
      return;
    }
    const matches = s.options.filter((o) => o.search.includes(t));
    if (matches.length === 1 && t.length >= 3) {
      s.state = 'idle';
      await sendPdf(user, matches[0], send, channel);
      return;
    }
    if (t !== 'menu' && t !== '0' && t !== 'sair') {
      if (matches.length > 1) {
        s.options = matches;
        await send({ type: 'text', text: listOptions(matches, 'Encontrei mais de um. Qual deles? Responda com o número:') });
        return;
      }
    }
    s.state = 'idle';
  }

  if (['oi', 'ola', 'menu', 'ajuda', 'inicio', '0', 'bom dia', 'boa tarde', 'boa noite', 'opcoes'].includes(t)) {
    await send({ type: 'text', text: menu(user) });
    return;
  }

  // 1 – PDF (aceita também "pdf forecast", "relatório saúde animal" etc.)
  const pdfRequest = t === '1' || /^(pdf|relatorio|relatorios)\b/.test(t);
  if (pdfRequest) {
    const options = reportOptions(user);
    if (!options.length) {
      await send({ type: 'text', text: 'Não há relatórios liberados para você ainda. Fale com o administrador do portal.' });
      return;
    }
    const term = t.replace(/^(1|pdf|relatorios?)\b\s*(do|da|de)?\s*/, '').trim();
    const filtered = term ? options.filter((o) => o.search.includes(term)) : options;
    if (filtered.length === 1) {
      await sendPdf(user, filtered[0], send, channel);
      return;
    }
    s.state = 'pick-report';
    s.options = filtered.length ? filtered : options;
    await send({ type: 'text', text: listOptions(s.options) });
    return;
  }

  // 3 – senha
  if (t === '3' || /\bsenha\b/.test(t)) {
    if (!baseUrl) {
      await send({ type: 'text', text: 'Não consegui gerar o link agora. Peça ao administrador para redefinir sua senha.' });
      return;
    }
    const token = await createResetToken(user);
    await send({
      type: 'text',
      text: `Para criar uma senha nova, abra este link (vale por 30 minutos e uma única vez):\n${resetLink(baseUrl, token)}\n\nSe não foi você que pediu, ignore esta mensagem.`,
    });
    return;
  }

  // 2 – perguntas
  if (t === '2') {
    await send({
      type: 'text',
      text: aiAvailableFor(user)
        ? 'Pode perguntar! Por exemplo: _qual o peso médio atual?_ ou _quantos animais tenho no confinamento?_'
        : 'As perguntas sobre os dados ainda não estão ativadas. Enquanto isso, você pode receber os relatórios em PDF (opção *1*).',
    });
    return;
  }

  if (!aiAvailableFor(user)) {
    await send({ type: 'text', text: `Não entendi. ${menu(user)}` });
    return;
  }

  // Pergunta livre: vai para a IA, com as últimas perguntas e respostas como contexto.
  await send({ type: 'typing' });
  let answer;
  try {
    answer = await answerQuestion(user, raw, s.history);
  } catch (err) {
    console.error('Falha na resposta da IA:', err.message);
    answer = 'Tive um problema para consultar seus dados agora. Tente de novo em alguns minutos.';
  }
  s.history.push({ role: 'user', content: raw }, { role: 'assistant', content: answer });
  s.history = s.history.slice(-HISTORY_TURNS * 2);
  await send({ type: 'text', text: answer });
}

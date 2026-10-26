// Mensagens entre o usuário e a equipe do portal (rotas /api/chat; o admin usa /api/admin/chat).
// initChat monta o botão "Mensagens" do portal; renderMessage também é usado pela aba do admin.
import { api, h, toast } from './common.js';

const POLL_OPEN_MS = 10 * 1000; // conversa aberta
const POLL_CLOSED_MS = 60 * 1000; // só o contador

const fmtWhen = (iso) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const contextHref = (c) => `/portal#${c.reportId}${c.farm ? `/fazenda/${encodeURIComponent(c.farm)}` : ''}`;

// Texto em elementos seguros: quebras de linha, *negrito* (como no WhatsApp) e links.
function richText(text, { newTab }) {
  const box = h('div', { class: 'chat-text' });
  for (const line of String(text).split('\n')) {
    const p = h('p', {});
    for (const part of line.split(/(\*[^*\n]+\*|https?:\/\/\S+)/g)) {
      if (!part) continue;
      const bold = part.match(/^\*([^*]+)\*$/);
      if (bold) p.append(h('strong', {}, bold[1]));
      else if (/^https?:\/\//.test(part)) {
        // Link para o próprio portal abre na mesma aba (no portal) ou numa nova (no admin).
        const internal = part.startsWith(location.origin);
        const href = internal ? part.slice(location.origin.length) : part;
        p.append(h('a', { href, ...(newTab || !internal ? { target: '_blank', rel: 'noopener' } : {}) }, internal && href.startsWith('/portal#') ? 'Abrir no portal' : part));
      } else p.append(part);
    }
    box.append(line.trim() ? p : h('p', { class: 'chat-gap' }));
  }
  return box;
}

// mine: a mensagem é de quem está olhando (fica à direita).
// fileHref: endereço do PDF anexo (o admin baixa por /api/admin/chat/...).
export function renderMessage(m, { mine, newTab = false, showAuthor = true, fileHref = (msg) => `/api/chat/files/${msg.attachment.id}` }) {
  return h(
    'div',
    { class: `chat-msg ${mine ? 'mine' : 'theirs'}` },
    m.origin?.type === 'ccv' ? h('span', { class: 'chat-origin' }, m.origin.action === 'relatorio' ? 'Resumo CCV' : 'Alerta CCV') : null,
    m.origin?.type === 'benchmark' ? h('span', { class: 'chat-origin' }, 'Benchmarking') : null,
    richText(m.text, { newTab }),
    m.attachment
      ? h('a', { class: 'chat-file', href: fileHref(m), download: m.attachment.name }, h('span', { 'aria-hidden': 'true' }, '📄'), h('span', {}, m.attachment.name, h('small', {}, ` · PDF · ${Math.max(1, Math.round(m.attachment.size / 1024))} KB`)))
      : null,
    m.context
      ? h('a', { class: 'chat-context', href: contextHref(m.context), ...(newTab ? { target: '_blank', rel: 'noopener' } : {}) }, `📍 ${m.context.reportName}${m.context.farm ? ` · ${m.context.farm}` : ''}`)
      : null,
    h('span', { class: 'chat-meta' }, [showAuthor ? m.authorName : null, fmtWhen(m.at)].filter(Boolean).join(' · ')),
  );
}

// Texto digitado: Enter envia, Shift+Enter quebra a linha; a caixa cresce até um limite.
export function composer({ placeholder, onSend }) {
  const input = h('textarea', { rows: 1, placeholder, 'aria-label': 'Mensagem', maxlength: 2000 });
  const send = h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Enviar');
  const form = h('form', { class: 'ai-input chat-input' }, input, send);
  const grow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || send.disabled) return;
    send.disabled = true;
    try {
      await onSend(text);
      input.value = '';
      grow();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
  return { form, input };
}

// ---------- Botão "Mensagens" do portal (usuários de cliente) ----------

export function initChat({ button, badge, getContext, readOnly = false }) {
  const panel = h('section', { class: 'ai-panel chat-panel', id: 'chat-panel', hidden: true, 'aria-label': 'Mensagens com a equipe' });
  const list = h('div', { class: 'ai-messages', 'aria-live': 'polite' });
  const contextLabel = h('span', { class: 'ai-scope' });
  const box = composer({
    placeholder: 'Escreva para a equipe Probeef…',
    onSend: async (text) => {
      const { message } = await api('/api/chat', { method: 'POST', body: { text, context: getContext() } });
      messages.push(message);
      render();
    },
  });
  panel.append(
    h('header', { class: 'ai-head' }, h('div', {}, h('strong', {}, 'Fale com a equipe'), contextLabel), h('div', { class: 'ai-head-actions' }, h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Fechar', onclick: () => setOpen(false) }, '✕'))),
    list,
    readOnly ? h('p', { class: 'ai-note', style: 'padding-top: 10px' }, 'Você está vendo como este usuário: as mensagens são só para leitura. Responda pela aba Mensagens do admin.') : box.form,
    readOnly ? null : h('p', { class: 'ai-note' }, 'Um administrador responde aqui mesmo. A mensagem leva o relatório (e a fazenda) que você está vendo.'),
  );
  document.body.append(panel);

  let messages = [];
  let timer = null;

  function setBadge(n) {
    badge.textContent = n ? String(n) : '';
    badge.hidden = !n;
    button.setAttribute('aria-label', n ? `Mensagens, ${n} não ${n === 1 ? 'lida' : 'lidas'}` : 'Mensagens');
  }

  function render() {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.replaceChildren(
      ...(messages.length
        ? messages.map((m) => renderMessage(m, { mine: m.from === 'user', showAuthor: m.from === 'admin' }))
        : [h('div', { class: 'ai-welcome' }, h('p', {}, 'Tem uma dúvida sobre um relatório, um número que não bate ou um pedido? Escreva aqui: a equipe Probeef responde por esta conversa.'))]),
    );
    if (atBottom || !list.dataset.seen) list.scrollTop = list.scrollHeight;
    list.dataset.seen = '1';
  }

  function updateContext() {
    const c = getContext();
    contextLabel.textContent = c?.label ? `Sobre: ${c.label}` : 'Equipe Probeef';
  }

  async function refresh() {
    try {
      const data = await api('/api/chat');
      const changed = data.messages.length !== messages.length;
      messages = data.messages;
      if (changed || !list.childElementCount) render();
      if (data.unread && !readOnly) setBadge((await api('/api/chat/read', { method: 'POST', body: {} })).unread);
      else setBadge(readOnly ? data.unread : 0);
    } catch {
      // Sem conexão agora: tenta de novo no próximo ciclo.
    }
  }

  async function pollUnread() {
    try {
      setBadge((await api('/api/chat/unread')).unread);
    } catch {
      // Idem.
    }
  }

  function schedule() {
    clearTimeout(timer);
    const open = !panel.hidden;
    timer = setTimeout(async () => {
      if (document.visibilityState === 'visible') await (open ? refresh() : pollUnread());
      schedule();
    }, open ? POLL_OPEN_MS : POLL_CLOSED_MS);
  }

  function setOpen(open) {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      updateContext();
      refresh();
      box.input.focus();
    }
    schedule();
  }

  button.hidden = false;
  button.addEventListener('click', () => setOpen(panel.hidden));
  pollUnread();
  schedule();
  return { open: () => setOpen(true), contextChanged: () => !panel.hidden && updateContext() };
}

// Assistente do portal: botão flutuante + painel de conversa. Cada usuário conversa com o seu;
// o contexto (fazenda selecionada e relatório aberto) vem do portal por getContext().
import { api, h, toast } from './common.js';

const SUGGESTIONS = [
  'Qual o GMD acumulado?',
  'Quantos animais estão no confinamento?',
  'Resuma o desempenho dos lotes',
  'Qual lote tem o maior custo diário?',
];

const PROGRESS = ['Lendo seus relatórios…', 'Consultando os dados…', 'Montando a resposta…'];

// Texto da resposta (markdown simples) em elementos seguros: parágrafos, listas, **negrito** e links.
function renderAnswer(text) {
  const box = h('div', { class: 'ai-text' });
  const inline = (line) => {
    const nodes = [];
    for (const part of line.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|https?:\/\/\S+)/g)) {
      if (!part) continue;
      const bold = part.match(/^\*\*([^*]+)\*\*$/);
      const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (bold) nodes.push(h('strong', {}, bold[1]));
      else if (link && /^(\/portal#|#|https?:\/\/)/.test(link[2])) nodes.push(anchor(link[2], link[1]));
      else if (/^https?:\/\//.test(part)) nodes.push(anchor(part, part));
      else nodes.push(part);
    }
    return nodes;
  };
  const anchor = (href, label) =>
    href.startsWith('http') ? h('a', { href, target: '_blank', rel: 'noopener' }, label) : h('a', { href, 'data-internal': 'true' }, label);

  let list = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    const item = line.match(/^[-•*]\s+(.*)$/);
    if (item) {
      list ||= box.appendChild(h('ul', {}));
      list.append(h('li', {}, inline(item[1])));
      continue;
    }
    list = null;
    if (line) box.append(h('p', {}, inline(line)));
  }
  return box;
}

// ---------- Chave da Anthropic do próprio usuário ----------

function keyDialog(onChange) {
  let dialog = document.getElementById('key-dialog');
  if (!dialog) {
    dialog = h('dialog', { id: 'key-dialog' });
    document.body.append(dialog);
  }
  const render = (info) => {
    const error = h('div', { class: 'alert', role: 'alert', hidden: true });
    const field = h('input', { id: 'anthropic-key', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-…' });
    const save = h('button', { class: 'btn btn-primary', type: 'submit' }, info.hasKey ? 'Trocar chave' : 'Salvar chave');
    const form = h(
      'form',
      { novalidate: true },
      h('h2', {}, 'Meu assistente'),
      h(
        'p',
        { style: 'margin: 0' },
        'O assistente responde perguntas sobre os seus relatórios usando o Claude, da Anthropic. Ele funciona com a sua própria conta: o consumo (alguns centavos de dólar por pergunta) é cobrado direto por eles.',
      ),
      info.hasKey
        ? h('p', { class: 'alert alert-ok', style: 'margin: 0' }, `Chave cadastrada: ${info.masked}`, info.addedAt ? ` · desde ${new Date(info.addedAt).toLocaleDateString('pt-BR')}` : '')
        : info.broken
          ? h('p', { class: 'alert', style: 'margin: 0' }, 'Sua chave guardada não pôde ser lida (o portal mudou de servidor). Cadastre de novo.')
          : null,
      h(
        'ol',
        { class: 'key-steps' },
        h('li', {}, 'Crie uma conta em ', h('a', { href: 'https://console.anthropic.com', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'), '.'),
        h('li', {}, 'Em Billing, adicione créditos (US$ 5 já rendem muitas perguntas).'),
        h('li', {}, 'Em API Keys, clique em Create Key e copie a chave (começa com sk-ant-).'),
        h('li', {}, 'Cole aqui. Testamos a chave antes de salvar; ela fica guardada criptografada e ninguém vê o valor.'),
      ),
      h('label', { class: 'field' }, h('span', {}, info.hasKey ? 'Nova chave' : 'Sua chave'), field),
      error,
      h(
        'div',
        { class: 'dialog-actions' },
        info.hasKey ? h('button', { class: 'btn btn-danger', type: 'button', onclick: remove, style: 'margin-right: auto' }, 'Remover chave') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Fechar'),
        save,
      ),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.hidden = true;
      save.disabled = true;
      save.textContent = 'Testando a chave…';
      try {
        const { key } = await api('/api/assistant/key', { method: 'PUT', body: { apiKey: field.value } });
        field.value = '';
        dialog.close();
        toast('Chave salva. O assistente está pronto.');
        onChange(key);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        save.disabled = false;
        save.textContent = info.hasKey ? 'Trocar chave' : 'Salvar chave';
      }
    });
    dialog.replaceChildren(form);
  };
  async function remove() {
    const { key } = await api('/api/assistant/key', { method: 'DELETE', body: {} });
    dialog.close();
    toast('Chave removida.');
    onChange(key);
  }
  return {
    async open() {
      const data = await api('/api/assistant');
      render(data.key);
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('#anthropic-key')?.focus();
    },
  };
}

export function initAssistant({ getContext, onNavigate }) {
  const panel = h('section', { class: 'ai-panel', id: 'ai-panel', hidden: true, 'aria-label': 'Assistente' });
  const toggle = h(
    'button',
    { class: 'ai-toggle', type: 'button', 'aria-controls': 'ai-panel', 'aria-expanded': 'false', hidden: true },
    h('span', { class: 'ai-spark', 'aria-hidden': 'true' }, '✦'),
    h('span', {}, 'Assistente'),
  );
  const list = h('div', { class: 'ai-messages', 'aria-live': 'polite' });
  const input = h('textarea', { rows: 1, placeholder: 'Pergunte sobre seus dados…', 'aria-label': 'Sua pergunta', maxlength: 1000 });
  const send = h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Enviar');
  const scopeLabel = h('span', { class: 'ai-scope' });
  const form = h('form', { class: 'ai-input' }, input, send);
  const resetButton = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => reset() }, 'Nova conversa');

  panel.append(
    h(
      'header',
      { class: 'ai-head' },
      h('div', {}, h('strong', {}, 'Assistente'), scopeLabel),
      h(
        'div',
        { class: 'ai-head-actions' },
        resetButton,
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': 'Fechar', onclick: () => setOpen(false) }, '✕'),
      ),
    ),
    list,
    form,
    h('p', { class: 'ai-note' }, 'As respostas vêm dos seus relatórios. Confira números importantes no relatório.'),
  );
  document.body.append(toggle, panel);

  let busy = false;
  let loadedFor = null;
  let status = { enabled: false, blocked: false };
  const keys = keyDialog((key) => {
    status.enabled = key.hasKey;
    loadedFor = null;
    if (!panel.hidden) loadHistory();
  });

  // Sem chave cadastrada: explica e leva ao cadastro.
  const setupCard = () =>
    h(
      'div',
      { class: 'ai-welcome' },
      h('p', {}, 'Para usar o assistente, cadastre a sua chave da Anthropic (a empresa do Claude). Leva 5 minutos, e o consumo é cobrado direto na sua conta.'),
      h('div', {}, h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => keys.open() }, 'Cadastrar minha chave')),
    );

  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('active', open);
    if (open) {
      loadHistory();
      input.focus();
    }
  };
  toggle.addEventListener('click', () => setOpen(panel.hidden));

  const scrollDown = () => {
    list.scrollTop = list.scrollHeight;
  };

  const welcome = () =>
    h(
      'div',
      { class: 'ai-welcome' },
      h('p', {}, 'Olá! Pergunte sobre os dados dos seus relatórios que eu consulto e respondo.'),
      h(
        'div',
        { class: 'ai-suggestions' },
        SUGGESTIONS.map((q) => h('button', { class: 'chip', type: 'button', onclick: () => ask(q) }, q)),
      ),
    );

  const bubble = (role, content) => {
    const el = h('div', { class: `ai-msg ${role}` }, role === 'assistant' ? renderAnswer(content) : content);
    list.append(el);
    scrollDown();
    return el;
  };

  async function loadHistory() {
    const { client } = getContext();
    const ctx = getContext();
    scopeLabel.textContent = ctx.clientName ? `Dados de ${ctx.clientName}` : 'Seus relatórios';
    if (loadedFor === (client || '')) return;
    loadedFor = client || '';
    list.replaceChildren();
    try {
      const data = await api(`/api/assistant${client ? `?client=${encodeURIComponent(client)}` : ''}`);
      status = data;
      form.hidden = !data.enabled || data.blocked;
      resetButton.hidden = form.hidden;
      if (data.blocked) {
        list.append(h('div', { class: 'ai-welcome' }, h('p', {}, 'O assistente fica desligado enquanto você vê o portal como outro usuário, para não usar a chave e os créditos dele.')));
        return;
      }
      if (!data.enabled) {
        list.append(setupCard());
        return;
      }
      if (!data.history.length) list.append(welcome());
      for (const m of data.history) bubble(m.role, m.content);
    } catch {
      list.append(welcome());
    }
  }

  async function ask(question) {
    const text = String(question || '').trim();
    if (!text || busy) return;
    busy = true;
    send.disabled = true;
    list.querySelector('.ai-welcome')?.remove();
    bubble('user', text);
    input.value = '';
    autosize();
    const waiting = h('div', { class: 'ai-msg assistant waiting' }, h('span', { class: 'dots', 'aria-hidden': 'true' }), h('span', {}, PROGRESS[0]));
    list.append(waiting);
    scrollDown();
    let step = 0;
    const timer = setInterval(() => {
      step = Math.min(step + 1, PROGRESS.length - 1);
      waiting.lastChild.textContent = PROGRESS[step];
    }, 5000);
    try {
      const ctx = getContext();
      const { answer } = await api('/api/assistant', { method: 'POST', body: { message: text, client: ctx.client, reportId: ctx.reportId } });
      waiting.remove();
      bubble('assistant', answer);
    } catch (err) {
      waiting.remove();
      bubble('error', err.message);
    } finally {
      clearInterval(timer);
      busy = false;
      send.disabled = false;
      input.focus();
    }
  }

  async function reset() {
    const { client } = getContext();
    await api('/api/assistant/reset', { method: 'POST', body: { client } }).catch(() => {});
    list.replaceChildren(welcome());
  }

  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(input.value);
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    ask(input.value);
  });
  // Links para relatórios abrem dentro do portal (e no celular fecham o painel).
  list.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-internal]');
    if (!a) return;
    e.preventDefault();
    const hash = a.getAttribute('href').split('#')[1] || '';
    if (window.matchMedia('(max-width: 600px)').matches) setOpen(false);
    onNavigate(hash);
  });

  return {
    // O botão aparece para todos; quem ainda não tem chave vê como cadastrar.
    async enableIfAvailable() {
      toggle.hidden = false;
    },
    openKeySettings: () => keys.open(),
    // Troca de fazenda: a conversa é outra.
    clientChanged() {
      loadedFor = null;
      if (!panel.hidden) loadHistory();
    },
  };
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  // Sessão ausente ou expirada: volta para o login (exceto nas próprias telas de login e troca de senha).
  if (res.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/password' && location.pathname !== '/') {
    location.href = '/';
    throw new Error('Sessão expirada.');
  }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

// Cria elementos com texto seguro (sempre textContent, nunca innerHTML com dados).
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

let toastTimer;
export function toast(message, kind = 'info') {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: `toast ${kind === 'error' ? 'error' : ''}`, role: 'status' }, message);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

export async function loadConfig() {
  const cfg = await api('/api/config');
  document.querySelectorAll('[data-portal-name]').forEach((el) => {
    el.textContent = cfg.portalName;
  });
  document.title = `${cfg.portalName}${document.title ? ` · ${document.title}` : ''}`;
  return cfg;
}

export async function logout() {
  await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  location.href = '/';
}

export function setupMenu(button, list) {
  const close = () => {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    list.hidden = !list.hidden;
    button.setAttribute('aria-expanded', String(!list.hidden));
  });
  document.addEventListener('click', (e) => {
    if (!list.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

// ---------- Mensagem pronta com o acesso (login e senha temporária) ----------
// Para o admin ou o gestor mandar à pessoa do jeito que preferir: copiar, WhatsApp ou e-mail. Usada ao criar o
// usuário e ao gerar uma senha nova (Admin → Usuários e aba Equipe do Benchmarking).
let nomeDoPortal;
const portalName = () => (nomeDoPortal ??= api('/api/config').then((c) => c.portalName || 'portal').catch(() => 'portal'));

export function mensagemAcesso({ name, email, password, bmkOnly, kind }, portal = 'portal') {
  const primeiro = String(name || '').trim().split(/\s+/)[0];
  // Login só do Benchmarking: a fazenda lança os dados; Time e Canais acompanham as fazendas deles.
  const benchmark = !bmkOnly ? '' : kind === 'cliente' ? ' Depois de entrar, abra "Benchmarking" para lançar os dados da fazenda.' : ' Depois de entrar, abra "Benchmarking".';
  return [
    `Olá${primeiro ? `, ${primeiro}` : ''}!`,
    '',
    `Seu acesso ao ${portal} está pronto.`,
    `Endereço: ${location.origin}`,
    `Login: ${email}`,
    `Senha temporária: ${password}`,
    '',
    `No primeiro acesso, o portal pede para você criar uma senha sua.${benchmark}`,
  ].join('\n');
}

export function acessoPronto(user, password) {
  const area = h('textarea', { rows: 11, readonly: true, class: 'acesso-msg', 'aria-label': 'Mensagem com o acesso' });
  const whats = h('a', { class: 'btn btn-sm', target: '_blank', rel: 'noopener' }, 'Abrir no WhatsApp');
  const mail = h('a', { class: 'btn btn-sm' }, 'Abrir no e-mail');
  let texto = '';
  const montar = (portal) => {
    texto = mensagemAcesso({ ...user, password }, portal);
    area.value = texto;
    whats.href = `https://wa.me/?text=${encodeURIComponent(texto)}`;
    mail.href = `mailto:${user.email}?subject=${encodeURIComponent(`Seu acesso ao ${portal}`)}&body=${encodeURIComponent(texto)}`;
  };
  montar('portal');
  portalName().then(montar);
  const copiar = h(
    'button',
    {
      class: 'btn btn-sm btn-primary',
      type: 'button',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(texto);
          toast('Mensagem copiada. É só colar para a pessoa.');
        } catch {
          area.focus();
          area.select();
          toast('Selecione e copie a mensagem (Ctrl+C).');
        }
      },
    },
    'Copiar mensagem',
  );
  return h('div', { class: 'acesso-pronto' }, area, h('div', { class: 'acesso-acoes' }, copiar, whats, mail));
}

export async function copyText(text, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado.');
  } catch {
    if (fallbackEl) {
      const range = document.createRange();
      range.selectNodeContents(fallbackEl);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }
    toast('Selecione e copie manualmente.');
  }
}

// Diálogo de troca de senha, usado no portal e no admin.
export function openPasswordDialog({ required = false } = {}) {
  const dialog = document.getElementById('password-dialog');
  const form = dialog.querySelector('form');
  const error = dialog.querySelector('.alert');
  const cancel = dialog.querySelector('[data-cancel]');
  form.reset();
  error.hidden = true;
  cancel.hidden = required;
  dialog.querySelector('[data-required-note]').hidden = !required;
  dialog.oncancel = (e) => {
    if (required) e.preventDefault();
  };
  cancel.onclick = () => dialog.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    if (fd.get('newPassword') !== fd.get('confirm')) {
      error.textContent = 'As senhas novas não conferem.';
      error.hidden = false;
      return;
    }
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: { currentPassword: fd.get('currentPassword'), newPassword: fd.get('newPassword') },
      });
      dialog.close();
      toast('Senha alterada.');
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  };
  dialog.showModal();
}

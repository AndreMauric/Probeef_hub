import { api, loadConfig, toast } from './common.js';

const form = document.getElementById('login-form');
const error = document.getElementById('error');
const title = document.querySelector('.auth-card h2');
const $ = (id) => document.getElementById(id);
const mfaForm = $('mfa-form');

const home = (user) => (user.role === 'admin' ? '/admin' : '/portal');

loadConfig()
  .then((cfg) => {
    $('setup').hidden = !cfg.needsSetup;
  })
  .catch(() => {});

// Já logado: vai direto para a área certa.
api('/api/auth/me')
  .then(({ user }) => location.replace(home(user)))
  .catch(() => {});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: { email: form.email.value, password: form.password.value },
    });
    if (res.mfa) return await showMfa(res.mfa);
    location.href = home(res.user);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

// Verificação em duas etapas (src/mfa.js). 'setup' = primeira vez: mostra o QR code.
let usingRecovery = false;
async function showMfa(mode) {
  form.hidden = true;
  mfaForm.hidden = false;
  $('mfa-error').hidden = true;
  usingRecovery = false;
  setRecoveryMode(false);
  $('mfa-recovery-toggle').hidden = mode === 'setup';
  title.textContent = 'Verificação em duas etapas';
  if (mode === 'setup') {
    const { secret, qr } = await api('/api/auth/mfa/setup', { method: 'POST', body: {} });
    $('mfa-intro').textContent =
      'Para proteger as contas de administrador, o portal pede um código do celular além da senha. Instale um aplicativo autenticador (Google Authenticator ou Microsoft Authenticator), leia o QR code abaixo e digite o código que aparecer.';
    $('mfa-qr').src = qr;
    $('mfa-secret').textContent = secret;
    $('mfa-setup').hidden = false;
  } else {
    $('mfa-intro').textContent = 'Abra o aplicativo autenticador no celular e digite o código do portal.';
    $('mfa-setup').hidden = true;
  }
  $('mfa-code').value = '';
  $('mfa-code').focus();
}

function setRecoveryMode(on) {
  usingRecovery = on;
  $('mfa-code-label').textContent = on ? 'Código de recuperação' : 'Código de 6 dígitos';
  $('mfa-code').inputMode = on ? 'text' : 'numeric';
  $('mfa-code').autocomplete = on ? 'off' : 'one-time-code';
  $('mfa-recovery-toggle').textContent = on ? 'Usar o código do aplicativo' : 'Perdi o celular: usar um código de recuperação';
}

$('mfa-recovery-toggle').addEventListener('click', () => {
  setRecoveryMode(!usingRecovery);
  $('mfa-code').value = '';
  $('mfa-code').focus();
});

$('mfa-back').addEventListener('click', () => {
  api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  mfaForm.hidden = true;
  form.hidden = false;
  title.textContent = 'Entrar';
  form.password.value = '';
  form.password.focus();
});

mfaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('mfa-error');
  err.hidden = true;
  const button = mfaForm.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const res = await api('/api/auth/mfa/verify', { method: 'POST', body: { code: $('mfa-code').value } });
    if (res.recoveryCodes) return showRecoveryCodes(res.recoveryCodes, res.user);
    if (res.usedRecovery) {
      alert(`Código de recuperação usado. Restam ${res.remaining}. Se perdeu o celular, em Admin → Usuários use "Zerar duas etapas" no seu usuário e configure o aplicativo de novo.`);
    }
    location.href = home(res.user);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    // Sessão de verificação vencida ou bloqueada: volta para a senha.
    if (/expirou\. Entre|Muitas tentativas/.test(ex.message)) setTimeout(() => $('mfa-back').click(), 2500);
  } finally {
    button.disabled = false;
  }
});

function showRecoveryCodes(codes, user) {
  mfaForm.hidden = true;
  $('mfa-recovery').hidden = false;
  title.textContent = 'Códigos de recuperação';
  $('mfa-recovery-list').replaceChildren(...codes.map((c) => Object.assign(document.createElement('li'), { textContent: c })));
  $('mfa-recovery-copy').onclick = () =>
    navigator.clipboard.writeText(codes.join('\n')).then(
      () => toast('Códigos copiados.'),
      () => toast('Não foi possível copiar. Anote os códigos.', 'error'),
    );
  $('mfa-recovery-done').onclick = () => (location.href = home(user));
}

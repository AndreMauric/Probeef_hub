import { api, loadConfig } from './common.js';

const form = document.getElementById('reset-form');
const error = document.getElementById('error');
// O token vem depois do "#" no link, então não passa pelos registros do servidor.
const token = decodeURIComponent(location.hash.slice(1));

loadConfig().catch(() => {});

const showError = (message) => {
  error.textContent = message;
  error.hidden = false;
};

if (!token) {
  form.querySelector('button').disabled = true;
  showError('Link incompleto. Peça um novo link pelo WhatsApp (opção "senha").');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  if (form.password.value !== form.confirm.value) {
    showError('As senhas não conferem.');
    return;
  }
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    await api('/api/auth/reset-password', { method: 'POST', body: { token, password: form.password.value } });
    history.replaceState(null, '', location.pathname);
    form.hidden = true;
    document.getElementById('done').hidden = false;
  } catch (err) {
    showError(err.message);
    button.disabled = false;
  }
});

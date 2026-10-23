import { api, loadConfig } from './common.js';

const form = document.getElementById('login-form');
const error = document.getElementById('error');

const home = (user) => (user.role === 'admin' ? '/admin' : '/portal');

loadConfig()
  .then((cfg) => {
    document.getElementById('setup').hidden = !cfg.needsSetup;
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
    const { user } = await api('/api/auth/login', {
      method: 'POST',
      body: { email: form.email.value, password: form.password.value },
    });
    location.href = home(user);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    button.disabled = false;
  }
});

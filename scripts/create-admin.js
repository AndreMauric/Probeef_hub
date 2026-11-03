// Cria (ou redefine a senha de) um administrador.
// Uso: npm run create-admin -- email@empresa.com "Nome Completo"
// Também zera a verificação em duas etapas (admin que perdeu o celular e os códigos de recuperação).
import { generatePassword, hashPassword } from '../src/auth.js';
import { db, load, newId, save } from '../src/store.js';

const [emailArg, ...nameParts] = process.argv.slice(2);
const email = String(emailArg || '').trim().toLowerCase();
const name = nameParts.join(' ').trim() || 'Administrador';

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Uso: npm run create-admin -- email@empresa.com "Nome Completo"');
  process.exit(1);
}

await load();
const password = generatePassword();
const existing = db().users.find((u) => u.email === email);

if (existing) {
  Object.assign(existing, {
    role: 'admin',
    clientIds: [],
    active: true,
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    sessionVersion: existing.sessionVersion + 1,
  });
  delete existing.mfa;
  delete existing.mfaPending;
  console.log(`Usuário ${email} agora é administrador e teve a senha redefinida.`);
} else {
  db().users.push({
    id: newId(),
    email,
    name,
    role: 'admin',
    clientIds: [],
    active: true,
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    sessionVersion: 1,
    createdAt: new Date().toISOString(),
    lastLoginAt: null,
  });
  console.log(`Administrador ${email} criado.`);
}

await save();
console.log(`Senha temporária: ${password}`);
console.log('Você vai trocar essa senha no primeiro login e configurar a verificação em duas etapas.');

// Chave da Anthropic de cada usuário: o assistente de cada pessoa usa a conta (e os créditos) dela.
// A chave fica criptografada nos cadastros e nunca volta para o navegador, só mascarada.
import Anthropic from '@anthropic-ai/sdk';
import { save } from './store.js';
import { open, seal } from './secretBox.js';

export const ASSISTANT_MODEL = 'claude-opus-5-5';

export function getUserKey(user) {
  return user?.anthropicKey ? open(user.anthropicKey.box) : null;
}

export const hasUserKey = (user) => Boolean(getUserKey(user));

export function keyInfo(user) {
  const ok = hasUserKey(user);
  return {
    hasKey: ok,
    masked: ok ? `sk-ant-…${user.anthropicKey.last4}` : null,
    addedAt: ok ? user.anthropicKey.addedAt : null,
    // Chave guardada mas que não abre (ex.: backup restaurado em outro servidor).
    broken: Boolean(user?.anthropicKey && !ok),
  };
}

export class KeyError extends Error {}

// Testa a chave sem custo (consulta o modelo) antes de guardar.
export async function validateKey(apiKey) {
  const key = String(apiKey || '').trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) throw new KeyError('Isso não parece uma chave da Anthropic. Ela começa com "sk-ant-".');
  try {
    await new Anthropic({ apiKey: key, maxRetries: 1, timeout: 15000 }).models.retrieve(ASSISTANT_MODEL);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new KeyError('A Anthropic recusou esta chave. Confira se copiou a chave inteira e se ela não foi apagada.');
    if (err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError) {
      throw new KeyError('Esta chave não tem acesso ao modelo usado pelo assistente (Claude Opus 5.5).');
    }
    if (err instanceof Anthropic.RateLimitError) throw new KeyError('A Anthropic está limitando esta conta agora. Tente de novo em alguns minutos.');
    throw new KeyError('Não consegui falar com a Anthropic para testar a chave. Tente de novo em instantes.');
  }
  return key;
}

export async function setUserKey(user, apiKey) {
  const key = await validateKey(apiKey);
  user.anthropicKey = { box: seal(key), last4: key.slice(-4), addedAt: new Date().toISOString() };
  await save();
}

export async function removeUserKey(user) {
  delete user.anthropicKey;
  await save();
}

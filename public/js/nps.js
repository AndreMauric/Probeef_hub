// Pesquisa de satisfação: um cartão discreto no canto da tela, de vez em quando.
// O servidor decide se é hora de perguntar (quem já usa a plataforma, no máximo a cada 90 dias).
// Aparece no portal, nas ferramentas e no Benchmarking; a resposta leva onde foi dada (pelo endereço).
// O visual fica em /css/nps.css, carregado aqui, para funcionar também em páginas com tema próprio (4M).
import { api, h } from './common.js';

const SHOW_AFTER_MS = 60 * 1000; // dá tempo de a pessoa usar o portal antes de perguntar

const FOLLOW_UP = {
  promotor: 'Que bom! O que você mais gosta no portal?',
  neutro: 'O que faria o portal te ajudar mais?',
  detrator: 'O que está faltando ou atrapalhando? Sua resposta vai direto para a nossa equipe.',
};
// Página → onde a pessoa respondeu (o servidor confere a lista; o resto conta como portal).
const contextOf = () => location.pathname.split('/').filter(Boolean)[0] || 'portal';

function loadStyle() {
  if (document.querySelector('link[data-nps-css]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: '/css/nps.css', 'data-nps-css': '' }));
}

const categoryOf = (score) => (score >= 9 ? 'promotor' : score >= 7 ? 'neutro' : 'detrator');

function showCard(portalName) {
  let score = null;
  const card = h('section', { class: 'nps-card', role: 'dialog', 'aria-labelledby': 'nps-title' });
  const remove = () => card.remove();

  const close = h('button', { class: 'nps-close', type: 'button', 'aria-label': 'Fechar pesquisa', title: 'Agora não' }, '×');
  close.onclick = () => {
    api('/api/nps/dismiss', { method: 'POST', body: {} }).catch(() => {});
    remove();
  };

  const followLabel = h('span', {});
  const comment = h('textarea', { id: 'nps-comment', rows: '3', maxlength: '1000' });
  const error = h('p', { class: 'nps-error', role: 'alert', hidden: true });
  const send = h('button', { class: 'nps-send', type: 'submit' }, 'Enviar');
  const follow = h('form', { class: 'nps-follow', hidden: true, novalidate: true }, h('label', { class: 'field' }, followLabel, comment), error, h('div', { class: 'nps-actions' }, send));

  const buttons = Array.from({ length: 11 }, (_, n) => {
    const b = h('button', { class: `nps-score ${categoryOf(n)}`, type: 'button', 'aria-pressed': 'false', 'aria-label': `Nota ${n}` }, String(n));
    b.onclick = () => {
      score = n;
      buttons.forEach((x, i) => x.setAttribute('aria-pressed', String(i === n)));
      followLabel.textContent = `${FOLLOW_UP[categoryOf(n)]} (opcional)`;
      follow.hidden = false;
      comment.focus();
    };
    return b;
  });

  follow.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (score === null) return;
    send.disabled = true;
    error.hidden = true;
    try {
      await api('/api/nps', { method: 'POST', body: { score, comment: comment.value, context: contextOf() } });
      card.replaceChildren(h('p', { class: 'nps-thanks' }, 'Obrigado pela resposta! Ela nos ajuda a melhorar o portal.'));
      setTimeout(remove, 3500);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      send.disabled = false;
    }
  });

  card.append(
    close,
    h('h2', { id: 'nps-title' }, `De 0 a 10, quanto o ${portalName} te ajuda no dia a dia?`),
    h('div', { class: 'nps-scale', role: 'group', 'aria-label': 'Nota de 0 a 10' }, buttons),
    h('div', { class: 'nps-ends', 'aria-hidden': 'true' }, h('span', {}, 'Nada'), h('span', {}, 'Muito')),
    follow,
  );
  document.body.append(card);
}

// getPortalName é opcional: sem ele (ferramentas e Benchmarking), o nome vem da configuração do portal.
export async function initNps(getPortalName) {
  let ask = false;
  try {
    ({ ask } = await api('/api/nps'));
  } catch {
    return;
  }
  if (!ask) return;
  loadStyle();
  if (!getPortalName) {
    let name = 'portal';
    await api('/api/config')
      .then((cfg) => (name = cfg.portalName || name))
      .catch(() => {});
    getPortalName = () => name;
  }
  setTimeout(function attempt() {
    // Só aparece com a aba visível; se estiver oculta, espera a pessoa voltar.
    if (document.visibilityState === 'visible') showCard(getPortalName());
    else document.addEventListener('visibilitychange', attempt, { once: true });
  }, SHOW_AFTER_MS);
}

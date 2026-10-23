// Visões salvas: a pessoa guarda os filtros que usa sempre ("Fazenda X, último mês") e
// reabre com um clique, pelo menu "Visões" do relatório ou pela tela inicial.
import { api, h, toast } from './common.js';

// Formulário para dar nome à visão. Resolve com o nome digitado (ou null se cancelar).
function askName(suggestion) {
  return new Promise((resolve) => {
    const name = h('input', { id: 'view-name', type: 'text', maxlength: '60', value: suggestion || '', autocomplete: 'off', placeholder: 'Ex.: Fazenda X, último mês' });
    const error = h('div', { class: 'alert', role: 'alert', hidden: true });
    const dialog = h('dialog', {});
    let result = null;
    const form = h(
      'form',
      { novalidate: true },
      h('h2', {}, 'Salvar visão'),
      h('p', { class: 'muted', style: 'margin: 0' }, 'Guarda os filtros, as segmentações e a aba que estão na tela agora. Depois é só escolher a visão para abrir o relatório assim.'),
      h('label', { class: 'field' }, h('span', {}, 'Nome da visão'), name, h('small', {}, 'Se já existir uma visão com este nome, ela é atualizada.')),
      error,
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Cancelar'),
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar'),
      ),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!name.value.trim()) {
        error.textContent = 'Dê um nome para a visão.';
        error.hidden = false;
        name.focus();
        return;
      }
      result = name.value.trim();
      dialog.close();
    });
    dialog.append(form);
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
    name.select();
  });
}

// getState: () => ({ report, embedded, client, views, currentViewId })
// onChange: (views, currentViewId) => void
export function setupViews({ button, menu, getState, onChange }) {
  const close = () => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };

  async function apply(view) {
    close();
    const { embedded, report } = getState();
    if (!embedded || !report) return;
    try {
      const { view: full } = await api(`/api/views/${encodeURIComponent(view.id)}`);
      await embedded.bookmarksManager.applyState(full.state);
      onChange(getState().views, view.id);
      toast(`Visão "${view.name}" aplicada.`);
    } catch (err) {
      toast(`Não foi possível aplicar a visão: ${err.message || 'tente de novo.'}`, 'error');
    }
  }

  async function saveCurrent() {
    close();
    const { embedded, report, client, views, currentViewId } = getState();
    if (!embedded || !report) return;
    let state;
    try {
      state = (await embedded.bookmarksManager.capture({ personalizeVisuals: true }))?.state;
    } catch {
      state = null;
    }
    if (!state) {
      toast('Não foi possível ler os filtros deste relatório agora. Espere ele terminar de carregar.', 'error');
      return;
    }
    const name = await askName(views.find((v) => v.id === currentViewId)?.name || '');
    if (!name) return;
    try {
      const result = await api(`/api/reports/${encodeURIComponent(report.id)}/views`, { method: 'POST', body: { name, state, client } });
      onChange(result.views, result.view.id);
      toast(result.updated ? `Visão "${name}" atualizada.` : `Visão "${name}" salva. Ela aparece em "Visões" e na tela inicial.`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function remove(view) {
    try {
      const { views } = await api(`/api/views/${encodeURIComponent(view.id)}`, { method: 'DELETE', body: {} });
      const { currentViewId } = getState();
      onChange(views, currentViewId === view.id ? null : currentViewId);
      if (!menu.hidden) render();
      toast(`Visão "${view.name}" apagada.`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function render() {
    const { report, views, currentViewId } = getState();
    const list = report ? views.filter((v) => v.reportId === report.id) : [];
    menu.replaceChildren(
      ...(list.length
        ? list.map((v) => {
            // Apagar pede um segundo clique, para não perder uma visão sem querer.
            const del = h('button', { class: 'btn btn-ghost btn-sm view-del', type: 'button', 'aria-label': `Apagar a visão ${v.name}`, title: 'Apagar' }, '×');
            del.addEventListener('click', (e) => {
              e.stopPropagation();
              if (del.dataset.confirm) return remove(v);
              del.dataset.confirm = '1';
              del.textContent = 'Apagar?';
              del.classList.add('confirm');
            });
            return h(
              'div',
              { class: 'view-row' },
              h('button', { class: 'btn btn-ghost btn-sm view-apply', type: 'button', 'aria-current': v.id === currentViewId ? 'true' : 'false', onclick: () => apply(v) }, v.id === currentViewId ? `✓ ${v.name}` : v.name),
              del,
            );
          })
        : [h('p', { class: 'muted views-empty' }, 'Nenhuma visão salva neste relatório. Aplique os filtros que você usa sempre e salve aqui.')]),
      h('hr', { class: 'menu-sep' }),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: saveCurrent }, '+ Salvar filtros atuais…'),
    );
  }

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = menu.hidden;
    if (opening) render();
    menu.hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  return { close };
}

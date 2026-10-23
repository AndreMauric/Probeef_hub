// "Minha equipe" no portal: o gestor da empresa cadastra e gerencia as pessoas das fazendas dele.
import { api, copyText, h, toast } from './common.js';

let dialog;

function ensureDialog() {
  if (!dialog) {
    dialog = h('dialog', { id: 'team-dialog', class: 'dialog-wide' });
    document.body.append(dialog);
  }
  return dialog;
}

const fmtAgo = (iso) => {
  if (!iso) return 'Nunca entrou';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return 'Entrou hoje';
  if (days === 1) return 'Entrou ontem';
  return `Entrou há ${days} dias`;
};

function frame(title, body, actions) {
  const d = ensureDialog();
  d.replaceChildren(h('div', { class: 'team-body' }, h('h2', {}, title), body, h('div', { class: 'dialog-actions' }, actions)));
  if (!d.open) d.showModal();
}

function showPassword(name, email, password) {
  const code = h('code', {}, password);
  frame(
    'Senha temporária',
    h(
      'div',
      { style: 'display: grid; gap: 12px' },
      h('p', { style: 'margin: 0' }, `Envie estes dados para ${name}. A senha aparece só agora; a pessoa vai trocá-la no primeiro acesso.`),
      h('p', { style: 'margin: 0' }, 'Portal: ', h('strong', {}, location.origin)),
      h('p', { style: 'margin: 0' }, 'E-mail: ', h('strong', {}, email)),
      h('div', { class: 'secret' }, code, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(password, code) }, 'Copiar')),
    ),
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openTeam() }, 'Voltar para a equipe'),
  );
}

// Formulário de pessoa (nova ou existente).
function personForm(data, person) {
  const error = h('div', { class: 'alert', role: 'alert', hidden: true });
  const name = h('input', { id: 'team-name', type: 'text', value: person?.name || '', autocomplete: 'off' });
  const email = h('input', { id: 'team-email', type: 'email', value: person?.email || '', autocomplete: 'off', disabled: Boolean(person) });
  const boxes = data.clients.map((c) => ({
    c,
    box: h('input', { type: 'checkbox', value: c.id, checked: person ? person.clientIds.includes(c.id) : data.clients.length === 1 }),
  }));
  const active = h('input', { id: 'team-active', type: 'checkbox', checked: person ? person.active : true });
  // O botão fica na barra de ações, fora do formulário, ligado a ele pelo atributo "form".
  const save = h('button', { class: 'btn btn-primary', type: 'submit', form: 'team-person-form' }, person ? 'Salvar' : 'Adicionar');
  const form = h(
    'form',
    { class: 'team-form', id: 'team-person-form', novalidate: true },
    h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', {}, 'Nome'), name), h('label', { class: 'field' }, h('span', {}, 'E-mail'), email)),
    h(
      'div',
      { class: 'field' },
      h('span', {}, 'Fazendas que a pessoa vê'),
      h('div', { class: 'checkbox-list' }, boxes.map(({ c, box }) => h('label', { class: 'check' }, box, h('span', {}, c.name)))),
      person?.otherClients ? h('small', {}, `Também tem acesso a ${person.otherClients} fazenda(s) de fora da sua empresa (não aparecem aqui).`) : null,
    ),
    person ? h('label', { class: 'check' }, active, h('span', {}, 'Acesso ativo (desmarque para bloquear a entrada no portal)')) : null,
    error,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    save.disabled = true;
    const body = { name: name.value, clientIds: boxes.filter((b) => b.box.checked).map((b) => b.c.id) };
    try {
      if (person) {
        await api(`/api/team/${person.id}`, { method: 'PUT', body: { ...body, active: active.checked } });
        toast('Pessoa atualizada.');
        openTeam();
      } else {
        const result = await api('/api/team', { method: 'POST', body: { ...body, email: email.value } });
        showPassword(result.user.name, result.user.email, result.password);
      }
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      save.disabled = false;
    }
  });
  frame(
    person ? `Editar ${person.name}` : 'Adicionar pessoa',
    form,
    [h('button', { class: 'btn', type: 'button', onclick: () => openTeam() }, 'Voltar'), save],
  );
  name.focus();
}

async function resetPassword(person) {
  frame(
    'Gerar nova senha',
    h('p', { style: 'margin: 0' }, `Uma nova senha temporária será gerada para ${person.name}. A senha atual deixa de funcionar.`),
    [
      h('button', { class: 'btn', type: 'button', onclick: () => openTeam() }, 'Cancelar'),
      h(
        'button',
        {
          class: 'btn btn-primary',
          type: 'button',
          onclick: async () => {
            try {
              const { password } = await api(`/api/team/${person.id}/reset-password`, { method: 'POST', body: {} });
              showPassword(person.name, person.email, password);
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
        'Gerar senha',
      ),
    ],
  );
}

export async function openTeam() {
  let data;
  try {
    data = await api('/api/team');
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const clientName = new Map(data.clients.map((c) => [c.id, c.name]));
  const rows = data.users.map((u) =>
    h(
      'tr',
      {},
      h(
        'td',
        {},
        h('strong', {}, u.name, u.isMe ? ' (você)' : ''),
        h('span', { class: 'sub' }, u.email),
        u.isManager ? h('span', { class: 'pill pill-accent' }, 'Gestor') : null,
      ),
      h('td', {}, u.clientIds.map((id) => clientName.get(id)).join(', ')),
      h('td', {}, u.active ? h('span', { class: 'pill pill-ok' }, 'Ativo') : h('span', { class: 'pill pill-off' }, 'Desativado'), h('span', { class: 'sub' }, fmtAgo(u.lastLoginAt))),
      h(
        'td',
        { class: 'actions' },
        u.isMe || u.isManager
          ? h('span', { class: 'muted' }, u.isMe ? '' : 'Só o administrador altera')
          : [
              h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => personForm(data, u) }, 'Editar'),
              u.otherClients ? null : h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => resetPassword(u) }, 'Nova senha'),
            ],
      ),
    ),
  );
  frame(
    'Minha equipe',
    h(
      'div',
      { style: 'display: grid; gap: 12px' },
      h('p', { style: 'margin: 0' }, `Pessoas com acesso a ${data.clients.length === 1 ? data.clients[0].name : 'suas fazendas'} no portal. Você pode adicionar pessoas, escolher o que cada uma vê e bloquear acessos.`),
      h(
        'div',
        { class: 'table-wrap table-scroll' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, ['Pessoa', 'Fazendas', 'Situação', ''].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, rows),
        ),
      ),
    ),
    [
      h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, 'Fechar'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => personForm(data) }, 'Adicionar pessoa'),
    ],
  );
}

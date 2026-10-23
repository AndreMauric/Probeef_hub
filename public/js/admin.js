import { api, copyText, h, loadConfig, logout, openPasswordDialog, setupMenu, toast } from './common.js';

const state = { reports: [], clients: [], users: [], status: null, me: null, backups: [], images: [], categories: [], tags: [] };
const dialog = document.getElementById('dialog');

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca';
const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');
const fold = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
// Filtra uma lista pelo texto digitado na busca da seção.
const matches = (searchId, ...fields) => {
  const term = fold(document.getElementById(searchId)?.value.trim());
  return !term || fields.some((f) => fold(f).includes(term));
};

// ---------- Diálogos ----------

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
}

function input(id, { value = '', type = 'text', placeholder, required, autocomplete } = {}) {
  return h('input', { id, name: id, type, value, placeholder, required, autocomplete: autocomplete || 'off' });
}

// Abre um formulário no diálogo; onSubmit recebe o form e retorna true para fechar.
function formDialog(title, body, { submitLabel = 'Salvar', onSubmit, danger } = {}) {
  const error = h('div', { class: 'alert', role: 'alert', hidden: true });
  const submit = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'submit' }, submitLabel);
  const form = h(
    'form',
    { novalidate: true },
    h('h2', {}, title),
    body,
    error,
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => dialog.close() }, onSubmit ? 'Cancelar' : 'Fechar'),
      onSubmit ? submit : null,
    ),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      if ((await onSubmit(form)) !== false) dialog.close();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  dialog.replaceChildren(form);
  if (!dialog.open) dialog.showModal();
  form.querySelector('input:not([type=checkbox]), select, textarea')?.focus();
}

function confirmDialog(title, message, onConfirm, label = 'Excluir') {
  formDialog(title, h('p', { style: 'margin: 0' }, message), { submitLabel: label, danger: true, onSubmit: onConfirm });
}

function showPassword(title, email, password) {
  const code = h('code', {}, password);
  formDialog(
    title,
    h(
      'div',
      { style: 'display: grid; gap: 12px' },
      h('p', { style: 'margin: 0' }, 'Envie estes dados ao usuário. A senha aparece só agora e ele vai trocá-la no primeiro acesso.'),
      field('E-mail', h('code', { class: 'mono' }, email)),
      h('div', { class: 'secret' }, code, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(password, code) }, 'Copiar')),
    ),
  );
}

// ---------- Tabelas ----------

function table(el, headers, rows, emptyText) {
  el.replaceChildren(
    h('thead', {}, h('tr', {}, headers.map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { class: 'empty', colspan: headers.length }, emptyText))),
  );
}

function renderCounts() {
  document.getElementById('count-reports').textContent = state.reports.length;
  document.getElementById('count-clients').textContent = state.clients.length;
  document.getElementById('count-users').textContent = state.users.length;
  const pending = state.users.filter((u) => u.confinamento?.status === 'pending').length;
  const confinamentoCount = document.getElementById('count-confinamento');
  confinamentoCount.textContent = pending ? `${pending} pedido${pending > 1 ? 's' : ''} 4M` : '';
  confinamentoCount.classList.toggle('has-high', pending > 0);
}

function renderReports() {
  const usage = (id) => state.clients.filter((c) => c.reportIds.includes(id)).length;
  table(
    document.getElementById('reports-table'),
    ['Relatório', 'Categoria', 'Segurança', 'Clientes', ''],
    [...state.reports].filter((r) => matches('search-reports', r.name, r.category)).sort(byName).map((r) =>
      h(
        'tr',
        {},
        h('td', {}, h('strong', {}, r.name), h('span', { class: 'sub mono' }, r.reportId)),
        h('td', {}, r.category),
        h('td', {}, r.rls ? h('span', { class: 'pill pill-accent' }, 'RLS') : h('span', { class: 'pill' }, 'Sem RLS')),
        h('td', { class: 'mono' }, usage(r.id)),
        h(
          'td',
          { class: 'actions' },
          h('a', { class: 'btn btn-sm btn-ghost', href: `/portal#${r.id}` }, 'Abrir'),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => notifyClients(r) }, 'Avisar clientes'),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => reportDialog(r) }, 'Editar'),
          h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: () => deleteReport(r) }, 'Excluir'),
        ),
      ),
    ),
    'Nenhum relatório cadastrado. Use "Importar do workspace" ou "Novo relatório".',
  );
}

function renderClients() {
  const userCount = (id) => state.users.filter((u) => u.clientIds.includes(id)).length;
  table(
    document.getElementById('clients-table'),
    ['Cliente', 'Tags', 'Relatórios', 'Usuários', 'RLS', 'Situação', ''],
    [...state.clients]
      .filter((c) => matches('search-clients', c.name))
      .filter((c) => {
        const tag = document.getElementById('clients-tag-filter')?.value;
        if (!tag) return true;
        if (tag === '__none') return !(c.tagIds || []).length;
        return (c.tagIds || []).includes(tag);
      })
      .sort(byName)
      .map((c) =>
      h(
        'tr',
        {},
        h('td', {}, h('strong', {}, c.name)),
        h('td', {}, tagChips(c.tagIds)),
        h('td', { class: 'mono' }, c.reportIds.length),
        h('td', { class: 'mono' }, userCount(c.id)),
        h(
          'td',
          {},
          c.rlsUsername
            ? [h('span', { class: 'mono' }, c.rlsUsername), h('span', { class: 'sub' }, c.rlsRoles.join(', '))]
            : h('span', { class: 'muted' }, 'Não configurado'),
        ),
        h('td', {}, c.active ? h('span', { class: 'pill pill-ok' }, 'Ativo') : h('span', { class: 'pill pill-off' }, 'Desativado')),
        h(
          'td',
          { class: 'actions' },
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => clientDialog(c) }, 'Editar'),
          h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: () => deleteClient(c) }, 'Excluir'),
        ),
      ),
    ),
    'Nenhum cliente cadastrado ainda.',
  );
}

function renderUsers() {
  const clientNames = (u) => u.clientIds.map((id) => state.clients.find((c) => c.id === id)?.name).filter(Boolean).sort();
  const access = (u) => {
    if (u.role === 'admin') return h('span', { class: 'pill pill-accent' }, 'Administrador');
    const names = clientNames(u);
    if (!names.length) return h('span', { class: 'muted' }, 'Nenhum cliente');
    const shown = names.slice(0, 2).join(', ');
    return [
      h('span', { title: names.join(', ') }, names.length > 2 ? `${shown} +${names.length - 2}` : shown),
      u.isManager ? h('span', { class: 'pill pill-accent', style: 'margin-left: 6px' }, 'Gestor') : null,
    ];
  };
  table(
    document.getElementById('users-table'),
    ['Usuário', 'Acesso', '4M Confinamento', 'Último login', 'Situação', ''],
    [...state.users].filter((u) => matches('search-users', u.name, u.email, ...clientNames(u))).sort(byName).map((u) =>
      h(
        'tr',
        {},
        h('td', {}, h('strong', {}, u.name), h('span', { class: 'sub' }, u.email), u.phone ? h('span', { class: 'sub mono' }, `WhatsApp +${u.phone}`) : null, u.hasAssistant ? h('span', { class: 'sub' }, '✦ assistente ativo') : null),
        h('td', {}, access(u)),
        h('td', {}, confinamentoCell(u)),
        h('td', { class: 'mono' }, fmtDate(u.lastLoginAt)),
        h('td', {}, u.active ? h('span', { class: 'pill pill-ok' }, 'Ativo') : h('span', { class: 'pill pill-off' }, 'Desativado')),
        h(
          'td',
          { class: 'actions' },
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => userDialog(u) }, 'Editar'),
          u.role === 'client' && u.active
            ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => impersonate(u) }, 'Entrar como')
            : null,
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => resetPassword(u) }, 'Nova senha'),
          u.id !== state.me.id
            ? h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: () => deleteUser(u) }, 'Excluir')
            : null,
        ),
      ),
    ),
    'Nenhum usuário cadastrado.',
  );
}

// ---------- 4M Confinamento ----------

async function setConfinamentoAccess(user, action) {
  await api(`/api/admin/users/${user.id}/confinamento`, { method: 'POST', body: { action } });
  await refresh();
}

function confinamentoCell(u) {
  if (u.role === 'admin') return h('span', { class: 'muted' }, '—');
  const status = u.confinamento?.status || 'none';
  const pill =
    status === 'approved'
      ? h('span', { class: 'pill pill-ok' }, 'Aprovado')
      : status === 'pending'
        ? h('span', { class: 'pill pill-accent' }, 'Pedido pendente')
        : status === 'denied'
          ? h('span', { class: 'pill pill-off' }, 'Negado')
          : h('span', { class: 'muted' }, 'Sem acesso');
  const actions = [];
  if (status === 'approved') {
    actions.push(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => setConfinamentoAccess(u, 'revoke') }, 'Revogar'));
  } else {
    actions.push(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => setConfinamentoAccess(u, 'approve') }, 'Aprovar'));
    if (status === 'pending') actions.push(h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: () => setConfinamentoAccess(u, 'deny') }, 'Negar'));
  }
  return h('div', { style: 'display:flex; flex-direction:column; align-items:flex-start; gap:4px' }, pill, h('div', { class: 'actions' }, actions));
}

function renderStatus() {
  const s = state.status;
  if (!s) return;
  document.getElementById('status').replaceChildren(
    h(
      'div',
      { class: 'status-card' },
      h('p', { class: 'label' }, 'Power BI'),
      s.powerbiConfigured ? h('span', { class: 'pill pill-ok' }, 'Credenciais configuradas') : h('span', { class: 'pill pill-off' }, 'Não configurado'),
      h('p', {}, s.powerbiConfigured
        ? 'O servidor tem as credenciais do service principal. Se um relatório não abrir, a mensagem de erro indica o motivo.'
        : 'Preencha PBI_TENANT_ID, PBI_CLIENT_ID e PBI_CLIENT_SECRET no arquivo .env e reinicie o servidor.'),
    ),
    h(
      'div',
      { class: 'status-card' },
      h('p', { class: 'label' }, 'Workspace padrão'),
      h('strong', { class: 'mono' }, s.defaultWorkspaceId || 'Não definido'),
      h('p', {}, 'Usado para importar relatórios. Defina em PBI_WORKSPACE_ID.'),
    ),
    backupCard(),
    h(
      'div',
      { class: 'status-card', style: 'grid-column: 1 / -1' },
      h('p', { class: 'label' }, 'Checklist no Azure e no Power BI'),
      h(
        'ol',
        { class: 'checklist' },
        h('li', {}, 'Registre um aplicativo no Microsoft Entra ID e crie um segredo do cliente.'),
        h('li', {}, 'No portal de administração do Power BI, habilite "Entidades de serviço podem usar APIs do Fabric" para um grupo de segurança que contenha o app.'),
        h('li', {}, 'Adicione o app como Membro ou Administrador do workspace dos relatórios.'),
        h('li', {}, 'Atribua o workspace a uma capacidade (SKU F ou A). Sem capacidade, os tokens de embed são só para testes.'),
        h('li', {}, 'Para RLS, crie as funções no Power BI Desktop e use USERNAME() ou CUSTOMDATA() nos filtros.'),
      ),
    ),
  );
}

// ---------- Imagens ----------

const imageById = (id) => state.images.find((i) => i.id === id);

function imageThumb(image, className = 'admin-thumb') {
  return image
    ? h('span', { class: className }, h('img', { src: image.url, alt: '', loading: 'lazy' }))
    : h('span', { class: `${className} placeholder`, 'aria-hidden': 'true' });
}

// Janela para escolher uma imagem da biblioteca. Resolve com o id escolhido, null para "nenhuma"
// ou undefined se a pessoa fechar sem escolher.
function pickImage({ title, currentId = null, noneLabel = 'Sem imagem' }) {
  const picker = document.getElementById('picker');
  return new Promise((resolve) => {
    let chosen;
    const choose = (id) => {
      chosen = id;
      picker.close();
    };
    const option = (id, label, image) =>
      h(
        'button',
        // O foco começa na opção atual, para não parecer que há duas selecionadas.
        { class: `pick${id === currentId ? ' selected' : ''}`, type: 'button', autofocus: id === currentId, onclick: () => choose(id) },
        image ? imageThumb(image, 'pick-media') : h('span', { class: 'pick-media placeholder', 'aria-hidden': 'true' }),
        h('span', {}, label, id === currentId ? h('span', { class: 'pick-current' }, ' · atual') : null),
      );
    picker.replaceChildren(
      h(
        'div',
        { class: 'picker-body' },
        h('h2', {}, title),
        state.images.length
          ? h('div', { class: 'pick-grid' }, option(null, noneLabel, null), state.images.map((img) => option(img.id, img.name, img)))
          : h('p', { class: 'muted' }, 'A biblioteca está vazia. Envie imagens na aba Imagens.'),
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => picker.close() }, 'Cancelar')),
      ),
    );
    picker.addEventListener('close', () => resolve(chosen), { once: true });
    picker.showModal();
  });
}

function renderImages() {
  document.getElementById('count-images').textContent = state.images.length || '';
  document.getElementById('image-grid').replaceChildren(
    ...(state.images.length
      ? state.images.map((img) => {
          const uses = [...img.categories.map((c) => `Categoria ${c}`), img.reports ? `${img.reports} relatório(s)` : null].filter(Boolean);
          return h(
            'figure',
            { class: 'image-card' },
            imageThumb(img, 'image-card-media'),
            h(
              'figcaption',
              {},
              h('strong', {}, img.name),
              h('span', { class: 'muted' }, uses.length ? `Usada em: ${uses.join(' · ')}` : 'Não usada'),
              h(
                'span',
                { class: 'image-actions' },
                h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => renameImage(img) }, 'Renomear'),
                h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: () => deleteImage(img) }, 'Excluir'),
              ),
            ),
          );
        })
      : [h('p', { class: 'muted' }, 'Nenhuma imagem enviada ainda.')]),
  );
}

async function uploadImages(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  let ok = 0;
  for (const file of list) {
    try {
      const res = await fetch(`/api/admin/images?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
      ok += 1;
    } catch (err) {
      toast(`${file.name}: ${err.message}`, 'error');
    }
  }
  await refresh();
  if (ok) toast(ok === 1 ? 'Imagem enviada.' : `${ok} imagens enviadas.`);
}

// ---------- Categorias ----------

const categoryById = (id) => state.categories.find((c) => c.id === id);

// Lista de categorias cadastradas para escolher num formulário.
function categorySelect(id, selectedId, { placeholder = 'Escolha a categoria' } = {}) {
  return h(
    'select',
    { id, name: id, required: true },
    h('option', { value: '', disabled: true, selected: !selectedId }, placeholder),
    state.categories.map((c) => h('option', { value: c.id, selected: c.id === selectedId }, c.name)),
  );
}

function renderCategories() {
  document.getElementById('count-categories').textContent = state.categories.length || '';
  table(
    document.getElementById('categories-table'),
    ['Imagem', 'Categoria', 'Relatórios', ''],
    state.categories.map((c) => {
      const exceptions = [
        c.ownImages ? `${c.ownImages} com imagem própria` : null,
        c.ownDescriptions ? `${c.ownDescriptions} com descrição própria` : null,
      ].filter(Boolean);
      return h(
        'tr',
        {},
        h('td', { class: 'thumb-cell' }, imageThumb(imageById(c.imageId))),
        h(
          'td',
          {},
          h('strong', {}, c.name),
          h('span', { class: 'sub' }, c.description || 'Sem descrição'),
          exceptions.length ? h('span', { class: 'sub' }, exceptions.join(' · ')) : null,
        ),
        h('td', { class: 'mono' }, c.reports),
        h(
          'td',
          { class: 'actions' },
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => categoryDialog(c) }, 'Editar'),
          h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: () => deleteCategory(c) }, 'Excluir'),
        ),
      );
    }),
    'Nenhuma categoria cadastrada. Crie a primeira em "Nova categoria".',
  );
}

function categoryDialog(category) {
  let imageId = category?.imageId || null;
  const imageField = h('div', { class: 'image-field' });
  const renderImageField = () => {
    const image = imageById(imageId);
    imageField.replaceChildren(
      imageThumb(image),
      h('span', {}, image ? image.name : 'Sem imagem (aparece o símbolo da Probeef)'),
      h(
        'button',
        {
          class: 'btn btn-sm',
          type: 'button',
          onclick: async () => {
            const picked = await pickImage({ title: 'Imagem da categoria', currentId: imageId, noneLabel: 'Sem imagem' });
            if (picked === undefined) return;
            imageId = picked;
            renderImageField();
          },
        },
        'Escolher',
      ),
    );
  };
  renderImageField();
  formDialog(
    category ? 'Editar categoria' : 'Nova categoria',
    [
      field('Nome', input('category-name', { value: category?.name, required: true, placeholder: 'Ex.: Forecast' })),
      field(
        'Descrição',
        h('textarea', { id: 'category-description', name: 'category-description', placeholder: 'Ex.: Projeção de desempenho e resultado dos lotes em confinamento.' }, category?.description || ''),
        'Aparece para o cliente nos relatórios desta categoria que não têm descrição própria.',
      ),
      h('div', { class: 'field' }, h('span', {}, 'Imagem'), imageField, h('small', {}, 'Envie imagens novas na aba Imagens.')),
    ],
    {
      onSubmit: async (form) => {
        const body = {
          name: form.elements['category-name'].value,
          description: form.elements['category-description'].value,
          imageId,
        };
        if (category) await api(`/api/admin/categories/${category.id}`, { method: 'PUT', body });
        else await api('/api/admin/categories', { method: 'POST', body });
        await refresh();
        toast(category ? 'Categoria atualizada.' : 'Categoria criada.');
      },
    },
  );
}

function deleteCategory(category) {
  confirmDialog('Excluir categoria', `A categoria "${category.name}" será excluída. Só é possível excluir categorias sem relatórios.`, async () => {
    await api(`/api/admin/categories/${category.id}`, { method: 'DELETE', body: {} });
    await refresh();
    toast('Categoria excluída.');
  });
}

function renameImage(image) {
  formDialog('Renomear imagem', field('Nome', input('image-name', { value: image.name, required: true })), {
    onSubmit: async (form) => {
      await api(`/api/admin/images/${image.id}`, { method: 'PUT', body: { name: form.elements['image-name'].value } });
      await refresh();
      toast('Imagem renomeada.');
    },
  });
}

function deleteImage(image) {
  confirmDialog(
    'Excluir imagem',
    `"${image.name}" será excluída. As categorias e relatórios que usam essa imagem voltam a aparecer sem imagem.`,
    async () => {
      await api(`/api/admin/images/${image.id}`, { method: 'DELETE', body: {} });
      await refresh();
      toast('Imagem excluída.');
    },
  );
}

function setupImageUpload() {
  const input = document.getElementById('image-files');
  const zone = document.getElementById('drop-zone');
  document.getElementById('upload-images').onclick = () => input.click();
  input.onchange = () => {
    uploadImages(input.files);
    input.value = '';
  };
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    uploadImages(e.dataTransfer.files);
  });
}

// ---------- WhatsApp ----------

const sim = { userId: null };

function statusCard(label, ok, okText, offText, note) {
  return h(
    'div',
    { class: 'status-card' },
    h('p', { class: 'label' }, label),
    ok ? h('span', { class: 'pill pill-ok' }, okText) : h('span', { class: 'pill pill-off' }, offText),
    note ? h('p', {}, note) : null,
  );
}

async function loadBot() {
  let s;
  try {
    s = await api('/api/admin/bot/status');
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  document.getElementById('bot-status').replaceChildren(
    statusCard('WhatsApp', s.whatsapp.configured, 'Conectado', 'Não conectado', s.whatsapp.configured ? null : 'Preencha WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET e WHATSAPP_VERIFY_TOKEN nas variáveis do servidor. Enquanto isso, teste pelo simulador.'),
    statusCard('Perguntas com IA', s.ai > 0, `${s.ai} cliente(s) com chave`, 'Nenhum cliente com chave', 'Cada usuário cadastra a própria chave da Anthropic em Conta → Meu assistente, no portal.'),
    statusCard('Avisos de atualização', Boolean(s.whatsapp.updateTemplate), `Modelo: ${s.whatsapp.updateTemplate}`, 'Sem modelo aprovado', s.whatsapp.updateTemplate ? `${s.usersNotify} usuário(s) com avisos ligados.` : 'Crie e aprove o modelo de mensagem na Meta e informe o nome em WHATSAPP_TEMPLATE_UPDATE.'),
    statusCard('Clientes com WhatsApp', s.usersWithPhone > 0, `${s.usersWithPhone} de ${s.clientUsers}`, `0 de ${s.clientUsers}`, 'Cadastre o telefone em Usuários → Editar.'),
  );
  table(
    document.getElementById('bot-log'),
    ['Quando', 'Quem', 'Mensagem'],
    s.messages.slice(0, 40).map((m) =>
      h(
        'tr',
        {},
        h('td', { class: 'mono' }, fmtDate(m.at)),
        h('td', {}, m.user || (m.phone ? `+${m.phone}` : '—'), h('span', { class: 'sub' }, `${m.direction === 'in' ? 'recebida' : 'enviada'}${m.channel === 'simulator' ? ' · simulador' : ''}`)),
        h('td', { class: 'log-text' }, m.text),
      ),
    ),
    'Nenhuma mensagem ainda.',
  );

  const select = document.getElementById('sim-user');
  const clients = state.users.filter((u) => u.role === 'client' && u.active).sort(byName);
  if (!sim.userId || !clients.some((u) => u.id === sim.userId)) sim.userId = clients[0]?.id || null;
  select.replaceChildren(
    ...(clients.length
      ? clients.map((u) => h('option', { value: u.id, selected: u.id === sim.userId }, `${u.name}${u.phone ? ` · +${u.phone}` : ''}`))
      : [h('option', { value: '' }, 'Cadastre um usuário de cliente primeiro')]),
  );
}

// Transforma *negrito* e _itálico_ do WhatsApp em texto formatado, sem usar HTML vindo do servidor.
function whatsappText(text) {
  const out = h('div', { class: 'bubble-text' });
  for (const line of String(text).split('\n')) {
    const p = h('p', {});
    for (const part of line.split(/(\*[^*\n]+\*|_[^_\n]+_|https?:\/\/\S+)/g)) {
      if (!part) continue;
      if (/^\*[^*]+\*$/.test(part)) p.append(h('strong', {}, part.slice(1, -1)));
      else if (/^_[^_]+_$/.test(part)) p.append(h('em', {}, part.slice(1, -1)));
      else if (/^https?:\/\//.test(part)) p.append(h('a', { href: part, target: '_blank', rel: 'noopener' }, part));
      else p.append(part);
    }
    out.append(p);
  }
  return out;
}

function addBubble(kind, content) {
  const chat = document.getElementById('sim-chat');
  const bubble = h('div', { class: `bubble ${kind}` }, content);
  chat.append(bubble);
  chat.scrollTop = chat.scrollHeight;
  return bubble;
}

async function sendSim(text) {
  if (!sim.userId) {
    toast('Cadastre um usuário de cliente para simular.', 'error');
    return;
  }
  addBubble('me', whatsappText(text));
  const typing = addBubble('bot typing', 'digitando…');
  const button = document.querySelector('#sim-form button');
  button.disabled = true;
  try {
    const { replies } = await api('/api/admin/bot/simulate', { method: 'POST', body: { userId: sim.userId, text } });
    typing.remove();
    for (const r of replies) {
      if (r.type === 'text') addBubble('bot', whatsappText(r.text));
      else addBubble('bot', h('a', { class: 'doc', href: r.url }, h('strong', {}, `📄 ${r.fileName}`), h('span', {}, 'PDF · clique para baixar')));
    }
  } catch (err) {
    typing.remove();
    addBubble('bot error', err.message);
  } finally {
    button.disabled = false;
    loadBot();
  }
}

function setupSimulator() {
  document.getElementById('sim-user').addEventListener('change', (e) => {
    sim.userId = e.target.value;
    document.getElementById('sim-chat').replaceChildren();
  });
  document.getElementById('sim-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const field = document.getElementById('sim-text');
    const text = field.value.trim();
    if (!text) return;
    field.value = '';
    sendSim(text);
  });
}

// ---------- Backup ----------

function backupCard() {
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => restoreFrom(file) });
  const fmtDateOnly = (day) => day.split('-').reverse().join('/');
  return h(
    'div',
    { class: 'status-card backup-card', style: 'grid-column: 1 / -1' },
    h('p', { class: 'label' }, 'Backup dos cadastros'),
    h('p', {}, 'Usuários, clientes e relatórios. O arquivo inclui as senhas criptografadas: guarde-o em local seguro e não compartilhe.'),
    h(
      'div',
      { class: 'viewer-actions' },
      h('a', { class: 'btn btn-primary btn-sm', href: '/api/admin/backup' }, 'Baixar backup agora'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => file.click() }, 'Restaurar de um arquivo'),
      file,
    ),
    h('p', { class: 'label', style: 'margin-top: 8px' }, 'Cópias automáticas (uma por dia, últimos 14 dias)'),
    state.backups.length
      ? h(
          'div',
          { class: 'backup-list' },
          state.backups.map((b) =>
            h('a', { class: 'pill', href: `/api/admin/backups/${encodeURIComponent(b.name)}` }, `${fmtDateOnly(b.date)} · ${Math.max(1, Math.round(b.size / 1024))} KB`),
          ),
        )
      : h('p', {}, 'A primeira cópia é feita automaticamente assim que houver cadastros.'),
  );
}

async function restoreFrom(input) {
  const picked = input.files?.[0];
  input.value = '';
  if (!picked) return;
  let backup;
  try {
    backup = JSON.parse(await picked.text());
  } catch {
    toast('Este arquivo não é um JSON válido.', 'error');
    return;
  }
  const d = backup?.data || {};
  const when = backup?.exportedAt ? new Date(backup.exportedAt).toLocaleString('pt-BR') : 'data desconhecida';
  confirmDialog(
    'Restaurar backup',
    `Todos os cadastros atuais serão substituídos pelos do arquivo "${picked.name}" (de ${when}): ${d.users?.length ?? 0} usuários, ${d.clients?.length ?? 0} clientes e ${d.reports?.length ?? 0} relatórios. Recomendo baixar um backup do estado atual antes.`,
    async () => {
      const result = await api('/api/admin/restore', { method: 'POST', body: { backup } });
      if (result.loggedOut) {
        location.href = '/';
        return;
      }
      await refresh();
      toast(`Backup restaurado: ${result.counts.clients} clientes, ${result.counts.reports} relatórios, ${result.counts.users} usuários.`);
    },
    'Substituir cadastros',
  );
}

function renderAll() {
  renderCounts();
  renderTagFilters();
  renderImages();
  renderCategories();
  renderReports();
  renderClients();
  renderUsers();
  renderStatus();
}

async function refresh() {
  const [r, c, u, s, b, img, cat, tg] = await Promise.all([
    api('/api/admin/reports'),
    api('/api/admin/clients'),
    api('/api/admin/users'),
    api('/api/admin/status'),
    api('/api/admin/backups'),
    api('/api/admin/images'),
    api('/api/admin/categories'),
    api('/api/admin/tags'),
  ]);
  Object.assign(state, {
    reports: r.reports,
    clients: c.clients,
    users: u.users,
    status: s,
    backups: b.backups,
    images: img.images,
    categories: cat.categories,
    tags: tg.tags,
  });
  renderAll();
}

// ---------- Relatórios ----------

function reportDialog(report) {
  const rls = h('input', { id: 'rls', name: 'rls', type: 'checkbox', checked: Boolean(report?.rls) });
  let imageId = report?.imageId || null;
  const category = categorySelect('categoryId', report?.categoryId);
  const description = h('textarea', { id: 'description', name: 'description' }, report?.description || '');
  const imagePreview = h('div', { class: 'image-field' });
  // A descrição e a imagem da categoria escolhida aparecem como padrão.
  const syncCategory = () => {
    description.placeholder = categoryById(category.value)?.description
      ? `Em branco: usa a da categoria ("${categoryById(category.value).description}")`
      : 'Em branco: sem descrição';
    renderImageField();
  };
  const renderImageField = () => {
    const own = imageById(imageId);
    const fromCategory = imageById(categoryById(category.value)?.imageId);
    imagePreview.replaceChildren(
      imageThumb(own || fromCategory),
      h('span', {}, own ? `Imagem própria: ${own.name}` : fromCategory ? `Usando a da categoria (${fromCategory.name})` : 'Sem imagem'),
      h(
        'button',
        {
          class: 'btn btn-sm',
          type: 'button',
          onclick: async () => {
            const picked = await pickImage({ title: 'Imagem deste relatório', currentId: imageId, noneLabel: 'Usar a da categoria' });
            if (picked === undefined) return;
            imageId = picked;
            renderImageField();
          },
        },
        'Escolher',
      ),
    );
  };
  category.addEventListener('change', syncCategory);
  syncCategory();
  formDialog(
    report ? 'Editar relatório' : 'Novo relatório',
    [
      field('Nome', input('name', { value: report?.name, required: true })),
      h(
        'div',
        { class: 'grid-2' },
        field('Categoria', category, state.categories.length ? null : 'Crie categorias na aba Categorias.'),
        field('ID do workspace', input('workspaceId', { value: report?.workspaceId || state.status?.defaultWorkspaceId || '', required: true })),
      ),
      field('ID do relatório', input('reportId', { value: report?.reportId, required: true }), 'Na URL do relatório: app.powerbi.com/groups/{workspace}/reports/{relatório}.'),
      field('Descrição', description, 'Deixe em branco para usar a descrição da categoria.'),
      h('div', { class: 'field' }, h('span', {}, 'Imagem do card'), imagePreview),
      h('label', { class: 'check' }, rls, h('span', {}, h('strong', {}, 'Usa segurança por linha (RLS)'), h('br'), h('span', { class: 'muted' }, 'Cada cliente verá só os dados do próprio filtro de RLS.'))),
    ],
    {
      onSubmit: async (form) => {
        const body = Object.fromEntries(new FormData(form));
        body.rls = rls.checked;
        body.imageId = imageId;
        if (report) await api(`/api/admin/reports/${report.id}`, { method: 'PUT', body });
        else await api('/api/admin/reports', { method: 'POST', body });
        await refresh();
        toast(report ? 'Relatório atualizado.' : 'Relatório cadastrado.');
      },
    },
  );
}

async function notifyClients(report) {
  let preview;
  try {
    preview = await api(`/api/admin/reports/${report.id}/notify-preview`);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const names = preview.recipients;
  const ready = preview.whatsapp.configured && preview.whatsapp.updateTemplate;
  const body = h(
    'div',
    { style: 'display: grid; gap: 10px' },
    h('p', { style: 'margin: 0' }, `Envia pelo WhatsApp o aviso de que "${report.name}" foi atualizado.`),
    names.length
      ? h('p', { style: 'margin: 0' }, `Recebem ${names.length} ${names.length === 1 ? 'pessoa' : 'pessoas'}: ${names.join(', ')}.`)
      : h('p', { class: 'muted', style: 'margin: 0' }, 'Ninguém receberia: nenhum usuário com acesso a este relatório tem WhatsApp cadastrado e avisos ligados.'),
    ready ? null : h('p', { class: 'alert', style: 'margin: 0' }, 'O WhatsApp ainda não está conectado (ou falta o modelo de mensagem aprovado). Veja a aba WhatsApp.'),
  );
  formDialog('Avisar clientes', body, {
    submitLabel: 'Enviar aviso',
    onSubmit: ready && names.length
      ? async () => {
          const result = await api(`/api/admin/reports/${report.id}/notify`, { method: 'POST', body: {} });
          toast(`Aviso enviado para ${result.sent} ${result.sent === 1 ? 'pessoa' : 'pessoas'}${result.failed ? ` (${result.failed} falharam)` : ''}.`);
        }
      : undefined,
  });
}

function deleteReport(report) {
  confirmDialog('Excluir relatório', `"${report.name}" será removido do portal e de todos os clientes. O relatório continua existindo no Power BI.`, async () => {
    await api(`/api/admin/reports/${report.id}`, { method: 'DELETE', body: {} });
    await refresh();
    toast('Relatório excluído.');
  });
}

function importDialog() {
  const ws = input('workspace', { value: state.status?.defaultWorkspaceId || '', placeholder: 'ID do workspace' });
  const list = h('div', { class: 'checkbox-list', hidden: true });
  let loaded = null;

  const load = async () => {
    list.hidden = false;
    list.replaceChildren(h('p', { class: 'muted', style: 'margin: 0' }, 'Buscando relatórios…'));
    try {
      loaded = await api(`/api/admin/workspace-reports?workspaceId=${encodeURIComponent(ws.value.trim())}`);
      list.replaceChildren(
        ...(loaded.reports.length
          ? loaded.reports.map((r) =>
              h(
                'label',
                { class: 'check' },
                h('input', { type: 'checkbox', value: r.reportId, disabled: r.registered, checked: false }),
                h('span', {}, r.name, r.registered ? h('span', { class: 'muted' }, ' (já cadastrado)') : null),
              ),
            )
          : [h('p', { class: 'muted', style: 'margin: 0' }, 'Nenhum relatório neste workspace.')]),
      );
    } catch (err) {
      loaded = null;
      list.replaceChildren(h('p', { class: 'alert', style: 'margin: 0' }, err.message));
    }
  };

  formDialog(
    'Importar do workspace',
    [
      h('div', { class: 'secret' }, ws, h('button', { class: 'btn', type: 'button', onclick: load }, 'Buscar')),
      list,
      field('Categoria dos importados', categorySelect('import-category', null), 'Os relatórios recebem a descrição e a imagem desta categoria.'),
    ],
    {
      submitLabel: 'Importar selecionados',
      onSubmit: async (form) => {
        const picked = [...list.querySelectorAll('input:checked')].map((i) => i.value);
        if (!loaded || !picked.length) throw new Error('Busque o workspace e marque ao menos um relatório.');
        const categoryId = form.elements['import-category'].value;
        if (!categoryId) throw new Error('Escolha a categoria dos relatórios importados.');
        for (const r of loaded.reports.filter((x) => picked.includes(x.reportId))) {
          await api('/api/admin/reports', {
            method: 'POST',
            body: { name: r.name, categoryId, workspaceId: loaded.workspaceId, reportId: r.reportId, rls: false },
          });
        }
        await refresh();
        toast(`${picked.length} ${picked.length === 1 ? 'relatório importado' : 'relatórios importados'}.`);
      },
    },
  );
  if (ws.value) load();
}

// ---------- Alertas ----------

const SEVERITY = {
  alta: { label: 'Prioridade alta', cls: 'sev-alta' },
  media: { label: 'Atenção', cls: 'sev-media' },
  baixa: { label: 'Para acompanhar', cls: 'sev-baixa' },
};
const ALERT_ICON = { inativo: '⏸', esfriando: '❄', nunca: '○', queda: '↘', semlogin: '👤', falha: '⚠', desatualizado: '🕘', nps: '☹' };

function updateAlertCount(data) {
  const n = data.counts.alta + data.counts.media;
  const el = document.getElementById('count-alerts');
  el.textContent = n || '';
  el.classList.toggle('has-high', data.counts.alta > 0);
}

async function loadAlerts() {
  let data;
  try {
    data = await api('/api/admin/alerts');
  } catch (err) {
    document.getElementById('alerts').replaceChildren(h('p', { class: 'alert' }, err.message));
    return;
  }
  renderAlerts(data);
}

function alertActions(a) {
  const actions = [];
  if (a.clientId && ['inativo', 'esfriando', 'nunca', 'queda', 'nps'].includes(a.type)) {
    actions.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => clientDetail(a.clientId) }, 'Ver uso do cliente'));
    const person = state.users.find((u) => u.role === 'client' && u.active && u.clientIds.includes(a.clientId));
    if (person) actions.push(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => impersonate(person) }, 'Entrar como cliente'));
  }
  if (a.type === 'semlogin') {
    actions.push(
      h(
        'button',
        {
          class: 'btn btn-sm',
          type: 'button',
          onclick: () => {
            document.getElementById('search-users').value = a.client;
            selectTab('users');
            renderUsers();
          },
        },
        'Ver pessoas',
      ),
    );
  }
  if (a.type === 'falha' || a.type === 'desatualizado') {
    actions.push(h('button', { class: 'btn btn-sm', type: 'button', onclick: () => selectTab('health') }, 'Ver saúde dos dados'));
  }
  const snooze = async (days) => {
    try {
      renderAlerts(await api(`/api/admin/alerts/${encodeURIComponent(a.id)}/snooze`, { method: 'POST', body: { days } }));
      toast(`Alerta adiado por ${days} dias.`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  actions.push(
    h('span', { class: 'alert-snooze' }, h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => snooze(7) }, 'Adiar 7 dias'), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => snooze(30) }, '30 dias')),
  );
  return actions;
}

function renderAlerts(data) {
  updateAlertCount(data);
  const box = document.getElementById('alerts');
  const groups = Object.entries(SEVERITY)
    .map(([sev, meta]) => {
      const list = data.alerts.filter((a) => a.severity === sev);
      if (!list.length) return null;
      return h(
        'section',
        { class: 'alert-group' },
        h('h3', { class: `usage-title ${meta.cls}` }, `${meta.label} · ${list.length}`),
        list.map((a) =>
          h(
            'article',
            { class: `alert-card ${meta.cls}` },
            h('span', { class: 'alert-icon', 'aria-hidden': 'true' }, ALERT_ICON[a.type] || '•'),
            h('div', { class: 'alert-main' }, h('strong', {}, a.title), h('p', {}, a.detail), h('div', { class: 'alert-actions' }, alertActions(a))),
          ),
        ),
      );
    })
    .filter(Boolean);
  box.replaceChildren(
    ...[
      h(
        'div',
        { class: 'stats' },
        statTile('Prioridade alta', num(data.counts.alta)),
        statTile('Atenção', num(data.counts.media)),
        statTile('Para acompanhar', num(data.counts.baixa)),
        statTile('Adiados', num(data.snoozed), data.snoozed ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', style: 'justify-self: start; padding: 0', onclick: unsnoozeAll }, 'Mostrar de novo') : null),
      ),
      data.dataCheckedAt ? null : h('p', { class: 'muted usage-hint' }, 'A saúde dos dados ainda não foi verificada; os alertas de dados aparecem depois da primeira verificação.'),
      ...(groups.length ? groups : [h('p', { class: 'alert alert-ok' }, 'Nenhum alerta. Clientes e dados em dia. 🎉')]),
    ].filter(Boolean),
  );
}

async function unsnoozeAll() {
  try {
    renderAlerts(await api('/api/admin/alerts/unsnooze', { method: 'POST', body: {} }));
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function copyDigest() {
  try {
    const { text } = await api('/api/admin/alerts/digest');
    const pre = h('pre', { class: 'digest' }, text);
    formDialog('Resumo dos alertas', [
      h('p', { class: 'muted', style: 'margin: 0' }, 'Texto pronto para colar no WhatsApp ou num e-mail.'),
      pre,
      h('div', {}, h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => copyText(text, pre) }, 'Copiar texto')),
    ]);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Saúde dos dados ----------

const DATA_STATUS = {
  falha: { label: 'Falha na atualização', cls: 'pill-off' },
  erro: { label: 'Não verificado', cls: 'pill-off' },
  desatualizado: { label: 'Desatualizado', cls: 'pill-warn' },
  'sem-info': { label: 'Sem data', cls: 'pill' },
  pendente: { label: 'Aguardando verificação', cls: 'pill' },
  ok: { label: 'Em dia', cls: 'pill-ok' },
};
const healthState = { data: null, filter: 'problemas', timer: null };
const fmtDateOnly = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

async function loadHealth() {
  try {
    healthState.data = await api('/api/admin/data-health');
  } catch (err) {
    document.getElementById('health').replaceChildren(h('p', { class: 'alert' }, err.message));
    return;
  }
  renderHealth();
  // Enquanto a verificação roda, acompanha o andamento.
  clearTimeout(healthState.timer);
  if (healthState.data.scan.running) healthState.timer = setTimeout(loadHealth, 3000);
}

function renderHealth() {
  const d = healthState.data;
  if (!d) return;
  const t = d.totals;
  const problems = t.desatualizado + t.falha;
  document.getElementById('count-health').textContent = problems || '';
  const scanBtn = document.getElementById('health-scan');
  scanBtn.disabled = d.scan.running;
  scanBtn.textContent = d.scan.running ? `Verificando… ${d.scan.done} de ${d.scan.total}` : 'Verificar agora';
  document.getElementById('health-checked').textContent = d.scan.checkedAt ? `Última verificação: ${fmtDate(d.scan.checkedAt)}` : 'Ainda não verificado';

  const filters = [
    ['problemas', `Com problema · ${problems}`],
    ['falha', `Falha · ${t.falha}`],
    ['desatualizado', `Desatualizados · ${t.desatualizado}`],
    ['sem-info', `Sem data · ${t.semInfo}`],
    ['ok', `Em dia · ${t.ok}`],
    ['todos', `Todos · ${t.total}`],
  ];
  const visible = d.reports.filter((r) => {
    if (healthState.filter === 'todos') return true;
    if (healthState.filter === 'problemas') return ['falha', 'erro', 'desatualizado'].includes(r.status);
    if (healthState.filter === 'falha') return ['falha', 'erro'].includes(r.status);
    if (healthState.filter === 'sem-info') return ['sem-info', 'pendente'].includes(r.status);
    return r.status === healthState.filter;
  });

  const tableEl = h('table');
  const attemptLabel = { Completed: 'concluída', Failed: 'falhou', Disabled: 'desativada', Cancelled: 'cancelada' };
  table(
    tableEl,
    ['Relatório', 'Situação', 'Dados de', 'Última tentativa', 'Agendamento', 'O que fazer'],
    visible.map((r) =>
      h(
        'tr',
        {},
        h('td', {}, h('strong', {}, r.name), h('span', { class: 'sub' }, [r.clients.join(', '), r.category].filter(Boolean).join(' · '))),
        h('td', {}, h('span', { class: `pill ${DATA_STATUS[r.status]?.cls || ''}` }, DATA_STATUS[r.status]?.label || r.status)),
        h(
          'td',
          { class: 'mono', title: r.source ? `Fonte: ${r.source}` : '' },
          fmtDateOnly(r.dataDate),
          r.ageDays !== null ? h('span', { class: 'sub' }, r.ageDays === 0 ? 'hoje' : r.ageDays === 1 ? 'há 1 dia' : `há ${num(r.ageDays)} dias`) : null,
        ),
        h('td', {}, r.lastAttempt ? [attemptLabel[r.lastAttempt.status] || r.lastAttempt.status, h('span', { class: 'sub mono' }, fmtDate(r.lastAttempt.at))] : h('span', { class: 'muted' }, 'nenhuma registrada')),
        h('td', {}, r.scheduleEnabled === null ? '—' : r.scheduleEnabled ? h('span', { class: 'pill pill-ok' }, 'Ligado') : h('span', { class: 'pill' }, 'Desligado')),
        h('td', { class: 'health-fix' }, healthAdvice(r)),
      ),
    ),
    healthState.filter === 'problemas' ? 'Nenhum relatório com problema. 🎉' : 'Nenhum relatório nesta situação.',
  );

  const staleInput = h('input', { id: 'stale-days', type: 'text', inputmode: 'numeric', value: String(d.settings.staleDays), 'aria-label': 'Dias para considerar desatualizado' });
  const showDate = h('input', { id: 'show-data-date', type: 'checkbox', checked: d.settings.showDataDate });
  const saveSettings = async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { staleDays: staleInput.value, showDataDate: showDate.checked } });
      toast('Configuração salva.');
      loadHealth();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  document.getElementById('health').replaceChildren(
    ...[
    h(
      'div',
      { class: 'stats' },
      statTile('Em dia', num(t.ok), h('span', { class: 'muted' }, `dados com até ${d.settings.staleDays} dias`)),
      statTile('Desatualizados', num(t.desatualizado), h('span', { class: 'muted' }, `mais de ${d.settings.staleDays} dias`)),
      statTile('Com falha', num(t.falha), h('span', { class: 'muted' }, 'atualização falhou ou foi desativada')),
      statTile('Sem data', num(t.semInfo), h('span', { class: 'muted' }, 'sem histórico nem tabela de atualização')),
    ),
    h(
      'div',
      { class: 'health-settings' },
      h('label', { class: 'field inline-field' }, h('span', {}, 'Considerar desatualizado após'), staleInput, h('span', {}, 'dias')),
      h('label', { class: 'check' }, showDate, h('span', {}, 'Mostrar para os clientes a data dos dados (selo no topo do relatório)')),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: saveSettings }, 'Salvar'),
    ),
    sectionTitle(
      'Relatórios',
      h(
        'div',
        { class: 'chips' },
        filters.map(([k, label]) =>
          h(
            'button',
            {
              class: `chip${healthState.filter === k ? ' selected' : ''}`,
              type: 'button',
              'aria-pressed': String(healthState.filter === k),
              onclick: () => {
                healthState.filter = k;
                renderHealth();
              },
            },
            label,
          ),
        ),
      ),
    ),
    scrollTable(tableEl),
    d.unassigned ? h('p', { class: 'muted usage-hint', style: 'margin-top: 10px' }, `${num(d.unassigned)} relatório(s) cadastrado(s) sem cliente não entram na verificação.`) : null,
    ].filter(Boolean),
  );
}

// Orientação curta do que fazer em cada caso.
function healthAdvice(r) {
  if (r.status === 'falha' || r.status === 'erro') return r.failure || 'Verifique a atualização no Power BI.';
  if (r.status === 'desatualizado') {
    if (r.scheduleEnabled === false) return 'A atualização agendada está desligada. Ligue no Power BI ou republique o relatório com dados novos.';
    return 'Os dados estão antigos. Confira a fonte de dados ou republique o relatório.';
  }
  if (r.status === 'sem-info') return 'Sem como saber a data. Dica: inclua no modelo uma tabela "Última Atualização" com a data e a hora.';
  if (r.status === 'pendente') return 'Será verificado na próxima varredura.';
  return '';
}

// ---------- Uso ----------

const fmtDay = (day) => {
  const [, m, d] = day.split('-');
  return `${d}/${m}`;
};
const daysSince = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null);
const fmtAgo = (iso) => {
  const days = daysSince(iso);
  if (days === null) return 'Nunca';
  if (days <= 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  return `Há ${days} dias`;
};
const fmtMinutes = (min) => {
  if (!min) return '0 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};
const num = (n) => Number(n || 0).toLocaleString('pt-BR');

const HEALTH = {
  ativo: { label: 'Ativo', cls: 'pill-ok', hint: 'acessou nos últimos 7 dias' },
  esfriando: { label: 'Esfriando', cls: 'pill-warn', hint: 'último acesso entre 8 e 30 dias' },
  inativo: { label: 'Inativo', cls: 'pill-off', hint: 'mais de 30 dias sem acessar' },
  nunca: { label: 'Nunca acessou', cls: 'pill', hint: 'nenhum acesso registrado' },
};
const healthPill = (status) =>
  HEALTH[status] ? h('span', { class: `pill ${HEALTH[status].cls}`, title: HEALTH[status].hint }, HEALTH[status].label) : null;

const usageState = { data: null, metric: 'views', health: 'todos', tagIds: [] };

// Filtro por tags do painel de uso (recalcula tudo no servidor).
function renderUsageTagFilter() {
  const box = document.getElementById('usage-tags');
  if (!box) return;
  box.hidden = !state.tags.length;
  if (!state.tags.length) return;
  const toggle = (id) => {
    usageState.tagIds = usageState.tagIds.includes(id) ? usageState.tagIds.filter((x) => x !== id) : [...usageState.tagIds, id];
    usageState.health = 'todos';
    renderUsageTagFilter();
    loadUsage();
  };
  box.replaceChildren(
    h('span', { class: 'label' }, 'Filtrar por tag'),
    ...tagGroups().map(([group, tags]) =>
      h(
        'span',
        { class: 'tag-filter-group' },
        group ? h('span', { class: 'muted' }, `${group}:`) : null,
        tags.map((t) =>
          h(
            'button',
            {
              class: `tag c${t.color || 0} tag-toggle${usageState.tagIds.includes(t.id) ? ' on' : ''}`,
              type: 'button',
              'aria-pressed': String(usageState.tagIds.includes(t.id)),
              onclick: () => toggle(t.id),
            },
            t.name,
          ),
        ),
      ),
    ),
    usageState.tagIds.length
      ? h(
          'button',
          {
            class: 'btn btn-sm btn-ghost',
            type: 'button',
            onclick: () => {
              usageState.tagIds = [];
              renderUsageTagFilter();
              loadUsage();
            },
          },
          'Limpar filtro',
        )
      : '',
  );
}

// Descrição do filtro ativo: "Grande ou Médio · Região Sul".
function describeTagFilter() {
  const chosen = usageState.tagIds.map(tagById).filter(Boolean);
  return tagGroups(chosen)
    .map(([, tags]) => tags.map((t) => t.name).join(' ou '))
    .join(' e ');
}

// Variação em relação ao período anterior, com seta e texto (não só cor).
function delta(cur, prev) {
  if (!prev && !cur) return h('span', { class: 'delta flat' }, 'sem uso nos dois períodos');
  if (!prev) return h('span', { class: 'delta up' }, '▲ novo no período');
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return h('span', { class: 'delta flat' }, '= igual ao período anterior');
  return h('span', { class: `delta ${pct > 0 ? 'up' : 'down'}` }, `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs. período anterior`);
}

function statTile(label, value, extra) {
  return h('div', { class: 'stat' }, h('p', { class: 'label' }, label), h('strong', {}, value), extra || null);
}

function barChart(series, metric, title) {
  const values = series.map((d) => d[metric]);
  const max = Math.max(1, ...values);
  const unit = metric === 'views' ? ['acesso', 'acessos'] : ['usuário ativo', 'usuários ativos'];
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const plot = h('div', { class: 'chart-plot' }, h('div', { class: 'chart-grid' }));
  const bars = series.map((d) => {
    const v = d[metric];
    const label = `${fmtDay(d.day)}: ${num(v)} ${v === 1 ? unit[0] : unit[1]}`;
    const slot = h('div', { class: 'bar-slot', tabindex: '0', 'aria-label': label }, h('div', { class: 'bar', style: `height: ${v ? Math.max((v / max) * 100, 2) : 0}%` }));
    const show = () => {
      tip.textContent = label;
      tip.hidden = false;
      const a = slot.getBoundingClientRect();
      const b = plot.getBoundingClientRect();
      tip.style.left = `${a.left - b.left + a.width / 2}px`;
    };
    slot.addEventListener('mouseenter', show);
    slot.addEventListener('focus', show);
    slot.addEventListener('mouseleave', () => (tip.hidden = true));
    slot.addEventListener('blur', () => (tip.hidden = true));
    return slot;
  });
  plot.append(h('div', { class: 'bars' }, bars), tip);
  const mid = series[Math.floor(series.length / 2)];
  return h(
    'figure',
    { class: 'chart' },
    h('figcaption', {}, h('span', { class: 'label' }, title), h('span', { class: 'muted' }, `máximo de ${num(max)} em um dia`)),
    plot,
    h('div', { class: 'chart-axis' }, h('span', {}, fmtDay(series[0].day)), h('span', {}, fmtDay(mid.day)), h('span', {}, fmtDay(series.at(-1).day))),
  );
}

// Mapa de calor dia da semana × hora (horário de Brasília), uma cor só: mais escuro = mais acessos.
function heatmap(grid) {
  const names = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const max = Math.max(1, ...grid.flat());
  const total = grid.flat().reduce((a, b) => a + b, 0);
  let peak = { v: 0, d: 0, hr: 0 };
  grid.forEach((row, d) => row.forEach((v, hr) => v > peak.v && (peak = { v, d, hr })));
  const cells = [];
  grid.forEach((row, d) => {
    cells.push(h('span', { class: 'hm-day' }, names[d]));
    row.forEach((v, hr) => {
      const label = `${names[d]}, ${String(hr).padStart(2, '0')}h: ${num(v)} ${v === 1 ? 'acesso' : 'acessos'}`;
      cells.push(h('span', { class: 'hm-cell', title: label, 'aria-label': label, style: `--v: ${v ? 0.15 + 0.85 * (v / max) : 0}` }));
    });
  });
  return h(
    'figure',
    { class: 'chart' },
    h(
      'figcaption',
      {},
      h('span', { class: 'label' }, 'Quando os clientes acessam'),
      h('span', { class: 'muted' }, total ? `pico: ${names[peak.d].toLowerCase()} às ${String(peak.hr).padStart(2, '0')}h` : 'sem acessos no período'),
    ),
    h('div', { class: 'hm' }, cells, h('span', {}), ...Array.from({ length: 24 }, (_, hr) => h('span', { class: 'hm-hour' }, hr % 3 === 0 ? `${hr}h` : ''))),
    h('div', { class: 'hm-legend' }, h('span', { class: 'muted' }, 'menos'), h('span', { class: 'hm-scale' }), h('span', { class: 'muted' }, 'mais acessos')),
  );
}

function sectionTitle(text, extra) {
  return h('div', { class: 'usage-section-head' }, h('h3', { class: 'usage-title' }, text), extra || null);
}

function scrollTable(tableEl) {
  return h('div', { class: 'table-wrap table-scroll' }, tableEl);
}

function renderUsage() {
  const u = usageState.data;
  if (!u) return;
  const t = u.totals;
  const p = u.previous;
  const box = document.getElementById('usage');

  // Clientes, com filtro por situação.
  const chips = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Filtrar por situação' },
    [['todos', `Todos · ${u.clients.length}`], ...Object.entries(HEALTH).map(([k, v]) => [k, `${v.label} · ${u.health[k] || 0}`])].map(([k, label]) =>
      h(
        'button',
        {
          class: `chip${usageState.health === k ? ' selected' : ''}`,
          type: 'button',
          'aria-pressed': String(usageState.health === k),
          onclick: () => {
            usageState.health = k;
            renderUsage();
          },
        },
        label,
      ),
    ),
  );
  const clientList = u.clients.filter((c) => usageState.health === 'todos' || c.health === usageState.health);
  const clientsTable = h('table');
  table(
    clientsTable,
    ['Cliente', 'Situação', 'Acessos', 'Tempo', 'Usuários ativos', 'Último acesso'],
    clientList.map((c) =>
      h(
        'tr',
        { class: 'row-link', tabindex: '0', title: 'Ver detalhes', onclick: () => clientDetail(c.id), onkeydown: (e) => e.key === 'Enter' && clientDetail(c.id) },
        h('td', {}, h('strong', {}, c.name), c.tagIds?.length ? h('span', { class: 'sub' }, tagChips(c.tagIds)) : null),
        h('td', {}, healthPill(c.health)),
        h('td', { class: 'mono' }, num(c.views), c.prevViews || c.views ? h('span', { class: 'sub' }, `antes: ${num(c.prevViews)}`) : null),
        h('td', { class: 'mono' }, fmtMinutes(c.minutes)),
        h('td', { class: 'mono' }, `${c.activeUsers} de ${c.totalUsers}`),
        h('td', {}, fmtAgo(c.lastAccess)),
      ),
    ),
    'Nenhum cliente nesta situação.',
  );

  const reportsTable = h('table');
  table(
    reportsTable,
    ['Relatório', 'Acessos', 'Pessoas', 'Tempo total', 'Tempo médio', 'PDFs', 'Último acesso'],
    u.reports.map((r) =>
      h(
        'tr',
        { class: 'row-link', tabindex: '0', title: 'Ver as abas mais acessadas', onclick: () => reportPagesDialog(r.id), onkeydown: (e) => e.key === 'Enter' && reportPagesDialog(r.id) },
        h('td', {}, h('strong', {}, r.name), h('span', { class: 'sub' }, [r.category, r.clients.join(', ')].filter(Boolean).join(' · '))),
        h('td', { class: 'mono' }, num(r.views)),
        h('td', { class: 'mono' }, num(r.users)),
        h('td', { class: 'mono' }, fmtMinutes(r.minutes)),
        h('td', { class: 'mono' }, r.avgMinutes ? `${String(r.avgMinutes).replace('.', ',')} min` : '—'),
        h('td', { class: 'mono' }, num(r.exports)),
        h('td', {}, fmtAgo(r.lastView)),
      ),
    ),
    'Nenhum relatório acessado no período.',
  );

  const usersTable = h('table');
  table(
    usersTable,
    ['Usuário', 'Cliente', 'Acessos', 'Tempo', 'Perguntas', 'Último acesso'],
    u.users.map((x) =>
      h(
        'tr',
        {},
        h('td', {}, h('strong', {}, x.name), h('span', { class: 'sub' }, x.email)),
        h('td', {}, x.clients.join(', ') || '—'),
        h('td', { class: 'mono' }, num(x.views)),
        h('td', { class: 'mono' }, fmtMinutes(x.minutes)),
        h('td', { class: 'mono' }, num(x.questions)),
        h('td', {}, fmtAgo(x.lastAccess)),
      ),
    ),
    'Nenhum usuário de cliente.',
  );

  const feedLabels = { view: 'abriu', login: 'entrou no portal', export: 'gerou PDF de', ask: 'perguntou ao assistente' };
  const feedTable = h('table');
  table(
    feedTable,
    ['Quando', 'Quem', 'O quê'],
    u.recent.map((e) =>
      h(
        'tr',
        {},
        h('td', { class: 'mono' }, fmtDate(e.at)),
        h('td', {}, e.user, h('span', { class: 'sub' }, e.client)),
        h('td', {}, `${feedLabels[e.type] || e.type}${e.report ? ` ${e.report}` : ''}`),
      ),
    ),
    'Nada no período.',
  );

  const never = u.neverOpened.length
    ? h(
        'details',
        { class: 'never' },
        h('summary', {}, `${u.neverOpened.length} relatório(s) liberado(s) que nunca foram abertos`),
        h('ul', {}, u.neverOpened.map((r) => h('li', {}, h('strong', {}, r.name), ` · ${r.clients.join(', ') || r.category}`))),
      )
    : null;

  const metricToggle = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Métrica do gráfico' },
    [['views', 'Acessos'], ['users', 'Usuários ativos']].map(([k, label]) =>
      h(
        'button',
        {
          class: `chip${usageState.metric === k ? ' selected' : ''}`,
          type: 'button',
          'aria-pressed': String(usageState.metric === k),
          onclick: () => {
            usageState.metric = k;
            renderUsage();
          },
        },
        label,
      ),
    ),
  );

  // Comparação entre tags (sempre com todos os clientes).
  let tagSection = null;
  if (u.tags?.length) {
    const tagTable = h('table');
    let lastGroup = null;
    table(
      tagTable,
      ['Tag', 'Clientes', 'Ativos no período', 'Acessos', 'Acessos por cliente', 'Tempo por cliente', 'Saúde'],
      u.tags.map((g) => {
        const groupCell = g.group !== lastGroup ? g.group || 'Sem grupo' : '';
        lastGroup = g.group;
        return h(
          'tr',
          {
            class: 'row-link',
            tabindex: '0',
            title: 'Filtrar o painel por esta tag',
            onclick: () => {
              usageState.tagIds = [g.id];
              usageState.health = 'todos';
              renderUsageTagFilter();
              loadUsage();
            },
          },
          h('td', {}, groupCell ? h('span', { class: 'sub', style: 'margin-bottom: 4px' }, groupCell) : null, tagChip(g)),
          h('td', { class: 'mono' }, num(g.clients)),
          h('td', { class: 'mono' }, `${num(g.activeClients)} (${g.activeShare}%)`),
          h('td', { class: 'mono' }, num(g.views), h('span', { class: 'sub' }, `antes: ${num(g.prevViews)}`)),
          h('td', { class: 'mono' }, String(g.viewsPerClient).replace('.', ',')),
          h('td', { class: 'mono' }, fmtMinutes(g.minutesPerClient)),
          h(
            'td',
            {},
            h(
              'span',
              { class: 'health-mini' },
              Object.entries(HEALTH)
                .filter(([k]) => g.health[k])
                .map(([k, v]) => h('span', { class: `pill ${v.cls}`, title: v.hint }, `${v.label} ${g.health[k]}`)),
            ),
          ),
        );
      }),
      'Nenhuma tag.',
    );
    tagSection = [
      sectionTitle('Uso por tag'),
      h('p', { class: 'muted usage-hint' }, 'Compara os grupos de clientes no período, sempre com todos os clientes. Clique numa tag para filtrar o painel por ela.'),
      scrollTable(tagTable),
    ];
  }

  const filterNote = usageState.tagIds.length
    ? h(
        'p',
        { class: 'alert alert-ok filter-note' },
        `Mostrando só os ${num(u.filter.clients)} clientes com: ${describeTagFilter()}. Os números, gráficos, tabelas e o CSV seguem este filtro.`,
      )
    : null;

  box.replaceChildren(
    ...[
    filterNote,
    h(
      'div',
      { class: 'stats' },
      statTile('Acessos a relatórios', num(t.views), delta(t.views, p.views)),
      statTile('Usuários ativos', num(t.activeUsers), delta(t.activeUsers, p.activeUsers)),
      statTile('Clientes ativos', `${num(t.activeClients)} de ${num(u.clients.length)}`, delta(t.activeClients, p.activeClients)),
      statTile('Tempo de uso', fmtMinutes(t.minutes), delta(t.minutes, p.minutes)),
      statTile('PDFs exportados', num(t.exports), delta(t.exports, p.exports)),
      statTile('Perguntas ao assistente', num(t.questions), delta(t.questions, p.questions)),
    ),
    h(
      'div',
      { class: 'usage-split' },
      h('div', {}, sectionTitle('Uso por dia', metricToggle), barChart(u.byDay, usageState.metric, usageState.metric === 'views' ? 'Acessos por dia' : 'Usuários ativos por dia')),
      h('div', {}, sectionTitle('Horários'), heatmap(u.heatmap)),
    ),
    ...(tagSection || []),
    ...npsSection(u.nps),
    sectionTitle('Saúde dos clientes', chips),
    h('p', { class: 'muted usage-hint' }, 'Clique num cliente para ver usuários, relatórios e o uso dia a dia.'),
    scrollTable(clientsTable),
    sectionTitle('Relatórios'),
    h('p', { class: 'muted usage-hint' }, 'Clique num relatório para ver quais abas são mais acessadas.'),
    scrollTable(reportsTable),
    never,
    h(
      'div',
      { class: 'usage-split' },
      h('div', {}, sectionTitle('Usuários'), scrollTable(usersTable)),
      h('div', {}, sectionTitle('Atividade recente'), scrollTable(feedTable)),
    ),
    ].filter(Boolean),
  );
}

// ---------- Satisfação (NPS) ----------

const NPS_CAT = {
  promotor: { label: 'Promotor', cls: 'pill-ok' },
  neutro: { label: 'Neutro', cls: 'pill-off' },
  detrator: { label: 'Detrator', cls: 'pill-danger' },
};

function npsDelta(cur, prev) {
  if (cur === null || prev === null) return h('span', { class: 'delta flat' }, prev === null ? 'sem respostas no período anterior' : 'sem respostas no período');
  const diff = cur - prev;
  if (!diff) return h('span', { class: 'delta flat' }, '= igual ao período anterior');
  return h('span', { class: `delta ${diff > 0 ? 'up' : 'down'}` }, `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} pontos vs. período anterior`);
}

function npsSection(n) {
  if (!n) return [];
  const pct = (v) => (n.responses ? `${Math.round((v / n.responses) * 100)}%` : '—');
  const toggle = h('input', { id: 'nps-enabled', type: 'checkbox', checked: n.enabled });
  toggle.addEventListener('change', async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { npsEnabled: toggle.checked } });
      toast(toggle.checked ? 'A pesquisa voltou a aparecer para os clientes.' : 'A pesquisa não aparece mais para os clientes.');
      usageState.data.nps.enabled = toggle.checked;
    } catch (err) {
      toggle.checked = !toggle.checked;
      toast(err.message, 'error');
    }
  });
  const max = Math.max(1, ...n.distribution);
  const cat = (s) => (s >= 9 ? 'promotor' : s >= 7 ? 'neutro' : 'detrator');
  const dist = h(
    'div',
    { class: 'nps-dist', role: 'img', 'aria-label': `Distribuição das notas: ${n.distribution.map((v, s) => `nota ${s}: ${v}`).join(', ')}` },
    n.distribution.map((v, s) =>
      h(
        'div',
        { class: `nps-col ${cat(s)}`, title: `Nota ${s}: ${num(v)} ${v === 1 ? 'resposta' : 'respostas'}` },
        h('div', { class: 'nps-bar-slot' }, v ? h('span', { class: 'nps-count' }, num(v)) : null, h('div', { class: 'nps-bar', style: `height: ${v ? Math.max((v / max) * 100, 4) : 0}%` })),
        h('span', { class: 'nps-n' }, s),
      ),
    ),
  );
  const comments = h('table');
  table(
    comments,
    ['Quando', 'Pessoa', 'Cliente', 'Nota', 'Comentário'],
    n.recent.map((r) =>
      h(
        'tr',
        {},
        h('td', { class: 'mono' }, fmtDate(r.at)),
        h('td', {}, r.user),
        h('td', {}, r.clients.join(', ') || '—'),
        h('td', {}, h('span', { class: `pill ${NPS_CAT[r.category].cls}` }, `${r.score} · ${NPS_CAT[r.category].label}`)),
        h('td', { class: 'nps-comment' }, r.comment || h('span', { class: 'muted' }, 'Sem comentário')),
      ),
    ),
    'Nenhuma resposta no período.',
  );
  return [
    sectionTitle('Satisfação (NPS)', h('label', { class: 'check' }, toggle, h('span', {}, 'Perguntar aos clientes'))),
    h(
      'p',
      { class: 'muted usage-hint' },
      'A pergunta "De 0 a 10, quanto o portal te ajuda no dia a dia?" aparece no canto da tela para quem já abriu relatórios em pelo menos 2 dias, no máximo a cada 90 dias (quem fecha sem responder é perguntado de novo em 30). NPS = % de promotores (9–10) − % de detratores (0–6), de −100 a 100.',
    ),
    h(
      'div',
      { class: 'stats' },
      statTile('NPS', n.score === null ? '—' : String(n.score), npsDelta(n.score, n.previousScore)),
      statTile('Respostas', num(n.responses)),
      statTile('Promotores (9–10)', `${num(n.promoters)} · ${pct(n.promoters)}`),
      statTile('Neutros (7–8)', `${num(n.passives)} · ${pct(n.passives)}`),
      statTile('Detratores (0–6)', `${num(n.detractors)} · ${pct(n.detractors)}`),
    ),
    n.responses ? dist : null,
    n.responses ? h('p', { class: 'nps-legend' }, h('span', {}, h('i', { class: 'sw promotor' }), 'Promotores'), h('span', {}, h('i', { class: 'sw neutro' }), 'Neutros'), h('span', {}, h('i', { class: 'sw detrator' }), 'Detratores (viram alerta)')) : null,
    scrollTable(comments),
  ];
}

async function loadUsage() {
  const box = document.getElementById('usage');
  const days = document.getElementById('usage-days').value;
  const tags = usageState.tagIds.length ? `&tags=${usageState.tagIds.map(encodeURIComponent).join(',')}` : '';
  document.getElementById('usage-csv').href = `/api/admin/usage.csv?days=${days}${tags}`;
  if (!usageState.data) box.replaceChildren(h('p', { class: 'muted' }, 'Carregando…'));
  renderUsageTagFilter();
  try {
    const data = await api(`/api/admin/usage?days=${days}${tags}`);
    // Tela nova com servidor antigo (ainda não reiniciado ou publicado): avisa em vez de quebrar.
    if (!data.health || !data.previous) {
      box.replaceChildren(h('p', { class: 'alert' }, 'O servidor ainda está na versão anterior do painel de uso. Reinicie o servidor (ou aguarde a publicação) e recarregue a página.'));
      return;
    }
    usageState.data = data;
    renderUsage();
  } catch (err) {
    box.replaceChildren(h('p', { class: 'alert' }, err.message));
  }
}

const fmtSeconds = (sec) => (sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60} s` : ''}`);

// Abas (páginas) mais acessadas de um relatório.
async function reportPagesDialog(reportId) {
  const days = document.getElementById('usage-days').value;
  formDialog('Carregando…', h('p', { class: 'muted', style: 'margin: 0' }, 'Buscando as abas do relatório…'));
  dialog.classList.add('dialog-wide');
  dialog.addEventListener('close', () => dialog.classList.remove('dialog-wide'), { once: true });
  let d;
  try {
    d = await api(`/api/admin/usage/report/${reportId}?days=${days}`);
  } catch (err) {
    formDialog('Abas do relatório', h('p', { class: 'alert' }, err.message));
    return;
  }
  const max = Math.max(1, ...d.pages.map((p) => p.visits));
  const rows = d.pages.map((p, i) =>
    h(
      'div',
      { class: 'page-row' },
      h('span', { class: 'page-rank mono' }, i + 1),
      h(
        'div',
        { class: 'page-main' },
        h('div', { class: 'page-line' }, h('strong', {}, p.page), h('span', { class: 'mono' }, `${num(p.visits)} ${p.visits === 1 ? 'visita' : 'visitas'}`)),
        h('div', { class: 'page-bar', 'aria-hidden': 'true' }, h('span', { style: `width: ${Math.max((p.visits / max) * 100, 2)}%` })),
        h(
          'div',
          { class: 'page-meta' },
          `${p.seconds < 60 ? fmtSeconds(p.seconds) : fmtMinutes(Math.round(p.seconds / 60))} no total · ${p.timeShare}% do tempo · média de ${fmtSeconds(p.avgSeconds)} por visita · aberta em ${p.reach}% das sessões · ${num(p.people)} ${p.people === 1 ? 'pessoa' : 'pessoas'}`,
        ),
      ),
    ),
  );
  formDialog(`${d.report.name} · abas mais acessadas`, [
    h(
      'p',
      { class: 'muted', style: 'margin: 0' },
      `${d.report.category && d.report.category !== d.report.name ? `${d.report.category} · ` : ''}últimos ${d.days} dias · ${num(d.sessions)} ${d.sessions === 1 ? 'sessão' : 'sessões'} com abas registradas. O tempo conta só com a aba do navegador visível.`,
    ),
    d.pages.length
      ? h('div', { class: 'page-list' }, rows)
      : h('p', { class: 'alert alert-ok', style: 'margin: 0' }, 'Ainda não há abas registradas para este relatório no período. A medição por aba começou agora; ela aparece aqui conforme os clientes usarem o relatório.'),
  ]);
}

// Detalhe de um cliente num diálogo largo.
async function clientDetail(clientId) {
  const days = document.getElementById('usage-days').value;
  formDialog('Carregando…', h('p', { class: 'muted', style: 'margin: 0' }, 'Buscando o uso do cliente…'));
  dialog.classList.add('dialog-wide');
  dialog.addEventListener('close', () => dialog.classList.remove('dialog-wide'), { once: true });
  let d;
  try {
    d = await api(`/api/admin/usage/client/${clientId}?days=${days}`);
  } catch (err) {
    formDialog('Detalhe do cliente', h('p', { class: 'alert' }, err.message));
    return;
  }
  const t = d.totals;
  const usersTable = h('table');
  table(
    usersTable,
    ['Usuário', 'Acessos', 'Tempo', 'Perguntas', 'Último acesso', 'Último login'],
    d.users.map((x) =>
      h(
        'tr',
        {},
        h('td', {}, h('strong', {}, x.name), h('span', { class: 'sub' }, x.email), x.active ? null : h('span', { class: 'pill pill-off' }, 'Desativado')),
        h('td', { class: 'mono' }, num(x.views)),
        h('td', { class: 'mono' }, fmtMinutes(x.minutes)),
        h('td', { class: 'mono' }, num(x.questions)),
        h('td', {}, fmtAgo(x.lastAccess)),
        h('td', {}, fmtAgo(x.lastLogin)),
      ),
    ),
    'Este cliente ainda não tem usuários.',
  );
  const reportsTable = h('table');
  table(
    reportsTable,
    ['Relatório', 'Acessos', 'Pessoas', 'Tempo', 'Tempo médio', 'Último acesso'],
    d.reports.map((r) =>
      h(
        'tr',
        { class: 'row-link', tabindex: '0', title: 'Ver as abas mais acessadas', onclick: () => reportPagesDialog(r.id), onkeydown: (e) => e.key === 'Enter' && reportPagesDialog(r.id) },
        h('td', {}, h('strong', {}, r.name), h('span', { class: 'sub' }, r.category)),
        h('td', { class: 'mono' }, num(r.views)),
        h('td', { class: 'mono' }, num(r.users)),
        h('td', { class: 'mono' }, fmtMinutes(r.minutes)),
        h('td', { class: 'mono' }, r.avgMinutes ? `${String(r.avgMinutes).replace('.', ',')} min` : '—'),
        h('td', {}, fmtAgo(r.lastView)),
      ),
    ),
    'Nenhum relatório liberado.',
  );
  formDialog(`${d.client.name} · últimos ${d.days} dias`, [
    h(
      'div',
      { class: 'stats' },
      statTile('Acessos', num(t.views)),
      statTile('Usuários ativos', `${num(t.activeUsers)} de ${num(d.users.length)}`),
      statTile('Tempo de uso', fmtMinutes(t.minutes)),
      statTile('PDFs', num(t.exports)),
      statTile('Perguntas', num(t.questions)),
      statTile('Logins', num(t.logins)),
    ),
    barChart(d.byDay, 'views', 'Acessos por dia'),
    sectionTitle('Usuários'),
    scrollTable(usersTable),
    sectionTitle('Relatórios'),
    scrollTable(reportsTable),
  ]);
}

// ---------- Configuração automática ----------

async function setupWizard() {
  const status = h('p', { class: 'muted', style: 'margin: 0' }, 'Lendo os relatórios do workspace…');
  formDialog('Configuração automática', status, { submitLabel: 'Criar e liberar', onSubmit: async () => false });
  dialog.classList.add('dialog-wide');
  dialog.addEventListener('close', () => dialog.classList.remove('dialog-wide'), { once: true });

  let data;
  try {
    data = await api('/api/admin/setup-suggestions');
  } catch (err) {
    status.className = 'alert';
    status.textContent = err.message;
    return;
  }

  // Categorias cadastradas + as sugeridas pelos nomes que ainda não existem (criadas ao confirmar).
  const existing = new Set(state.categories.map((c) => c.name.toLowerCase()));
  const categoryChoices = [...new Map([...state.categories.map((c) => c.name), ...data.items.map((i) => i.category)].map((n) => [n.toLowerCase(), n])).values()].sort(
    (a, b) => a.localeCompare(b, 'pt-BR'),
  );
  const rows = data.items.map((item) => {
    const check = h('input', { type: 'checkbox', checked: !item.skip && !item.assigned, 'aria-label': `Incluir ${item.originalName}` });
    const client = h('input', { type: 'text', value: item.client, list: 'setup-clients', 'aria-label': 'Cliente' });
    const category = h(
      'select',
      { 'aria-label': 'Categoria' },
      categoryChoices.map((name) =>
        h('option', { value: name, selected: name.toLowerCase() === item.category.toLowerCase() }, existing.has(name.toLowerCase()) ? name : `${name} (nova)`),
      ),
    );
    const displayName = h('input', { type: 'text', value: item.displayName, 'aria-label': 'Nome exibido ao cliente' });
    const tr = h(
      'tr',
      {},
      h('td', {}, check),
      h('td', {}, h('span', { class: 'sub' }, item.originalName), item.assigned ? h('span', { class: 'pill pill-ok' }, 'já liberado') : null),
      h('td', {}, client),
      h('td', {}, category),
      h('td', {}, displayName),
    );
    const search = `${item.originalName} ${item.client}`.toLowerCase();
    return { item, tr, check, client, category, displayName, search };
  });

  const clientOptions = new Set([...data.clientNames, ...data.items.map((i) => i.client).filter(Boolean)]);
  const summary = h('p', { class: 'muted', style: 'margin: 0' });
  const filter = h('input', { type: 'search', placeholder: 'Filtrar por nome ou cliente', 'aria-label': 'Filtrar' });

  const visible = () => rows.filter((r) => !r.tr.hidden);
  const updateSummary = () => {
    const picked = rows.filter((r) => r.check.checked);
    const known = new Set(state.clients.map((c) => c.name.toLowerCase()));
    const newClients = new Set(picked.map((r) => r.client.value.trim()).filter((n) => n && !known.has(n.toLowerCase())));
    summary.textContent = `${picked.length} relatórios marcados · cerca de ${newClients.size} clientes novos · ${rows.length} no workspace`;
  };
  filter.addEventListener('input', () => {
    const term = filter.value.trim().toLowerCase();
    for (const r of rows) r.tr.hidden = term !== '' && !r.search.includes(term);
  });
  const setVisible = (value) => {
    for (const r of visible()) r.check.checked = value;
    updateSummary();
  };
  for (const r of rows) {
    r.check.addEventListener('change', updateSummary);
    r.client.addEventListener('change', updateSummary);
  }

  const body = [
    h('p', { style: 'margin: 0' }, 'Sugerimos cliente, categoria e nome de cada relatório a partir do nome no Power BI. Revise, corrija o que precisar e confirme. Relatórios já liberados vêm desmarcados.'),
    h(
      'div',
      { class: 'toolbar' },
      filter,
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => setVisible(true) }, 'Marcar visíveis'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => setVisible(false) }, 'Desmarcar visíveis'),
    ),
    h(
      'div',
      { class: 'table-wrap setup-table' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, ['', 'Relatório no Power BI', 'Cliente', 'Categoria', 'Nome para o cliente'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows.map((r) => r.tr)),
      ),
    ),
    summary,
    h('datalist', { id: 'setup-clients' }, [...clientOptions].sort().map((n) => h('option', { value: n }))),
  ];

  formDialog('Configuração automática', body, {
    submitLabel: 'Criar e liberar',
    onSubmit: async () => {
      const items = rows
        .filter((r) => r.check.checked)
        .map((r) => ({
          reportId: r.item.reportId,
          client: r.client.value,
          category: r.category.value,
          displayName: r.displayName.value,
        }));
      if (!items.length) throw new Error('Marque ao menos um relatório.');
      const result = await api('/api/admin/bulk-setup', { method: 'POST', body: { workspaceId: data.workspaceId, items } });
      await refresh();
      toast(`${result.reportsCreated} relatórios e ${result.clientsCreated} clientes criados · ${result.assignments} liberações.`);
    },
  });
  updateSummary();
}

// ---------- Tags ----------

const TAG_COLORS = ['Verde', 'Azul', 'Roxo', 'Rosa', 'Vermelho', 'Laranja', 'Amarelo', 'Cinza'];
const tagById = (id) => state.tags.find((t) => t.id === id);
const tagLabel = (t) => (t.group ? `${t.group}: ${t.name}` : t.name);

function tagChip(tag) {
  return tag ? h('span', { class: `tag c${tag.color || 0}`, title: tagLabel(tag) }, tag.name) : null;
}

function tagChips(ids = []) {
  const tags = ids.map(tagById).filter(Boolean);
  return tags.length ? h('span', { class: 'tag-list' }, tags.map(tagChip)) : h('span', { class: 'muted' }, '—');
}

// Tags agrupadas: [[grupo, [tags]]], grupos em ordem alfabética ("sem grupo" por último).
function tagGroups(tags = state.tags) {
  const groups = new Map();
  for (const t of tags) {
    const g = t.group || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(t);
  }
  return [...groups.entries()].sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b, 'pt-BR')));
}

// Filtro de tags na lista de clientes.
function renderTagFilters() {
  const select = document.getElementById('clients-tag-filter');
  if (!select) return;
  const current = select.value;
  select.replaceChildren(
    h('option', { value: '' }, 'Todas as tags'),
    h('option', { value: '__none' }, 'Sem tag'),
    tagGroups().map(([group, tags]) =>
      h('optgroup', { label: group || 'Outras' }, tags.map((t) => h('option', { value: t.id, selected: t.id === current }, `${t.name} (${t.clients})`))),
    ),
  );
  if (current === '__none') select.value = '__none';
  select.hidden = !state.tags.length;
}

function tagsManager() {
  const list = h(
    'div',
    { class: 'tag-manager' },
    state.tags.length
      ? tagGroups().map(([group, tags]) =>
          h(
            'div',
            { class: 'tag-manager-group' },
            h('p', { class: 'label' }, group || 'Sem grupo'),
            tags.map((t) =>
              h(
                'div',
                { class: 'tag-manager-row' },
                tagChip(t),
                h('span', { class: 'muted' }, `${t.clients} ${t.clients === 1 ? 'cliente' : 'clientes'}`),
                h(
                  'span',
                  { class: 'actions' },
                  h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => tagDialog(t) }, 'Editar'),
                  h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: () => deleteTag(t) }, 'Excluir'),
                ),
              ),
            ),
          ),
        )
      : h('p', { class: 'muted', style: 'margin: 0' }, 'Nenhuma tag ainda. Exemplo: grupo "Porte" com as tags Grande, Médio e Pequeno.'),
  );
  formDialog('Tags dos clientes', [
    h('p', { style: 'margin: 0' }, 'Use tags para agrupar clientes (por porte, região, produto…) e comparar o uso na aba Uso. Tags do mesmo grupo funcionam como alternativas no filtro.'),
    list,
    h('div', {}, h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => tagDialog() }, 'Nova tag')),
  ]);
}

function tagDialog(tag) {
  const groups = [...new Set(state.tags.map((t) => t.group).filter(Boolean))];
  // O campo "Grupo" sugere os grupos já usados.
  const groupInput = input('tag-group', { value: tag?.group || '', placeholder: 'Ex.: Porte' });
  groupInput.setAttribute('list', 'tag-groups');
  let color = tag?.color ?? (state.tags.length % TAG_COLORS.length);
  const swatches = h(
    'div',
    { class: 'swatches', role: 'radiogroup', 'aria-label': 'Cor' },
    TAG_COLORS.map((label, i) =>
      h('button', {
        class: `swatch tag c${i}${i === color ? ' selected' : ''}`,
        type: 'button',
        role: 'radio',
        'aria-checked': String(i === color),
        'aria-label': label,
        title: label,
        onclick: (e) => {
          color = i;
          swatches.querySelectorAll('.swatch').forEach((b, j) => {
            b.classList.toggle('selected', j === i);
            b.setAttribute('aria-checked', String(j === i));
          });
          e.preventDefault();
        },
      }),
    ),
  );
  // Clientes com esta tag (marcação em lote, com busca).
  const rows = [...state.clients].sort(byName).map((c) => {
    const box = h('input', { type: 'checkbox', value: c.id, checked: Boolean(tag && c.tagIds?.includes(tag.id)) });
    const others = (c.tagIds || []).filter((id) => id !== tag?.id);
    return { c, box, row: h('label', { class: 'check' }, box, h('span', {}, c.name, others.length ? [' ', tagChips(others)] : null)) };
  });
  const count = h('small', {});
  const updateCount = () => {
    const n = rows.filter((r) => r.box.checked).length;
    count.textContent = `${n} ${n === 1 ? 'cliente marcado' : 'clientes marcados'}`;
  };
  rows.forEach((r) => r.box.addEventListener('change', updateCount));
  updateCount();
  const search = h('input', {
    type: 'search',
    placeholder: 'Buscar cliente',
    'aria-label': 'Buscar cliente',
    oninput: () => {
      const term = fold(search.value.trim());
      rows.forEach((r) => (r.row.hidden = term !== '' && !fold(r.c.name).includes(term)));
    },
  });
  const markVisible = (value) => {
    rows.filter((r) => !r.row.hidden).forEach((r) => (r.box.checked = value));
    updateCount();
  };
  formDialog(
    tag ? 'Editar tag' : 'Nova tag',
    [
      h(
        'div',
        { class: 'grid-2' },
        field('Grupo', groupInput, 'Opcional. Tags do mesmo grupo são alternativas.'),
        field('Nome', input('tag-name', { value: tag?.name || '', required: true, placeholder: 'Ex.: Grande' })),
      ),
      h('datalist', { id: 'tag-groups' }, groups.map((g) => h('option', { value: g }))),
      h('div', { class: 'field' }, h('span', {}, 'Cor'), swatches),
      h(
        'div',
        { class: 'field' },
        h('span', {}, 'Clientes com esta tag'),
        h('div', { class: 'toolbar' }, search, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => markVisible(true) }, 'Marcar visíveis'), h('button', { class: 'btn btn-sm', type: 'button', onclick: () => markVisible(false) }, 'Desmarcar visíveis')),
        rows.length ? h('div', { class: 'checkbox-list' }, rows.map((r) => r.row)) : h('small', {}, 'Cadastre clientes primeiro.'),
        count,
      ),
    ],
    {
      onSubmit: async (form) => {
        const body = {
          group: form.elements['tag-group'].value,
          name: form.elements['tag-name'].value,
          color,
          clientIds: rows.filter((r) => r.box.checked).map((r) => r.c.id),
        };
        if (tag) await api(`/api/admin/tags/${tag.id}`, { method: 'PUT', body });
        else await api('/api/admin/tags', { method: 'POST', body });
        await refresh();
        toast(tag ? 'Tag atualizada.' : 'Tag criada.');
        tagsManager();
        return false;
      },
    },
  );
}

function deleteTag(tag) {
  confirmDialog('Excluir tag', `A tag "${tagLabel(tag)}" será removida de ${tag.clients} cliente(s).`, async () => {
    await api(`/api/admin/tags/${tag.id}`, { method: 'DELETE', body: {} });
    await refresh();
    toast('Tag excluída.');
    tagsManager();
    return false;
  });
}

// ---------- Clientes ----------

function clientDialog(client) {
  const active = h('input', { id: 'active', type: 'checkbox', checked: client ? client.active : true });
  const tagPicker = h(
    'div',
    { class: 'tag-picker' },
    tagGroups().map(([group, tags]) =>
      h(
        'div',
        { class: 'tag-picker-group' },
        h('span', { class: 'label' }, group || 'Outras'),
        h(
          'div',
          { class: 'chips' },
          tags.map((t) =>
            h('label', { class: 'tag-option' }, h('input', { type: 'checkbox', value: t.id, checked: Boolean(client?.tagIds?.includes(t.id)) }), tagChip(t)),
          ),
        ),
      ),
    ),
  );
  const reportChecks = [...state.reports].sort(byName).map((r) =>
    h(
      'label',
      { class: 'check' },
      h('input', { type: 'checkbox', value: r.id, checked: Boolean(client?.reportIds.includes(r.id)) }),
      h('span', {}, r.name, ' ', h('span', { class: 'muted' }, `· ${r.category}`), r.rls ? [' ', h('span', { class: 'pill pill-accent' }, 'RLS')] : null),
    ),
  );
  formDialog(
    client ? 'Editar cliente' : 'Novo cliente',
    [
      field('Nome da empresa', input('name', { value: client?.name, required: true })),
      h(
        'div',
        { class: 'field' },
        h('span', {}, 'Relatórios liberados'),
        reportChecks.length
          ? h('div', { class: 'checkbox-list', id: 'client-reports' }, reportChecks)
          : h('small', {}, 'Cadastre relatórios primeiro.'),
      ),
      h(
        'div',
        { class: 'grid-2' },
        field('Usuário RLS', input('rlsUsername', { value: client?.rlsUsername, placeholder: 'Ex.: cliente-acme' }), 'Valor que USERNAME() retorna no relatório.'),
        field('Funções RLS', input('rlsRoles', { value: client?.rlsRoles.join(', '), placeholder: 'Ex.: Cliente' }), 'Separe várias com vírgula.'),
      ),
      h(
        'div',
        { class: 'field' },
        h('span', {}, 'Tags'),
        state.tags.length ? tagPicker : h('small', {}, 'Crie tags em Clientes → Tags (ex.: Porte: Grande, Médio, Pequeno).'),
      ),
      h('label', { class: 'check' }, active, h('span', {}, 'Cliente ativo (desmarque para bloquear o acesso de todos os usuários dele)')),
    ],
    {
      onSubmit: async (form) => {
        const body = {
          tagIds: [...tagPicker.querySelectorAll('input:checked')].map((i) => i.value),
          name: form.elements['name'].value,
          rlsUsername: form.elements['rlsUsername'].value,
          rlsRoles: form.elements['rlsRoles'].value,
          reportIds: [...form.querySelectorAll('#client-reports input:checked')].map((i) => i.value),
          active: active.checked,
        };
        if (client) await api(`/api/admin/clients/${client.id}`, { method: 'PUT', body });
        else await api('/api/admin/clients', { method: 'POST', body });
        await refresh();
        toast(client ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      },
    },
  );
}

function deleteClient(client) {
  confirmDialog('Excluir cliente', `"${client.name}" será excluído. Só é possível excluir clientes sem usuários.`, async () => {
    await api(`/api/admin/clients/${client.id}`, { method: 'DELETE', body: {} });
    await refresh();
    toast('Cliente excluído.');
  });
}

// ---------- Usuários ----------

function userDialog(user) {
  const role = h(
    'select',
    { id: 'role', name: 'role' },
    h('option', { value: 'client', selected: user?.role !== 'admin' }, 'Usuário de cliente'),
    h('option', { value: 'admin', selected: user?.role === 'admin' }, 'Administrador'),
  );
  // Lista de clientes com busca; os já liberados para o usuário aparecem primeiro.
  const current = new Set(user?.clientIds || []);
  const clientRows = [...state.clients]
    .sort((a, b) => Number(current.has(b.id)) - Number(current.has(a.id)) || byName(a, b))
    .map((c) => {
      const box = h('input', { type: 'checkbox', value: c.id, checked: current.has(c.id) });
      return { c, box, row: h('label', { class: 'check' }, box, h('span', {}, c.name, c.active ? null : h('span', { class: 'muted' }, ' (desativado)'))) };
    });
  const pickedCount = h('small', {});
  const updateCount = () => {
    const n = clientRows.filter((r) => r.box.checked).length;
    pickedCount.textContent = n === 1 ? '1 cliente selecionado' : `${n} clientes selecionados`;
  };
  clientRows.forEach((r) => r.box.addEventListener('change', updateCount));
  const clientSearch = h('input', {
    type: 'search',
    placeholder: 'Buscar cliente',
    'aria-label': 'Buscar cliente',
    oninput: () => {
      const term = fold(clientSearch.value.trim());
      clientRows.forEach((r) => (r.row.hidden = term !== '' && !fold(r.c.name).includes(term)));
    },
  });
  updateCount();
  const clientField = h(
    'div',
    { class: 'field' },
    h('span', {}, 'Clientes que este usuário vê'),
    clientSearch,
    clientRows.length ? h('div', { class: 'checkbox-list' }, clientRows.map((r) => r.row)) : h('small', {}, 'Cadastre clientes primeiro.'),
    pickedCount,
  );
  const active = h('input', { id: 'user-active', type: 'checkbox', checked: user ? user.active : true });
  const notify = h('input', { id: 'user-notify', type: 'checkbox', checked: Boolean(user?.whatsappNotify) });
  const manager = h('input', { id: 'user-manager', type: 'checkbox', checked: Boolean(user?.isManager) });
  const managerField = h(
    'label',
    { class: 'check' },
    manager,
    h('span', {}, h('strong', {}, 'Gestor da empresa'), h('br'), h('span', { class: 'muted' }, 'Pode cadastrar, editar e bloquear as pessoas das fazendas dele no portal (Conta → Minha equipe).')),
  );
  const whatsappField = h(
    'div',
    { class: 'grid-2' },
    field('WhatsApp', input('phone', { value: user?.phone || '', type: 'tel', placeholder: '(61) 99999-8888' }), 'O bot reconhece o cliente por este número.'),
    h('label', { class: 'check', style: 'align-self: center' }, notify, h('span', {}, 'Receber avisos de relatório atualizado')),
  );
  const syncRole = () => {
    clientField.hidden = role.value === 'admin';
    whatsappField.hidden = role.value === 'admin';
    managerField.hidden = role.value === 'admin';
  };
  role.addEventListener('change', syncRole);
  syncRole();

  formDialog(
    user ? 'Editar usuário' : 'Novo usuário',
    [
      h(
        'div',
        { class: 'grid-2' },
        field('Nome', input('name', { value: user?.name, required: true })),
        field('E-mail', input('email', { value: user?.email, type: 'email', required: true })),
      ),
      field('Tipo de acesso', role),
      clientField,
      managerField,
      whatsappField,
      user ? null : h('p', { class: 'muted', style: 'margin: 0; font-size: 13px' }, 'Uma senha temporária será gerada e mostrada a seguir.'),
      h('label', { class: 'check' }, active, h('span', {}, 'Usuário ativo')),
    ],
    {
      onSubmit: async (form) => {
        const body = {
          name: form.elements['name'].value,
          email: form.elements['email'].value,
          role: role.value,
          clientIds: clientRows.filter((r) => r.box.checked).map((r) => r.c.id),
          phone: form.elements['phone'].value,
          whatsappNotify: notify.checked,
          isManager: manager.checked,
          active: active.checked,
        };
        if (user) {
          await api(`/api/admin/users/${user.id}`, { method: 'PUT', body });
          await refresh();
          toast('Usuário atualizado.');
          return true;
        }
        const result = await api('/api/admin/users', { method: 'POST', body });
        await refresh();
        showPassword('Usuário criado', result.user.email, result.password);
        return false;
      },
    },
  );
}

async function impersonate(user) {
  try {
    await api(`/api/admin/users/${user.id}/impersonate`, { method: 'POST', body: {} });
    location.href = '/portal#inicio';
  } catch (err) {
    toast(err.message, 'error');
  }
}

function resetPassword(user) {
  confirmDialog(
    'Gerar nova senha',
    `Uma nova senha temporária será gerada para ${user.name}. A senha atual deixa de funcionar e as sessões abertas são encerradas.`,
    async () => {
      const { password } = await api(`/api/admin/users/${user.id}/reset-password`, { method: 'POST', body: {} });
      showPassword('Nova senha gerada', user.email, password);
      return false;
    },
    'Gerar senha',
  );
}

function deleteUser(user) {
  confirmDialog('Excluir usuário', `${user.name} (${user.email}) perderá o acesso ao portal.`, async () => {
    await api(`/api/admin/users/${user.id}`, { method: 'DELETE', body: {} });
    await refresh();
    toast('Usuário excluído.');
  });
}

// ---------- Inicialização ----------

function selectTab(name) {
  document.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll('[data-panel]').forEach((p) => {
    p.hidden = p.dataset.panel !== name;
  });
  history.replaceState(null, '', `#${name}`);
  if (name === 'usage') loadUsage();
  if (name === 'alerts') loadAlerts();
  if (name === 'health') loadHealth();
  if (name === 'whatsapp') loadBot();
}

async function init() {
  setupMenu(document.getElementById('menu-button'), document.getElementById('menu-list'));
  document.getElementById('logout').onclick = logout;
  document.getElementById('change-password').onclick = () => openPasswordDialog();
  document.querySelectorAll('[data-tab]').forEach((t) => (t.onclick = () => selectTab(t.dataset.tab)));
  document.getElementById('new-report').onclick = () => reportDialog();
  document.getElementById('import-reports').onclick = importDialog;
  document.getElementById('setup-wizard').onclick = setupWizard;
  document.getElementById('search-reports').addEventListener('input', renderReports);
  document.getElementById('search-clients').addEventListener('input', renderClients);
  document.getElementById('search-users').addEventListener('input', renderUsers);
  document.getElementById('usage-days').addEventListener('change', loadUsage);
  setupImageUpload();
  setupSimulator();
  document.getElementById('health-scan').addEventListener('click', async () => {
    try {
      await api('/api/admin/data-health/scan', { method: 'POST', body: {} });
      loadHealth();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  document.getElementById('alerts-digest').addEventListener('click', copyDigest);
  api('/api/admin/alerts').then(updateAlertCount).catch(() => {});
  // Contador de problemas na aba, mesmo antes de abri-la.
  api('/api/admin/data-health')
    .then((d) => {
      healthState.data = d;
      document.getElementById('count-health').textContent = d.totals.desatualizado + d.totals.falha || '';
    })
    .catch(() => {});
  document.getElementById('new-client').onclick = () => clientDialog();
  document.getElementById('manage-tags').onclick = () => tagsManager();
  document.getElementById('clients-tag-filter').addEventListener('change', renderClients);
  document.getElementById('new-category').onclick = () => categoryDialog();
  document.getElementById('new-user').onclick = () => userDialog();

  const initial = location.hash.slice(1);

  loadConfig().catch(() => {});
  const { user } = await api('/api/auth/me');
  if (user.role !== 'admin') {
    location.replace('/portal');
    return;
  }
  state.me = user;
  document.getElementById('user-name').textContent = user.name;
  if (user.mustChangePassword) openPasswordDialog({ required: true });
  await refresh();
  // Sem aba no endereço, o admin abre nos alertas.
  selectTab(document.querySelector(`[data-tab="${CSS.escape(initial)}"]`) ? initial : 'alerts');
}

init().catch((err) => toast(err.message, 'error'));

import { composer, renderMessage } from './chat.js';
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
  // Pedidos de acesso às ferramentas esperando decisão (ex.: "2 pedidos 4M · 1 pedido 3P").
  const requests = TOOL_ACCESS.map((t) => [t.label, state.users.filter((u) => u[t.field]?.status === 'pending').length]).filter(([, n]) => n);
  const toolCount = document.getElementById('count-confinamento');
  toolCount.textContent = requests.map(([label, n]) => `${n} pedido${n > 1 ? 's' : ''} ${label}`).join(' · ');
  toolCount.classList.toggle('has-high', requests.length > 0);
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
        h('td', {}, r.kind === 'ccv' ? h('span', { class: 'pill pill-accent', title: 'Painel nativo: cada cliente vê só as fazendas liberadas' }, 'Painel CCV') : r.rls ? h('span', { class: 'pill pill-accent' }, 'RLS') : h('span', { class: 'pill' }, 'Sem RLS')),
        h('td', { class: 'mono' }, usage(r.id)),
        h(
          'td',
          { class: 'actions' },
          h('a', { class: 'btn btn-sm btn-ghost', href: `/portal#${r.id}` }, 'Abrir'),
          r.kind === 'ccv' ? null : h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => notifyClients(r) }, 'Avisar clientes'),
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
    if (!names.length) return h('span', { class: 'pill', title: 'Sem cliente: usa só as ferramentas liberadas' }, 'Só ferramentas');
    const shown = names.slice(0, 2).join(', ');
    return [
      h('span', { title: names.join(', ') }, names.length > 2 ? `${shown} +${names.length - 2}` : shown),
      u.isManager ? h('span', { class: 'pill pill-accent', style: 'margin-left: 6px' }, 'Gestor') : null,
    ];
  };
  table(
    document.getElementById('users-table'),
    ['Usuário', 'Acesso', '4M Confinamento', '3P Pasto', 'Último login', 'Situação', ''],
    [...state.users].filter((u) => matches('search-users', u.name, u.email, ...clientNames(u))).sort(byName).map((u) =>
      h(
        'tr',
        {},
        h('td', {}, h('strong', {}, u.name), h('span', { class: 'sub' }, u.email), u.phone ? h('span', { class: 'sub mono' }, `WhatsApp +${u.phone}`) : null, u.hasAssistant ? h('span', { class: 'sub' }, '✦ assistente ativo') : null),
        h('td', {}, access(u)),
        h('td', {}, toolCell(u, 'confinamento')),
        h('td', {}, toolCell(u, 'pasto')),
        h('td', { class: 'mono' }, fmtDate(u.lastLoginAt)),
        h('td', {}, u.active ? h('span', { class: 'pill pill-ok' }, 'Ativo') : h('span', { class: 'pill pill-off' }, 'Desativado')),
        h(
          'td',
          { class: 'actions' },
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => userDialog(u) }, 'Editar'),
          u.role === 'client' && u.active
            ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => impersonate(u) }, 'Entrar como')
            : null,
          u.role === 'client' && u.active
            ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => (selectTab('chat'), openThread(u.id)) }, 'Mensagem')
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

// ---------- Ferramentas (4M Confinamento, 3P Pasto): pedido e aprovação de acesso ----------

// field: campo do usuário com {status}; também é o trecho da rota /api/admin/users/:id/<field>.
const TOOL_ACCESS = [
  { field: 'confinamento', label: '4M', name: '4M Confinamento' },
  { field: 'pasto', label: '3P', name: '3P · Desempenho a Pasto' },
];

async function setToolAccess(user, field, action) {
  await api(`/api/admin/users/${user.id}/${field}`, { method: 'POST', body: { action } });
  await refresh();
}

function toolCell(u, field) {
  if (u.role === 'admin') return h('span', { class: 'muted' }, '—');
  const decide = (action) => setToolAccess(u, field, action);
  const status = u[field]?.status || 'none';
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
    actions.push(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => decide('revoke') }, 'Revogar'));
  } else {
    actions.push(h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => decide('approve') }, 'Aprovar'));
    if (status === 'pending') actions.push(h('button', { class: 'btn btn-sm btn-ghost btn-danger', type: 'button', onclick: () => decide('deny') }, 'Negar'));
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
  const kind = h(
    'select',
    { id: 'kind', name: 'kind' },
    h('option', { value: 'powerbi', selected: report?.kind !== 'ccv' }, 'Relatório do Power BI (incorporado)'),
    h('option', { value: 'ccv', selected: report?.kind === 'ccv' }, 'Painel CCV (desenhado pelo portal)'),
  );
  const rlsField = h('label', { class: 'check' }, rls, h('span', {}, h('strong', {}, 'Usa segurança por linha (RLS)'), h('br'), h('span', { class: 'muted' }, 'Cada cliente verá só os dados do próprio filtro de RLS.')));
  const ccvNote = h(
    'p',
    { class: 'alert alert-ok', style: 'margin: 0' },
    'O portal lê o modelo do relatório "Ferramenta CCV" e desenha o painel. Cada cliente vê só as fazendas marcadas para ele em Clientes → Editar. O relatório do Power BI nunca é mostrado nem exportado para os clientes.',
  );
  const syncKind = () => {
    rlsField.hidden = kind.value === 'ccv';
    ccvNote.hidden = kind.value !== 'ccv';
  };
  kind.addEventListener('change', syncKind);
  syncKind();
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
      field('Tipo', kind),
      ccvNote,
      h(
        'div',
        { class: 'grid-2' },
        field('Categoria', category, state.categories.length ? null : 'Crie categorias na aba Categorias.'),
        field('ID do workspace', input('workspaceId', { value: report?.workspaceId || state.status?.defaultWorkspaceId || '', required: true })),
      ),
      field('ID do relatório', input('reportId', { value: report?.reportId, required: true }), 'Na URL do relatório: app.powerbi.com/groups/{workspace}/reports/{relatório}.'),
      field('Descrição', description, 'Deixe em branco para usar a descrição da categoria.'),
      h('div', { class: 'field' }, h('span', {}, 'Imagem do card'), imagePreview),
      rlsField,
    ],
    {
      onSubmit: async (form) => {
        const body = Object.fromEntries(new FormData(form));
        body.rls = kind.value !== 'ccv' && rls.checked;
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

// ---------- Benchmarking Confinamento ----------

const BMK_STATUS = {
  nao_iniciado: ['Não iniciado', 'pill'],
  rascunho: ['Em preenchimento', 'pill'],
  enviado: ['Enviado · validar', 'pill pill-warn'],
  correcao: ['Em correção', 'pill pill-danger'],
  aprovado: ['Aprovado', 'pill pill-ok'],
};
const bmkState = { data: null };

async function loadBenchmark() {
  const box = document.getElementById('benchmark');
  try {
    bmkState.data = await api('/api/admin/benchmark');
  } catch (err) {
    box.replaceChildren(h('p', { class: 'alert' }, err.message));
    return;
  }
  renderBenchmark();
}

function renderBenchmark() {
  const { clients, settings } = bmkState.data;
  const box = document.getElementById('benchmark');
  const waiting = clients.filter((c) => c.status === 'enviado').length;
  const counter = document.getElementById('count-benchmark');
  counter.textContent = waiting || '';
  counter.classList.toggle('has-high', waiting > 0);
  const count = (s) => clients.filter((c) => c.status === s).length;
  const tableEl = h('table');
  table(
    tableEl,
    ['Cliente', 'Situação', 'Lotes', 'Erros / alertas', 'Questionário', 'Última alteração', ''],
    clients.map((c) => {
      const [label, cls] = BMK_STATUS[c.status] || BMK_STATUS.nao_iniciado;
      return h(
        'tr',
        {},
        h('td', {}, h('strong', {}, c.client), c.active ? null : h('span', { class: 'sub' }, 'cliente desativado')),
        h('td', {}, h('span', { class: cls }, label), c.submittedAt ? h('span', { class: 'sub' }, `enviado ${fmtDate(c.submittedAt)}`) : null),
        h('td', { class: 'mono' }, `${c.lotesEngorda} eng. · ${c.lotesRecria} rec.`),
        h('td', {}, c.erros ? h('span', { class: 'pill pill-danger' }, `${c.erros} erros`) : h('span', { class: 'muted' }, '0 erros'), ' ', c.alertas ? h('span', { class: 'pill pill-warn' }, `${c.alertas} alertas`) : null),
        h('td', { class: 'mono' }, `${c.questionario.respondidas}/${c.questionario.visiveis}`, c.questionario.faltando ? h('span', { class: 'sub' }, `faltam ${c.questionario.faltando} obrigatórias`) : null),
        h('td', { class: 'mono' }, c.updatedAt ? fmtDate(c.updatedAt) : '—', c.updatedBy ? h('span', { class: 'sub' }, c.updatedBy) : null),
        h('td', { class: 'actions' }, h('a', { class: `btn btn-sm${c.status === 'enviado' ? ' btn-primary' : ' btn-ghost'}`, href: `/benchmark?cliente=${c.clientId}`, target: '_blank', rel: 'noopener' }, c.status === 'enviado' ? 'Validar' : 'Abrir')),
      );
    }),
    'Nenhum cliente no benchmarking. Em Clientes → Editar, marque "Participa do Benchmarking Confinamento".',
  );
  box.replaceChildren(
    h(
      'div',
      { class: 'stats' },
      statTile(`Clientes no benchmarking ${settings.ano}`, num(clients.length), settings.prazo ? h('span', { class: 'muted' }, `prazo ${fmtDateOnly(`${settings.prazo}T12:00:00`)}`) : null),
      statTile('Enviados para validar', num(waiting)),
      statTile('Em correção', num(count('correcao'))),
      statTile('Aprovados', num(count('aprovado'))),
      statTile('Em preenchimento / não iniciados', `${num(count('rascunho'))} / ${num(count('nao_iniciado'))}`),
    ),
    h('div', { class: 'table-wrap' }, tableEl),
  );
}

function benchmarkSettingsDialog() {
  const s = bmkState.data.settings;
  import('/benchmark/fields.js').then(({ TOLERANCIA_LABELS, FAIXA_LABELS, LIST_LABELS }) => {
    const numIn = (v) => h('input', { type: 'text', inputmode: 'decimal', value: String(v).replace('.', ','), style: 'max-width: 110px' });
    const tol = Object.entries(TOLERANCIA_LABELS).map(([k, [label, unit]]) => ({ k, el: numIn(s.tolerancias[k]), label, unit }));
    const fx = Object.entries(FAIXA_LABELS).map(([k, [label, unit]]) => ({ k, min: numIn(s.faixas[k][0]), max: numIn(s.faixas[k][1]), label, unit }));
    const ls = Object.entries(LIST_LABELS).map(([k, label]) => ({ k, label, el: h('textarea', { rows: 6 }, s.listas[k].join('\n')) }));
    const ano = input('bmk-ano', { value: String(s.ano), type: 'text' });
    const prazo = h('input', { type: 'date', value: s.prazo || '' });
    const parse = (el) => Number(String(el.value).trim().replace(/\./g, '').replace(',', '.'));
    formDialog(
      'Limites e listas do benchmarking',
      [
        h('div', { class: 'grid-2' }, field('Ano do benchmarking', ano, 'Os dados se referem ao ano anterior.'), field('Prazo de envio (opcional)', prazo)),
        h('h3', { class: 'usage-title' }, 'Tolerâncias de coerência (valor informado × recalculado)'),
        h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, tol.map((t) => h('tr', {}, h('td', {}, t.label), h('td', {}, t.el), h('td', { class: 'muted' }, t.unit)))))),
        h('h3', { class: 'usage-title' }, 'Faixas esperadas dos indicadores econômicos (mínimo e máximo)'),
        h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {}, fx.map((f) => h('tr', {}, h('td', {}, f.label), h('td', {}, f.min), h('td', {}, f.max), h('td', { class: 'muted' }, f.unit)))))),
        h('h3', { class: 'usage-title' }, 'Listas (um item por linha)'),
        h('div', { class: 'grid-2' }, ls.map((l) => field(l.label, l.el))),
        h('p', { class: 'muted', style: 'margin: 0; font-size: 13px' }, 'Mudanças valem na hora para todas as fazendas: os alertas são recalculados quando a coleta é aberta.'),
      ],
      {
        submitLabel: 'Salvar',
        onSubmit: async () => {
          const body = {
            ano: parse(ano),
            prazo: prazo.value || null,
            tolerancias: Object.fromEntries(tol.map((t) => [t.k, parse(t.el)])),
            faixas: Object.fromEntries(fx.map((f) => [f.k, [parse(f.min), parse(f.max)]])),
            listas: Object.fromEntries(ls.map((l) => [l.k, l.el.value.split('\n').map((x) => x.trim()).filter(Boolean)])),
          };
          await api('/api/admin/benchmark/settings', { method: 'PUT', body });
          await loadBenchmark();
          toast('Limites e listas salvos.');
        },
      },
    );
  });
}

// Excel com tudo do ano: andamento, lotes (com indicadores e alertas), questionário e resultados.
async function exportBenchmark() {
  try {
    toast('Montando o Excel consolidado…');
    const [data, m, ExcelJS] = await Promise.all([api('/api/admin/benchmark/export'), import('/benchmark/fields.js'), loadExcelJs()]);
    const wb = new ExcelJS.Workbook();
    const sheet = (name, columns, rows) => {
      const ws = wb.addWorksheet(name);
      ws.columns = columns.map(([key, header, width]) => ({ key, header, width: width || Math.max(10, Math.min(40, String(header).length + 2)) }));
      rows.forEach((r) => ws.addRow(r));
      const head = ws.getRow(1);
      head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF094140' } };
      head.alignment = { vertical: 'middle', wrapText: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      return ws;
    };
    const calcCols = [['pesoEntradaArroba', 'Peso entrada (@)'], ['pesoSaidaArroba', 'Peso saída (@)'], ['custoArrobaEntrada', 'Custo @ entrada (R$)'], ['valorArrobaVenda', 'Valor @ venda (R$)'], ['custoAlimentarDia', 'Custo alim. (R$/cab/d)'], ['custoOperacional', 'Custo oper. (R$/cab/d)'], ['lucroCab', 'Lucro (R$/cab)']];
    const loteSheet = (name, kind, recria) => {
      const fields = recria ? m.ZOO_FIELDS : [...m.ZOO_FIELDS, ...m.ECO_FIELDS];
      const rows = [];
      for (const s of data.submissions) {
        const v = m.validateLotes(s[kind], data.settings, { recria });
        s[kind].forEach((l, i) => {
          const c = m.calcLote(l);
          rows.push({ cliente: s.client, status: s.status, ...l, ...Object.fromEntries(calcCols.map(([k]) => [`c_${k}`, Number.isFinite(c[k]) ? Number(c[k].toFixed(3)) : null])), erros: v.porLote[i].filter((x) => x.level === 'erro').map((x) => x.msg).join(' | '), alertas: v.porLote[i].filter((x) => x.level === 'alerta').map((x) => x.msg).join(' | ') });
        });
      }
      sheet(name, [['cliente', 'Cliente', 28], ['status', 'Situação', 14], ...fields.map((f) => [f.key, `${f.label}${f.unit ? ` (${f.unit})` : ''}`]), ...(recria ? [] : calcCols.map(([k, label]) => [`c_${k}`, label])), ['erros', 'Erros', 50], ['alertas', 'Alertas', 60]], rows);
    };
    sheet(
      'Andamento',
      [['cliente', 'Cliente', 30], ['status', 'Situação', 18], ['eng', 'Lotes engorda'], ['rec', 'Lotes recria'], ['erros', 'Erros'], ['alertas', 'Alertas'], ['quest', 'Questionário respondido']],
      bmkState.data.clients.map((c) => ({ cliente: c.client, status: (BMK_STATUS[c.status] || BMK_STATUS.nao_iniciado)[0], eng: c.lotesEngorda, rec: c.lotesRecria, erros: c.erros, alertas: c.alertas, quest: `${c.questionario.respondidas}/${c.questionario.visiveis}` })),
    );
    loteSheet('Lotes Engorda', 'engorda', false);
    loteSheet('Lotes Recria', 'recria', true);
    const qText = (q) => `${q.n}. ${m.questionText(q, data.settings)}`;
    sheet(
      'Questionário',
      [['cliente', 'Cliente', 28], ...m.QUESTIONS.map((q) => [q.id, qText(q), 24])],
      data.submissions.map((s) => ({ cliente: s.client, ...Object.fromEntries(m.QUESTIONS.map((q) => [q.id, Array.isArray(s.respostas[q.id]) ? s.respostas[q.id].join('; ') : (s.respostas[q.id] ?? null)])) })),
    );
    const resultRows = [];
    const recriaRows = [];
    for (const s of data.submissions) {
      for (const cat of data.settings.listas.categorias) {
        const r = m.resultadoEngorda(s.engorda, s.respostas, cat);
        if (r) resultRows.push({ cliente: s.client, status: s.status, categoria: cat, ...r.zootecnico, ...r.economico });
        const rr = m.resultadoRecria(s.recria, cat);
        if (rr) recriaRows.push({ cliente: s.client, status: s.status, categoria: cat, ...rr.zootecnico });
      }
    }
    const resCols = (rows) => [['cliente', 'Cliente', 28], ['status', 'Situação', 14], ['categoria', 'Categoria', 18], ...rows.map(([k, label]) => [k, label])];
    const round = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(4)) : v])));
    sheet('Resultado Engorda', resCols([...m.ZOO_RESULT_ROWS, ...m.ECO_RESULT_ROWS.filter(([k]) => k !== 'dias')]), round(resultRows));
    sheet('Resultado Recria', resCols(m.ZOO_RESULT_ROWS), round(recriaRows));
    const blob = new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `Benchmarking-Confinamento-${data.ano}-consolidado.xlsx` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (err) {
    toast(err.message, 'error');
  }
}

let excelJsLoading = null;
function loadExcelJs() {
  excelJsLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/exceljs.min.js';
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => {
      excelJsLoading = null;
      reject(new Error('Não foi possível carregar o gerador de Excel.'));
    };
    document.head.append(s);
  });
  return excelJsLoading;
}

// ---------- Cotações ----------

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const fmtQuote = (v, digits = 2) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const fmtPct = (p) => (p === null || p === undefined ? '' : `${p > 0 ? '▲ +' : p < 0 ? '▼ ' : '■ '}${fmtQuote(p)}%`);

async function loadQuotes() {
  try {
    renderQuotes(await api('/api/admin/quotes'));
  } catch (err) {
    document.getElementById('quotes').replaceChildren(h('p', { class: 'alert' }, err.message));
  }
}

function quoteDialog(q) {
  formDialog(
    q ? 'Editar cotação' : 'Nova cotação',
    [
      field('Nome', input('label', { value: q?.label, placeholder: 'Ex.: Boi gordo', required: true })),
      h('div', { class: 'grid-2' }, field('Unidade', input('unit', { value: q?.unit, placeholder: 'Ex.: R$/@' })), field('Fonte', input('source', { value: q?.source, placeholder: 'Ex.: CEPEA · SP' }), 'Aparece ao passar o mouse na faixa.')),
    ],
    {
      onSubmit: async (form) => {
        const body = Object.fromEntries(new FormData(form));
        renderQuotes(await api(q ? `/api/admin/quotes/${q.id}` : '/api/admin/quotes', { method: q ? 'PUT' : 'POST', body }));
        toast(q ? 'Cotação atualizada.' : 'Cotação criada. Lance o valor do dia na tabela.');
      },
    },
  );
}

function renderQuotes(data) {
  const box = document.getElementById('quotes');
  const enabled = h('input', {
    type: 'checkbox',
    checked: data.enabled,
    onchange: async () => {
      renderQuotes(await api('/api/admin/quotes/options', { method: 'PUT', body: { enabled: enabled.checked } }));
      toast(enabled.checked ? 'A faixa voltou a aparecer no portal.' : 'A faixa saiu do portal.');
    },
  });
  const manualTable = h('table');
  table(
    manualTable,
    ['Cotação', 'Último valor', 'Lançar valor do dia', ''],
    data.manual.map((q) => {
      const value = h('input', { type: 'text', inputmode: 'decimal', placeholder: q.value !== null ? fmtQuote(q.value) : '0,00', 'aria-label': `Valor de ${q.label}`, style: 'width: 110px' });
      const date = h('input', { type: 'date', value: todayIso(), 'aria-label': 'Data do valor', style: 'width: 150px' });
      const launch = async () => {
        try {
          renderQuotes(await api(`/api/admin/quotes/${q.id}/value`, { method: 'POST', body: { value: value.value, date: date.value } }));
          toast(`${q.label}: valor lançado.`);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      value.addEventListener('keydown', (e) => e.key === 'Enter' && launch());
      return h(
        'tr',
        {},
        h('td', {}, h('strong', {}, q.label), h('span', { class: 'sub' }, [q.unit, q.source].filter(Boolean).join(' · '))),
        h(
          'td',
          { class: 'mono' },
          q.value !== null ? `${fmtQuote(q.value)}` : h('span', { class: 'muted' }, 'sem valor (não aparece)'),
          q.asOf ? h('span', { class: 'sub' }, `${fmtDateOnly(`${q.asOf}T12:00:00`)} ${fmtPct(q.changePct)}`) : null,
          q.history.length > 1 ? h('span', { class: 'sub', title: q.history.map((x) => `${fmtDateOnly(`${x.date}T12:00:00`)}: ${fmtQuote(x.value)}`).join('\n') }, `${q.history.length} lançamentos`) : null,
        ),
        h('td', {}, h('div', { class: 'quote-entry' }, value, date, h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: launch }, 'Lançar'))),
        h(
          'td',
          { class: 'actions' },
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => quoteDialog(q) }, 'Editar'),
          h(
            'button',
            {
              class: 'btn btn-sm btn-ghost btn-danger',
              type: 'button',
              onclick: () =>
                confirmDialog('Excluir cotação', `"${q.label}" sai da faixa e o histórico de valores é apagado.`, async () => {
                  renderQuotes(await api(`/api/admin/quotes/${q.id}`, { method: 'DELETE', body: {} }));
                  toast('Cotação excluída.');
                }),
            },
            'Excluir',
          ),
        ),
      );
    }),
    'Nenhuma cotação lançada pela equipe. Use "Nova cotação".',
  );
  const autoList = h(
    'div',
    { class: 'checkbox-list quote-auto' },
    data.auto.map((q) => {
      const box2 = h('input', {
        type: 'checkbox',
        checked: q.on,
        onchange: async () => renderQuotes(await api('/api/admin/quotes/options', { method: 'PUT', body: { auto: { [q.id]: box2.checked } } })),
      });
      return h(
        'label',
        { class: 'check' },
        box2,
        h('span', {}, h('strong', {}, q.label), h('span', { class: 'muted' }, ` · ${q.unit}${q.last ? ` · último ${fmtQuote(q.last.value, q.unit === 'pts' ? 0 : 3)} ${fmtPct(q.last.changePct)}` : ''}`)),
      );
    }),
  );
  box.replaceChildren(
    h('label', { class: 'check', style: 'margin-top: 16px' }, enabled, h('span', {}, h('strong', {}, 'Mostrar a faixa de cotações no portal'), h('br'), h('span', { class: 'muted' }, 'Rola no rodapé de todas as telas do portal; para ao passar o mouse.'))),
    sectionTitle('Lançadas pela equipe (preços brasileiros)'),
    h('div', { class: 'table-wrap' }, manualTable),
    h('p', { class: 'muted usage-hint' }, 'Dica: o CEPEA publica os indicadores do dia no fim da tarde. Lançar outra vez na mesma data corrige o valor daquele dia.'),
    sectionTitle('Automáticas'),
    autoList,
  );
}

// ---------- Mensagens ----------

const chatState = { inbox: null, userId: null, conversation: null, timer: null };

function updateChatCount(inbox) {
  const el = document.getElementById('count-chat');
  el.textContent = inbox.waiting || '';
  el.classList.toggle('has-high', inbox.waiting > 0);
}

async function loadInbox() {
  try {
    chatState.inbox = await api('/api/admin/chat');
    updateChatCount(chatState.inbox);
    renderThreads();
  } catch (err) {
    document.getElementById('chat-thread-list').replaceChildren(h('p', { class: 'alert' }, err.message));
  }
}

function renderThreads() {
  const filter = document.getElementById('chat-filter').value;
  const list = (chatState.inbox?.threads || [])
    .filter((t) => (filter === 'todas' ? true : filter === 'resolvida' ? t.status === 'resolvida' : t.status !== 'resolvida' || t.unread))
    .filter((t) => matches('chat-search', t.name, t.email, ...t.clients));
  document.getElementById('chat-thread-list').replaceChildren(
    ...(list.length
      ? list.map((t) =>
          h(
            'button',
            { class: `chat-thread${t.userId === chatState.userId ? ' on' : ''}${t.unread ? ' unread' : ''}`, type: 'button', onclick: () => openThread(t.userId) },
            h('span', { class: 'chat-thread-top' }, h('strong', {}, t.name), t.unread ? h('span', { class: 'chat-badge' }, t.unread) : t.status === 'resolvida' ? h('span', { class: 'pill pill-ok' }, 'Resolvida') : null),
            h('span', { class: 'sub' }, t.clients.join(', ') || t.email),
            t.last ? h('span', { class: 'chat-thread-last' }, `${t.last.from === 'admin' ? 'Você: ' : ''}${t.last.text}`) : null,
            t.lastAt ? h('span', { class: 'sub' }, fmtDate(t.lastAt)) : null,
          ),
        )
      : [h('p', { class: 'muted', style: 'padding: 12px' }, chatState.inbox?.threads.length ? 'Nenhuma conversa neste filtro.' : 'Nenhuma conversa ainda. Quando um usuário escrever pelo botão Mensagens do portal, a conversa aparece aqui.')]),
  );
}

async function openThread(userId) {
  chatState.userId = userId;
  renderThreads();
  const box = document.getElementById('chat-conversation');
  box.replaceChildren(h('p', { class: 'muted', style: 'padding: 16px' }, 'Carregando conversa…'));
  await refreshThread({ scroll: true });
  api(`/api/admin/chat/${userId}/read`, { method: 'POST', body: {} })
    .then((inbox) => {
      chatState.inbox = inbox;
      updateChatCount(inbox);
      renderThreads();
    })
    .catch(() => {});
}

async function refreshThread({ scroll = false } = {}) {
  const userId = chatState.userId;
  if (!userId) return;
  let data;
  try {
    data = await api(`/api/admin/chat/${userId}`);
  } catch (err) {
    document.getElementById('chat-conversation').replaceChildren(h('p', { class: 'alert' }, err.message));
    return;
  }
  if (userId !== chatState.userId) return;
  const changed = !chatState.conversation || chatState.conversation.user.id !== userId || chatState.conversation.messages.length !== data.messages.length || chatState.conversation.status !== data.status;
  chatState.conversation = data;
  if (changed) renderConversation({ scroll });
}

function renderConversation({ scroll }) {
  const data = chatState.conversation;
  const box = document.getElementById('chat-conversation');
  const old = box.querySelector('.ai-messages');
  const atBottom = !old || old.scrollHeight - old.scrollTop - old.clientHeight < 40;
  const draft = box.querySelector('textarea')?.value || '';
  const typing = document.activeElement === box.querySelector('textarea');
  const list = h(
    'div',
    { class: 'ai-messages' },
    data.messages.length ? data.messages.map((m) => renderMessage(m, { mine: m.from === 'admin', newTab: true, fileHref: (msg) => `/api/admin/chat/${msg.userId}/files/${msg.attachment.id}` })) : h('p', { class: 'muted' }, `Nenhuma mensagem ainda. Escreva para ${data.user.name}: a mensagem aparece no botão Mensagens do portal dele.`),
  );
  const lastAdmin = [...data.messages].reverse().find((m) => m.from === 'admin');
  const seen = lastAdmin && data.userReadAt && data.userReadAt >= lastAdmin.at;
  const box2 = composer({
    placeholder: `Responder para ${data.user.name}…`,
    onSend: async (text) => {
      await api(`/api/admin/chat/${data.user.id}`, { method: 'POST', body: { text } });
      await refreshThread({ scroll: true });
      loadInbox();
    },
  });
  box2.input.value = draft;
  const resolved = data.status === 'resolvida';
  box.replaceChildren(
    h(
      'header',
      { class: 'chat-conv-head' },
      h('div', {}, h('strong', {}, data.user.name), h('span', { class: 'sub' }, data.user.email)),
      h(
        'div',
        { class: 'viewer-actions' },
        h(
          'button',
          {
            class: 'btn btn-sm',
            type: 'button',
            onclick: async () => {
              chatState.inbox = await api(`/api/admin/chat/${data.user.id}/status`, { method: 'POST', body: { status: resolved ? 'aberta' : 'resolvida' } });
              updateChatCount(chatState.inbox);
              await refreshThread();
              renderThreads();
            },
          },
          resolved ? 'Reabrir' : 'Marcar como resolvida',
        ),
      ),
    ),
    list,
    lastAdmin ? h('p', { class: 'chat-seen' }, seen ? '✓ Visto pelo usuário' : 'Ainda não visto pelo usuário') : null,
    box2.form,
  );
  if (scroll || atBottom) list.scrollTop = list.scrollHeight;
  if (typing) box2.input.focus();
}

// Começar uma conversa com qualquer usuário de cliente.
function newChatDialog(preselect) {
  const people = state.users.filter((u) => u.role === 'client' && u.active).sort(byName);
  const pick = h(
    'select',
    { id: 'chat-user' },
    people.map((u) => h('option', { value: u.id, selected: u.id === preselect }, `${u.name} · ${u.clientIds.map((id) => state.clients.find((c) => c.id === id)?.name).filter(Boolean).join(', ')}`)),
  );
  formDialog('Nova conversa', [field('Com quem', pick)], {
    submitLabel: 'Abrir conversa',
    onSubmit: async () => {
      selectTab('chat');
      await openThread(pick.value);
    },
  });
}

function startChatPolling() {
  clearInterval(chatState.timer);
  // Aba aberta: conversa a cada 10 s e lista a cada 30 s; fora da aba, só o contador a cada minuto.
  let tick = 0;
  chatState.timer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    tick += 1;
    const onTab = !document.querySelector('[data-panel="chat"]').hidden;
    if (onTab) {
      refreshThread();
      if (tick % 3 === 0) loadInbox();
    } else if (tick % 6 === 0) {
      api('/api/admin/chat').then((inbox) => ((chatState.inbox = inbox), updateChatCount(inbox))).catch(() => {});
    }
  }, 10 * 1000);
}

// ---------- Alertas CCV ----------

const ccvState = { data: null, loading: false };
const CCV_SEV = {
  alta: { label: 'Prioridade alta', cls: 'sev-alta' },
  media: { label: 'Atenção', cls: 'sev-media' },
  ok: { label: 'Sem alerta', cls: 'sev-baixa' },
};
const CCV_ACTION = { alerta: 'Alerta enviado', relatorio: 'Resumo enviado', tratado: 'Marcado como tratado', adiar: 'Adiado' };
const pctText = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
const dec1 = (v) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

async function loadCcvAlerts({ refresh = false } = {}) {
  if (ccvState.loading) return;
  ccvState.loading = true;
  const box = document.getElementById('ccv-alerts');
  const button = document.getElementById('ccv-refresh');
  button.disabled = true;
  if (!ccvState.data || refresh) box.replaceChildren(h('p', { class: 'muted' }, refresh ? 'Buscando os dados novos no Power BI… (leva alguns segundos)' : 'Calculando os alertas de todas as fazendas… (leva alguns segundos)'));
  try {
    ccvState.data = await api(`/api/admin/ccv/alerts${refresh ? '?refresh=1' : ''}`);
    renderCcvAlerts();
  } catch (err) {
    box.replaceChildren(h('p', { class: 'alert' }, err.message));
  } finally {
    ccvState.loading = false;
    button.disabled = false;
  }
}

async function decideCcv(report, f, body, doneText) {
  await api('/api/admin/ccv/alerts/decide', { method: 'POST', body: { reportId: report.id, key: f.key, farm: f.farm, ...body } });
  toast(doneText);
  await loadCcvAlerts();
}

// PDF do relatório do CCV para anexar: gerado no Power BI na hora, sempre filtrado na fazenda do
// alerta (leva de 30 s a 1 min). A página escolhida e a opção de anexar ficam lembradas no navegador.
const CCV_PDF_PAGE = 'ccvPdfPage';
const CCV_PDF_ON = 'ccvPdfOn';
const remembered = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

function ccvPdfPicker(report, farm) {
  const box = h('input', { type: 'checkbox', checked: remembered(CCV_PDF_ON) === '1' });
  const page = h('select', { 'aria-label': 'Página do relatório', disabled: true }, h('option', {}, 'Carregando as páginas…'));
  const gen = h('button', { class: 'btn btn-sm', type: 'button' }, 'Gerar prévia');
  const preview = h('a', { class: 'btn btn-sm', target: '_blank', rel: 'noopener', hidden: true }, 'Ver PDF');
  const HINT = 'O PDF sai só com os dados desta fazenda. Gerar leva de 30 s a 1 minuto.';
  const status = h('small', {}, HINT);
  const controls = h('div', { class: 'ccv-pdf-row' }, page, gen, preview);
  let job = null;
  let jobPage = null;
  let running = null;
  const sync = () => {
    controls.hidden = !box.checked;
    status.hidden = !box.checked;
  };
  api(`/api/admin/ccv/pages?reportId=${encodeURIComponent(report.id)}`)
    .then(({ pages }) => {
      const saved = remembered(CCV_PDF_PAGE);
      // Sem escolha anterior: a última aba (no relatório atual, o "Relatório semanal").
      const pick = pages.some((p) => p.name === saved) ? saved : pages.at(-1)?.name;
      page.replaceChildren(...pages.map((p) => h('option', { value: p.name, selected: p.name === pick }, p.displayName)));
      page.disabled = false;
    })
    .catch((err) => {
      page.replaceChildren(h('option', {}, 'Páginas indisponíveis'));
      status.textContent = err.message;
    });
  page.addEventListener('change', () => {
    remember(CCV_PDF_PAGE, page.value);
    job = null;
    preview.hidden = true;
    status.textContent = HINT;
  });
  box.addEventListener('change', () => {
    remember(CCV_PDF_ON, box.checked ? '1' : '0');
    sync();
  });
  sync();

  async function generate(pageName) {
    gen.disabled = true;
    status.textContent = 'Gerando o PDF no Power BI… leva de 30 s a 1 minuto.';
    try {
      let { job: j } = await api('/api/admin/ccv/pdf', { method: 'POST', body: { reportId: report.id, farm, pageName } });
      while (j.status === 'running') {
        await new Promise((r) => setTimeout(r, 3000));
        ({ job: j } = await api(`/api/admin/ccv/pdf/${j.id}`));
      }
      if (j.status !== 'ready') throw new Error(`Não consegui gerar o PDF: ${j.error || 'erro do Power BI'}`);
      job = j;
      jobPage = pageName;
      preview.href = `/api/admin/ccv/pdf/${j.id}/file`;
      preview.hidden = false;
      status.textContent = `Pronto: ${j.fileName} (${Math.max(1, Math.round(j.size / 1024))} KB). Confira em "Ver PDF" antes de enviar.`;
      return j;
    } catch (err) {
      status.textContent = err.message;
      throw err;
    } finally {
      gen.disabled = false;
    }
  }
  // PDF pronto da página escolhida (gera se ainda não tiver).
  function ensure() {
    if (page.disabled) return Promise.reject(new Error('As páginas do relatório ainda não carregaram.'));
    if (job && jobPage === page.value) return Promise.resolve(job);
    if (!running || running.page !== page.value) {
      const p = page.value;
      const promise = generate(p).finally(() => {
        if (running === promise) running = null;
      });
      promise.page = p;
      running = promise;
    }
    return running;
  }
  gen.addEventListener('click', () => ensure().catch(() => {}));
  return {
    element: h('div', { class: 'field' }, h('label', { class: 'check' }, box, h('span', {}, 'Anexar PDF do relatório')), controls, status),
    wanted: () => box.checked,
    ensure,
  };
}

// Enviar alerta ou resumo: o admin revisa o texto e escolhe quem recebe.
function sendCcvDialog(report, f, kind) {
  const wa = ccvState.data.whatsapp;
  const ready = wa.configured && wa.ccvTemplate;
  const text = h('textarea', { name: 'text', rows: 12, style: 'font: 13px/1.45 var(--font-data)' }, f.messages[kind]);
  // Por onde vai: mensagem no portal (sempre disponível), WhatsApp oficial (se configurado) ou só registrar um envio feito por fora.
  const channels = [
    { value: 'portal', label: 'Pelo portal (botão Mensagens do usuário)' },
    ready ? { value: 'whatsapp', label: 'Pelo WhatsApp oficial' } : null,
    { value: 'manual', label: 'Já enviei por fora (só registrar)' },
  ].filter(Boolean);
  const channel = h('select', { name: 'channel' }, channels.map((c) => h('option', { value: c.value }, c.label)));
  const pdf = ccvPdfPicker(report, f.farm);
  const rows = f.recipients.map((r) => {
    const box = h('input', { type: 'checkbox', value: r.id, checked: true });
    const wame = r.phone ? h('a', { class: 'btn btn-sm btn-ghost', target: '_blank', rel: 'noopener', href: '#', onclick: (e) => (e.currentTarget.href = `https://wa.me/${r.phone}?text=${encodeURIComponent(text.value)}`) }, 'Abrir no WhatsApp') : null;
    return { r, box, row: h('label', { class: 'check', style: 'align-items: center' }, box, h('span', { style: 'flex: 1' }, r.name, h('span', { class: 'muted' }, r.phone ? ` · +${r.phone}` : ' · sem WhatsApp cadastrado')), wame) };
  });
  formDialog(
    `${kind === 'alerta' ? 'Enviar alerta' : 'Enviar resumo da semana'} · ${f.farm}`,
    [
      field('Mensagem', text, 'Revise e ajuste o texto antes de enviar.'),
      h(
        'div',
        { class: 'field' },
        h('span', {}, 'Quem recebe'),
        rows.length ? h('div', { class: 'checkbox-list' }, rows.map((x) => x.row)) : h('small', {}, 'Nenhum usuário ativo vê esta fazenda no painel. Cadastre usuários no cliente (ou libere a fazenda para eles).'),
      ),
      field('Enviar', channel, ready ? 'No WhatsApp, quem não tem telefone cadastrado não recebe.' : 'O WhatsApp oficial ainda não está configurado (falta o modelo WHATSAPP_TEMPLATE_CCV). Para mandar pelo seu WhatsApp, use "Abrir no WhatsApp" ou copie o texto e registre o envio.'),
      pdf.element,
      h('div', {}, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(text.value, text) }, 'Copiar texto')),
    ],
    {
      submitLabel: 'Enviar',
      onSubmit: async () => {
        const recipientIds = rows.filter((x) => x.box.checked).map((x) => x.r.id);
        if (!recipientIds.length) throw new Error('Marque ao menos uma pessoa.');
        if (channel.value === 'whatsapp' && wa.ccvTemplatePdf && !pdf.wanted()) throw new Error('O modelo do WhatsApp configurado exige o PDF anexo.');
        const pdfId = pdf.wanted() ? (await pdf.ensure()).id : undefined;
        const { entry } = await api('/api/admin/ccv/alerts/decide', {
          method: 'POST',
          body: { reportId: report.id, key: f.key, farm: f.farm, action: kind, text: text.value, recipientIds, channel: channel.value, pdfId },
        });
        const people = (n) => `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;
        const withPdf = entry.pdf ? ' com o PDF' : '';
        const pdfLost = entry.pdfFailed?.length ? `. O PDF não chegou para ${entry.pdfFailed.join(', ')} (fora da janela de 24 h do WhatsApp)` : '';
        toast(
          entry.channel === 'portal'
            ? `Mensagem${withPdf} enviada no portal para ${people(entry.sent)}.`
            : entry.channel === 'whatsapp'
              ? `Enviado${withPdf} para ${people(entry.sent)}${entry.failed.length ? ` (falhou: ${entry.failed.join(', ')})` : ''}${pdfLost}.`
              : 'Envio registrado.',
        );
        await loadCcvAlerts();
      },
    },
  );
}

function treatedDialog(report, f) {
  const note = h('textarea', { name: 'note', rows: 3, placeholder: 'Ex.: liguei para o gerente, já estão ajustando a leitura.' });
  formDialog(`Marcar como tratado · ${f.farm}`, [field('O que foi feito (opcional)', note)], {
    submitLabel: 'Marcar como tratado',
    onSubmit: () => decideCcv(report, f, { action: 'tratado', note: note.value }, 'Alerta marcado como tratado.'),
  });
}

function ccvFarmCard(report, f) {
  const sev = CCV_SEV[f.severity];
  const k = f.kpis;
  const facts = [
    k.ibc !== null ? `IBC ${dec1(k.ibc)}${k.ibcAnt !== null ? ` (antes ${dec1(k.ibcAnt)})` : ''}` : null,
    k.conformidade !== null ? `Conformidade ${pctText(k.conformidade)}${k.conformidadeAnt !== null ? ` (antes ${pctText(k.conformidadeAnt)})` : ''}` : 'Sem leitura de sobra',
    k.inconsistencias !== null ? `${num(k.inconsistencias)} inconsistências` : null,
    k.rebanho !== null ? `${num(Math.round(k.rebanho))} cabeças` : null,
    f.lastReading ? `última leitura ${fmtDateOnly(`${f.lastReading}T12:00:00`)}` : null,
  ].filter(Boolean);
  const decision = f.decision
    ? h(
        'p',
        { class: 'ccv-decision' },
        h('strong', {}, CCV_ACTION[f.decision.action] || f.decision.action),
        ` por ${f.decision.adminName || 'admin'} em ${fmtDate(f.decision.at)}`,
        f.decision.recipients?.length ? ` · para ${f.decision.recipients.map((r) => r.name).join(', ')}` : '',
        { manual: ' (envio manual)', portal: ' (pelo portal)', whatsapp: ' (pelo WhatsApp)' }[f.decision.channel] || '',
        f.decision.pdf ? ` · com PDF (${f.decision.pdf.page})` : '',
        f.decision.note ? ` · “${f.decision.note}”` : '',
      )
    : f.snoozedUntil
      ? h('p', { class: 'ccv-decision' }, h('strong', {}, 'Adiado'), ` até ${fmtDate(f.snoozedUntil)}`)
      : null;
  const snooze = (days) => decideCcv(report, f, { action: 'adiar', days }, `Alerta de ${f.farm} adiado por ${days} ${days === 1 ? 'dia' : 'dias'}.`).catch((err) => toast(err.message, 'error'));
  const action = (label, onclick, cls = 'btn btn-sm') => h('button', { class: cls, type: 'button', onclick }, label);
  return h(
    'article',
    { class: `alert-card ${sev.cls}` },
    h('span', { class: 'alert-icon', 'aria-hidden': 'true' }, f.severity === 'ok' ? '✓' : f.severity === 'alta' ? '⚠' : '•'),
    h(
      'div',
      { class: 'alert-main' },
      h('strong', {}, f.farm, h('span', { class: 'muted', style: 'font-weight: 400' }, ` · ${f.clients.map((c) => c.name).join(', ')}`)),
      f.signals.length ? h('ul', { class: 'ccv-signals' }, f.signals.map((s) => h('li', { class: s.severity === 'alta' ? 'alta' : '' }, s.text))) : h('p', {}, 'Nenhum sinal de alerta na semana.'),
      h('p', { class: 'muted' }, facts.join(' · ')),
      f.lotes.length
        ? h('details', { class: 'ccv-lotes' }, h('summary', {}, `Lotes com mais leituras críticas (${f.lotes.length})`), h('ul', {}, f.lotes.map((l) => h('li', {}, h('strong', {}, `Lote ${l.lote}`), l.curral ? ` (${l.curral})` : '', ` · ${l.resumo || `${l.criticas} críticas`}`))))
        : null,
      decision,
      h(
        'div',
        { class: 'alert-actions' },
        action('Enviar alerta', () => sendCcvDialog(report, f, 'alerta'), f.severity === 'ok' ? 'btn btn-sm' : 'btn btn-sm btn-primary'),
        action('Enviar resumo', () => sendCcvDialog(report, f, 'relatorio')),
        h('a', { class: 'btn btn-sm btn-ghost', href: `/portal#${report.id}/fazenda/${encodeURIComponent(f.farm)}`, target: '_blank', rel: 'noopener' }, 'Abrir painel'),
        f.decision ? null : action('Tratado', () => treatedDialog(report, f), 'btn btn-sm btn-ghost'),
        f.decision || f.snoozedUntil ? null : h('span', { class: 'alert-snooze' }, action('Adiar 1 dia', () => snooze(1), 'btn btn-sm btn-ghost'), action('3 dias', () => snooze(3), 'btn btn-sm btn-ghost'), action('7 dias', () => snooze(7), 'btn btn-sm btn-ghost')),
      ),
    ),
  );
}

function renderCcvAlerts() {
  const box = document.getElementById('ccv-alerts');
  const { reports, whatsapp } = ccvState.data;
  const counter = document.getElementById('count-ccv');
  if (!reports.length) {
    counter.textContent = '';
    box.replaceChildren(h('p', { class: 'alert' }, 'Nenhum relatório do tipo "Painel CCV" cadastrado. Em Relatórios, cadastre (ou edite) o relatório "Ferramenta CCV" e escolha o tipo "Painel CCV".'));
    return;
  }
  let pendingHigh = 0;
  let pendingAll = 0;
  const blocks = reports.map((data) => {
    const report = data.report;
    const pending = data.farms.filter((f) => f.severity !== 'ok' && !f.decision && !f.snoozedUntil);
    const decided = data.farms.filter((f) => f.decision);
    const snoozed = data.farms.filter((f) => !f.decision && f.snoozedUntil);
    const quiet = data.farms.filter((f) => f.severity === 'ok' && !f.decision && !f.snoozedUntil);
    pendingAll += pending.length;
    pendingHigh += pending.filter((f) => f.severity === 'alta').length;
    const group = (title, list, cls = '') => (list.length ? h('section', { class: 'alert-group' }, h('h3', { class: `usage-title ${cls}` }, `${title} · ${list.length}`), list.map((f) => ccvFarmCard(report, f))) : null);
    return [
      reports.length > 1 ? h('h3', { class: 'usage-title' }, report.name) : null,
      h(
        'div',
        { class: 'stats' },
        statTile('Pendentes · prioridade alta', num(pending.filter((f) => f.severity === 'alta').length)),
        statTile('Pendentes · atenção', num(pending.filter((f) => f.severity === 'media').length)),
        statTile('Decididos nesta semana', num(decided.length)),
        statTile('Fazendas monitoradas', num(data.farms.length), data.period ? h('span', { class: 'muted' }, `semana de ${fmtDateOnly(`${data.period.from}T12:00:00`).slice(0, 5)} a ${fmtDateOnly(`${data.period.to}T12:00:00`).slice(0, 5)}`) : null),
      ),
      data.farms.length ? null : h('p', { class: 'alert' }, 'Nenhuma fazenda ligada a clientes. Em Clientes → Editar, marque o relatório CCV e escolha as fazendas de cada cliente.'),
      pending.length ? null : data.farms.length ? h('p', { class: 'alert alert-ok' }, 'Nenhum alerta pendente nesta semana. 🎉') : null,
      group('Prioridade alta', pending.filter((f) => f.severity === 'alta'), 'sev-alta'),
      group('Atenção', pending.filter((f) => f.severity === 'media'), 'sev-media'),
      group('Decididos nesta semana', decided),
      group('Adiados', snoozed),
      quiet.length ? h('details', { class: 'ccv-quiet' }, h('summary', {}, `Sem alerta · ${quiet.length}`), quiet.map((f) => ccvFarmCard(report, f))) : null,
      data.unlinked.length ? h('p', { class: 'muted usage-hint' }, `Fazendas no modelo sem cliente no portal (não geram alerta): ${data.unlinked.join(', ')}.`) : null,
    ];
  });
  counter.textContent = pendingAll || '';
  counter.classList.toggle('has-high', pendingHigh > 0);
  box.replaceChildren(
    ...[
      whatsapp.configured && whatsapp.ccvTemplate
        ? null
        : h('p', { class: 'muted usage-hint' }, 'Envio automático pelo WhatsApp desligado (falta o modelo WHATSAPP_TEMPLATE_CCV). Dá para copiar a mensagem ou abrir o seu WhatsApp com o texto pronto e registrar o envio.'),
      ...blocks.flat(),
    ].filter(Boolean),
  );
}

// ---------- Alertas CCV → Uso da ferramenta ----------

const ccvUsageState = { view: 'alertas', data: null, loading: false };
const USO_NIVEL = {
  completo: ['Completo', 'ok'],
  parcial: ['Parcial', 'warn'],
  baixo: ['Baixo', 'crit'],
  so_voo: ['Só voo', 'neutral'],
  parado: ['Parado', 'crit'],
};
const CCV_INTRO = {
  alertas: 'Situação da última semana de leitura de cocho em cada fazenda ligada a um cliente, comparada à semana anterior. Para cada fazenda, decida: enviar o alerta, enviar o resumo da semana, adiar ou dar por tratado. Tudo fica registrado no histórico.',
  uso: 'O que cada fazenda realmente faz na Ferramenta CCV nos últimos 7 dias: último voo, leitura da manhã, decisão de trato e leitura noturna — quando foi feita, em quantos currais e em quantos dias — e o IBC do último voo. Todas as fazendas do modelo aparecem, com ou sem cliente no portal.',
};

function selectCcvView(view) {
  ccvUsageState.view = view;
  document.querySelectorAll('[data-ccv-view]').forEach((b) => {
    b.classList.toggle('on', b.dataset.ccvView === view);
    b.setAttribute('aria-selected', String(b.dataset.ccvView === view));
  });
  document.getElementById('ccv-alerts').hidden = view !== 'alertas';
  document.getElementById('ccv-usage').hidden = view !== 'uso';
  document.getElementById('ccv-history').hidden = view !== 'alertas';
  document.getElementById('ccv-intro').textContent = CCV_INTRO[view];
  if (view === 'uso' && !ccvUsageState.data) loadCcvUsage();
  if (view === 'alertas' && !ccvState.data) loadCcvAlerts();
}

async function loadCcvUsage({ refresh = false } = {}) {
  if (ccvUsageState.loading) return;
  ccvUsageState.loading = true;
  const box = document.getElementById('ccv-usage');
  if (!ccvUsageState.data || refresh) box.replaceChildren(h('p', { class: 'muted' }, 'Lendo o uso de todas as fazendas no modelo do CCV…'));
  try {
    ccvUsageState.data = await api(`/api/admin/ccv/usage${refresh ? '?refresh=1' : ''}`);
    renderCcvUsage();
  } catch (err) {
    box.replaceChildren(h('p', { class: 'alert' }, err.message));
  } finally {
    ccvUsageState.loading = false;
  }
}

function renderCcvUsage() {
  const box = document.getElementById('ccv-usage');
  const { reports } = ccvUsageState.data;
  if (!reports.length) {
    box.replaceChildren(h('p', { class: 'alert' }, 'Nenhum relatório do tipo "Painel CCV" cadastrado.'));
    return;
  }
  const blocks = reports.map(({ report, period, farms }) => {
    if (!period) return h('p', { class: 'muted' }, 'Sem dados no modelo.');
    const end = period.to;
    const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
    const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    const quando = (iso) => {
      const n = Math.round((Date.parse(end) - Date.parse(iso)) / 86400000);
      return n <= 0 ? `hoje (${ddmm(iso)})` : n === 1 ? `ontem (${ddmm(iso)})` : ddmm(iso);
    };
    // Célula de uma etapa: quando foi feita por último, quantos currais e em quantos dias.
    const stepCell = (s, { extra = null, warn = null } = {}) => {
      if (!s.dias) return h('td', { class: 'uso-cell off' }, h('strong', {}, 'Não faz'), h('span', {}, s.diasVoo ? `0 de ${s.diasVoo} dias com voo` : 'sem voo no período'));
      const cls = warn ? 'warn' : s.emUso ? 'ok' : 'warn';
      return h(
        'td',
        { class: `uso-cell ${cls}` },
        h('strong', {}, `${s.currais} de ${s.total} currais`, h('small', {}, ` · ${pct(s.currais, s.total)}`)),
        h('span', {}, `Último: ${quando(s.lastDay)} · ${s.dias} de ${s.diasVoo} dias`),
        extra,
        warn ? h('span', { class: 'uso-warn' }, `⚠ ${warn}`) : null,
      );
    };
    const meta = ccvUsageState.data.reports[0].rules.ibcMeta;
    const dec2 = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // IBC do último dia que tem IBC: valor (verde na meta, amarelo até 0,5 abaixo, vermelho abaixo disso),
    // tendência contra o dia anterior com IBC, currais abaixo da meta e a média dos 7 dias.
    const ibcCell = (i, diasVoo) => {
      if (!i) return h('td', { class: 'uso-cell off' }, h('strong', {}, 'Sem IBC'), h('span', {}, diasVoo ? `0 de ${diasVoo} dias com voo` : 'sem voo no período'));
      const cls = i.valor >= meta ? 'ok' : i.valor >= meta - 0.5 ? 'warn' : 'crit';
      const delta = i.anterior === null ? null : i.valor - i.anterior;
      const seta = delta === null || Math.abs(delta) < 0.05 ? '' : delta > 0 ? ' ↑' : ' ↓';
      return h(
        'td',
        { class: `uso-cell ${cls}` },
        h('strong', { title: i.anterior === null ? '' : `Dia anterior com IBC: ${dec2(i.anterior)}` }, dec2(i.valor), h('small', {}, seta)),
        h('span', {}, `${i.abaixo} de ${i.currais} currais abaixo de ${meta.toLocaleString('pt-BR')}`),
        h('span', {}, `Último: ${quando(i.lastDay)} · média 7 dias ${dec2(i.media)}`),
        i.currais < i.total ? h('span', {}, `IBC em ${i.currais} de ${i.total} currais sobrevoados`) : null,
      );
    };
    const rows = farms.map((f) => {
      const [nivel, nivelCls] = USO_NIVEL[f.nivel];
      const vooCls = f.daysSince > 3 ? 'crit' : f.daysSince >= 1 ? 'warn' : '';
      const voo = f.lastFlight && f.curraisVoo ? `${ddmm(f.lastFlight)} ${f.lastFlight.slice(11, 16)}` : f.lastFlightDay ? ddmm(f.lastFlightDay) : '—';
      const d = f.decisao;
      return h(
        'tr',
        {},
        h('th', { scope: 'row' }, h('strong', {}, f.farm), h('span', { class: 'sub' }, f.clients.length ? f.clients.join(', ') : 'sem cliente no portal')),
        h('td', { class: `uso-voo ${vooCls}` }, h('strong', {}, voo), h('span', {}, f.curraisVoo ? `${f.curraisVoo} currais · ${f.diasVoo} de ${period.days} dias` : f.daysSince !== null ? `há ${f.daysSince} dias` : '')),
        stepCell(f.manha),
        stepCell(d, {
          extra: d.mix ? h('span', { class: 'uso-mix', title: 'Último dia: aumentou · manteve · reduziu' }, `↑ ${d.mix.up}  = ${d.mix.eq}  ↓ ${d.mix.down}`) : null,
          warn: d.suspeita ? 'só "Manteve" em 7 dias: pode ser o valor padrão do aplicativo' : null,
        }),
        stepCell(f.noturna, {
          extra: f.noturna.dias && !f.noturna.suspeita ? h('span', {}, `Cocho vazio em ${pct(f.noturna.pctVazio, 1)} das leituras`) : null,
          warn: f.noturna.suspeita ? 'nunca registrou cocho vazio em 7 dias: provável valor padrão, não leitura feita' : null,
        }),
        ibcCell(f.ibc, f.diasVoo),
        h('td', {}, h('span', { class: `uso-nivel ${nivelCls}` }, nivel)),
      );
    });
    const count = (n) => farms.filter((f) => f.nivel === n).length;
    return [
      reports.length > 1 ? h('h3', { class: 'usage-title' }, report.name) : null,
      h(
        'div',
        { class: 'stats' },
        statTile('Completo', num(count('completo')), h('span', { class: 'muted' }, 'manhã, decisão e noturna')),
        statTile('Parcial', num(count('parcial'))),
        statTile('Baixo', num(count('baixo'))),
        statTile('Só voo', num(count('so_voo'))),
        statTile('Parado', num(count('parado')), h('span', { class: 'muted' }, 'sem voo há mais de 3 dias')),
      ),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'uso-table' },
          h('thead', {}, h('tr', {}, ['Fazenda', 'Último voo', 'Leitura da manhã', 'Decisão de trato', 'Leitura noturna', `IBC (meta ${meta.toLocaleString('pt-BR')})`, 'Nível'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, rows),
        ),
      ),
      h(
        'p',
        { class: 'muted usage-hint' },
        `Período: ${ddmm(period.from)} a ${ddmm(period.to)}. Uma etapa conta como "em uso" (verde) quando foi feita em pelo menos ${Math.round(ccvUsageState.data.reports[0].rules.emUso * 100)}% dos dias com voo, cobrindo pelo menos metade dos currais sobrevoados. Completo = as três etapas em uso; Parcial = uma ou duas; Baixo = feitas de vez em quando; Só voo = nenhuma; Parado = sem voo há mais de 3 dias. O IBC não entra no nível: é o resultado, não uso. Atualiza a cada 30 minutos (ou em "Buscar dados novos").`,
      ),
    ];
  });
  box.replaceChildren(...blocks.flat().filter(Boolean));
}

async function ccvHistory() {
  try {
    const { log } = await api('/api/admin/ccv/log');
    const tableEl = h('table');
    table(
      tableEl,
      ['Quando', 'Fazenda', 'Decisão', 'Por', 'Detalhe'],
      log.map((e) =>
        h(
          'tr',
          {},
          h('td', { class: 'mono' }, fmtDate(e.at)),
          h('td', {}, e.farm),
          h(
            'td',
            {},
            CCV_ACTION[e.action] || e.action,
            e.channel === 'manual' ? h('span', { class: 'sub' }, 'envio manual') : e.channel === 'whatsapp' ? h('span', { class: 'sub' }, `WhatsApp · ${e.sent || 0} enviada(s)`) : e.channel === 'portal' ? h('span', { class: 'sub' }, 'mensagem no portal') : null,
            e.pdf ? h('span', { class: 'sub' }, `📄 PDF · ${e.pdf.page}`) : null,
          ),
          h('td', {}, e.adminName || '—'),
          h('td', {}, e.recipients?.length ? `Para ${e.recipients.map((r) => r.name).join(', ')}` : e.until ? `Até ${fmtDate(e.until)}` : e.note || ''),
        ),
      ),
      'Nenhuma decisão registrada ainda.',
    );
    formDialog('Histórico de alertas CCV', h('div', { class: 'table-wrap' }, tableEl));
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

  const toolsTable = h('table');
  table(
    toolsTable,
    ['Ferramenta', 'Aberturas', 'Pessoas', 'Tempo total', 'Tempo médio', 'Último acesso'],
    (u.tools || []).map((x) =>
      h(
        'tr',
        {},
        h('td', {}, h('strong', {}, x.name)),
        h('td', { class: 'mono' }, num(x.views)),
        h('td', { class: 'mono' }, num(x.users)),
        h('td', { class: 'mono' }, fmtMinutes(x.minutes)),
        h('td', { class: 'mono' }, x.avgMinutes ? `${String(x.avgMinutes).replace('.', ',')} min` : '—'),
        h('td', {}, fmtAgo(x.lastView)),
      ),
    ),
    'Nenhuma ferramenta acessada no período.',
  );

  const feedLabels = { view: 'abriu', tool_view: 'abriu', login: 'entrou no portal', export: 'gerou PDF de', ask: 'perguntou ao assistente' };
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
        h('td', {}, `${feedLabels[e.type] || e.type}${e.report ? ` ${e.report}` : ''}${e.tool ? ` ${e.tool}` : ''}`),
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
    sectionTitle('Ferramentas'),
    h('p', { class: 'muted usage-hint' }, 'Ferramentas do portal fora dos relatórios do Power BI, como o 4M Confinamento.'),
    scrollTable(toolsTable),
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

// ---------- Fazendas do painel CCV ----------

// Fazendas do modelo do CCV (o servidor guarda em cache por 1 hora).
let ccvFarmsRequest = null;
function loadCcvFarms() {
  ccvFarmsRequest ??= api('/api/admin/ccv/farms')
    .then((d) => d.farms.map((f) => f.name))
    .catch((err) => {
      ccvFarmsRequest = null;
      throw err;
    });
  return ccvFarmsRequest;
}

// Lista de fazendas com busca. options(): nomes possíveis; selected: marcadas. Devolve { el, values() }.
function farmPicker({ label, hint, selected = [], options }) {
  const picked = new Set(selected);
  const list = h('div', { class: 'checkbox-list' }, h('p', { class: 'muted', style: 'margin: 0' }, 'Buscando fazendas no modelo do CCV…'));
  const count = h('small', {});
  const updateCount = () => {
    count.textContent = picked.size ? `${picked.size} ${picked.size === 1 ? 'fazenda marcada' : 'fazendas marcadas'}` : hint;
  };
  const search = h('input', {
    type: 'search',
    placeholder: 'Buscar fazenda',
    'aria-label': 'Buscar fazenda',
    oninput: () => {
      const term = fold(search.value.trim());
      list.querySelectorAll('label').forEach((row) => (row.hidden = term !== '' && !fold(row.textContent).includes(term)));
    },
  });
  const render = (names) => {
    // Fazendas marcadas que não existem mais no modelo continuam aparecendo, para poder desmarcar.
    const all = [...new Set([...names, ...picked])].sort((a, b) => Number(picked.has(b)) - Number(picked.has(a)) || a.localeCompare(b, 'pt-BR'));
    list.replaceChildren(
      ...(all.length
        ? all.map((name) => {
            const box = h('input', { type: 'checkbox', value: name, checked: picked.has(name), onchange: () => (box.checked ? picked.add(name) : picked.delete(name), updateCount()) });
            return h('label', { class: 'check' }, box, h('span', {}, name, names.includes(name) ? null : h('span', { class: 'muted' }, ' (não está mais no modelo)')));
          })
        : [h('p', { class: 'muted', style: 'margin: 0' }, 'Nenhuma fazenda disponível.')]),
    );
  };
  updateCount();
  const el = h('div', { class: 'field' }, h('span', {}, label), search, list, count);
  return {
    el,
    refresh: () =>
      Promise.resolve(options())
        .then(render)
        .catch((err) => list.replaceChildren(h('p', { class: 'alert', style: 'margin: 0' }, err.message))),
    values: () => [...picked],
  };
}

function clientDialog(client) {
  const active = h('input', { id: 'active', type: 'checkbox', checked: client ? client.active : true });
  const benchmark = h('input', { type: 'checkbox', checked: Boolean(client?.benchmark) });
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
      h('span', {}, r.name, ' ', h('span', { class: 'muted' }, `· ${r.category}`), r.rls ? [' ', h('span', { class: 'pill pill-accent' }, 'RLS')] : null, r.kind === 'ccv' ? [' ', h('span', { class: 'pill pill-accent' }, 'Painel CCV')] : null),
    ),
  );
  // Fazendas do painel CCV: aparecem quando algum relatório CCV está marcado.
  const farms = farmPicker({ label: 'Fazendas do painel CCV que este cliente vê', hint: 'Nenhuma marcada: o cliente não vê dados no painel CCV.', selected: client?.ccvFarms || [], options: loadCcvFarms });
  const ccvIds = new Set(state.reports.filter((r) => r.kind === 'ccv').map((r) => r.id));
  const syncFarms = () => {
    const show = reportChecks.some((row) => {
      const box = row.querySelector('input');
      return box.checked && ccvIds.has(box.value);
    });
    if (show && farms.el.hidden !== false) farms.refresh();
    farms.el.hidden = !show;
  };
  farms.el.hidden = true;
  reportChecks.forEach((row) => row.querySelector('input').addEventListener('change', syncFarms));
  syncFarms();
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
      farms.el,
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
      h('label', { class: 'check' }, benchmark, h('span', {}, h('strong', {}, 'Participa do Benchmarking Confinamento'), h('br'), h('span', { class: 'muted' }, 'Os usuários deste cliente veem a ferramenta de coleta no portal.'))),
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
          ccvFarms: farms.values(),
          benchmark: benchmark.checked,
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
  // Painel CCV: opcionalmente, só algumas das fazendas dos clientes marcados.
  const clientFarms = () => [...new Set(clientRows.filter((r) => r.box.checked).flatMap((r) => r.c.ccvFarms || []))];
  const farms = farmPicker({
    label: 'Fazendas do painel CCV que este usuário vê',
    hint: 'Nenhuma marcada: vê todas as fazendas CCV dos clientes dele.',
    selected: user?.ccvFarms || [],
    options: clientFarms,
  });
  const syncFarms = () => {
    farms.el.hidden = role.value === 'admin' || (!clientFarms().length && !(user?.ccvFarms || []).length);
    if (!farms.el.hidden) farms.refresh();
  };
  clientRows.forEach((r) => r.box.addEventListener('change', syncFarms));
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
    clientRows.length ? h('div', { class: 'checkbox-list' }, clientRows.map((r) => r.row)) : null,
    pickedCount,
    h('small', {}, 'Nenhum marcado: a pessoa não vê relatórios e usa só as ferramentas liberadas abaixo.'),
  );
  // Ferramentas (4M, 3P): marcar libera na hora, sem esperar pedido; desmarcar revoga. Pedido
  // pendente ou negado continua como está se a caixa ficar desmarcada.
  const toolBoxes = TOOL_ACCESS.map((t) => ({ t, box: h('input', { type: 'checkbox', checked: user?.[t.field]?.status === 'approved' }) }));
  const toolField = h(
    'div',
    { class: 'field' },
    h('span', {}, 'Ferramentas liberadas'),
    h('div', { class: 'tool-checks' }, toolBoxes.map(({ t, box }) => h('label', { class: 'check' }, box, h('span', {}, t.name)))),
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
    toolField.hidden = role.value === 'admin';
    syncFarms();
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
      farms.el,
      toolField,
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
          // Só as fazendas que ainda pertencem a algum cliente marcado.
          ccvFarms: farms.values().filter((f) => clientFarms().includes(f)),
          phone: form.elements['phone'].value,
          whatsappNotify: notify.checked,
          isManager: manager.checked,
          active: active.checked,
        };
        const applyTools = async (saved) => {
          if (saved.role === 'admin') return;
          for (const { t, box } of toolBoxes) {
            const approved = saved[t.field]?.status === 'approved';
            if (box.checked !== approved && (box.checked || approved)) {
              await api(`/api/admin/users/${saved.id}/${t.field}`, { method: 'POST', body: { action: box.checked ? 'approve' : 'revoke' } });
            }
          }
        };
        if (user) {
          const { user: saved } = await api(`/api/admin/users/${user.id}`, { method: 'PUT', body });
          await applyTools(saved);
          await refresh();
          toast('Usuário atualizado.');
          return true;
        }
        const result = await api('/api/admin/users', { method: 'POST', body });
        await applyTools(result.user);
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
  if (name === 'ccv') selectCcvView(ccvUsageState.view);
  if (name === 'chat') loadInbox();
  if (name === 'quotes') loadQuotes();
  if (name === 'benchmark') loadBenchmark();
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
  document.getElementById('ccv-refresh').addEventListener('click', () => (ccvUsageState.view === 'uso' ? loadCcvUsage({ refresh: true }) : loadCcvAlerts({ refresh: true })));
  document.querySelectorAll('[data-ccv-view]').forEach((b) => b.addEventListener('click', () => selectCcvView(b.dataset.ccvView)));
  document.getElementById('ccv-history').addEventListener('click', ccvHistory);
  document.getElementById('chat-search').addEventListener('input', renderThreads);
  document.getElementById('chat-filter').addEventListener('change', renderThreads);
  document.getElementById('chat-new').addEventListener('click', () => newChatDialog());
  document.getElementById('quote-new').addEventListener('click', () => quoteDialog());
  document.getElementById('bmk-settings').addEventListener('click', () => (bmkState.data ? benchmarkSettingsDialog() : loadBenchmark().then(benchmarkSettingsDialog)));
  document.getElementById('bmk-export').addEventListener('click', exportBenchmark);
  // Contador de coletas esperando validação na aba, mesmo antes de abri-la.
  api('/api/admin/benchmark')
    .then((d) => {
      bmkState.data = d;
      const waiting = d.clients.filter((c) => c.status === 'enviado').length;
      const el = document.getElementById('count-benchmark');
      el.textContent = waiting || '';
      el.classList.toggle('has-high', waiting > 0);
    })
    .catch(() => {});
  api('/api/admin/chat').then((inbox) => ((chatState.inbox = inbox), updateChatCount(inbox))).catch(() => {});
  startChatPolling();
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

# BI Probeef — portal de BIs + ferramentas internas

Portal que distribui relatórios do Power BI Embedded para clientes (login por empresa, RLS
opcional) e também hospeda ferramentas internas da Cargill/ProBeef por trás do mesmo login —
a primeira delas é a calculadora **4M Confinamento**. Veja o `README.md` para a visão geral de
produto (Power BI, WhatsApp, assistente de IA); este arquivo é sobre como o código está
organizado e como continuar trabalhando nele.

## Origem — dois projetos que viraram um

Este projeto nasceu como só o portal de BI. Em outubro de 2026, a calculadora **4M
Confinamento** — que era um app HTML/JS standalone, com login próprio e backend em
Railway+Postgres, em `C:\Users\andre\OneDrive\Documentos\4M\build` — foi **copiada e adaptada**
para dentro deste portal (`public/confinamento/`), reaproveitando a sessão e o armazenamento
daqui em vez dos próprios. **O app standalone antigo continua existindo e publicado
separadamente** (Netlify/Railway, `4m-confinamento-production.up.railway.app`) — é uma cópia
irmã, não a mesma instância; mudanças num lado não aparecem no outro automaticamente. O
`CLAUDE.md` daquele projeto (se existir) descreve só a versão standalone.

A partir de agora, o trabalho contínuo nessas ferramentas deve acontecer **aqui**, não lá.

## Stack e convenções

- Node ESM (`"type": "module"`), Express, sem framework de frontend — HTML + JS puro servido
  por `express.static`, módulos JS com `<script type="module">`.
- Dados ficam em **um arquivo JSON** (`src/store.js`, `db()`/`save()`), não em banco externo —
  decisão deliberada, documentada no README ("atende bem dezenas de clientes"). Qualquer
  coleção nova (como `confinamentoSimulations`) entra em `empty()`/`normalize()` nesse arquivo.
- Autenticação por sessão (`cookie-session`), não JWT. `src/auth.js` tem `requireAuth` /
  `requireAdmin` / `loadUser`. Senhas com scrypt.
- CSP estrita no `server.js` (Helmet): `scriptSrc: ["'self'"]`, sem CDN externo. Qualquer lib
  de terceiro (Power BI client, Chart.js) é servida localmente via rota `/vendor/*.js` a partir
  de `node_modules`, nunca via `<script src="https://cdn...">`.
- CSRF simples: toda requisição não-GET em `/api/*` precisa de `Content-Type: application/json`
  (ver `server.js`). Isso vale até para DELETE — sempre mande um corpo `{}` com esse header.
- Rotas ficam em `src/routes/*.js`, uma por área (`auth`, `admin`, `portal`, `assistant`,
  `team`, `whatsapp`, `confinamento`). Padrão de erro: lance `Error` com `.status`, o
  middleware central em `server.js` converte pra JSON.
- Frontend: `public/js/common.js` tem o helper `api()` (fetch + JSON + trata 401), `h()` (DOM
  sem innerHTML) e `toast()`. `public/js/admin.js` e `public/js/portal.js` reaproveitam esse
  padrão — ao adicionar uma tela nova no admin, siga a estrutura de aba existente em
  `admin.html`/`admin.js` (tab button + `<section data-panel="...">` + `render*()`/`load*()`).

## Padrão para "ferramentas" plugadas no portal (4M é a primeira)

Esse é o padrão pra adicionar a próxima ferramenta:

1. **Acesso por pedido/aprovação**, não liberado por padrão. Cada usuário tem um campo
   `confinamento: {status, requestedAt, decidedAt}` (ver `src/store.js` `normalize()`) — o nome
   do campo ficou específico do 4M porque foi o primeiro; uma segunda ferramenta provavelmente
   merece seu próprio campo (`u.nomeDaFerramenta`) ou generalizar para um objeto `u.tools[id]`
   se aparecer uma terceira. Administradores sempre têm acesso, sem pedir.
2. **Front-end estático** em `public/<nome>/`, com seu próprio `index.html`/`app.js`. Gate de
   acesso em `server.js` (`app.use('/<nome>', middleware-de-sessão, express.static(...))`) —
   só serve os arquivos pra quem está logado e aprovado.
3. **API dedicada** em `src/routes/<nome>.js`, montada em `/api/<nome>`, reaproveitando
   `requireAuth` e o `db()`/`save()` do store em vez de inventar armazenamento próprio.
4. **Métricas de uso**: ver `src/accessLog.js`, lista `TOOLS` no topo. Chame
   `recordToolAccess({userId, clientId, toolId})` e `startToolView(...)` quando a ferramenta
   abrir (rota `POST /api/<nome>/open`, ver `confinamento.js` como exemplo) — o resto
   (`/api/usage/beat`, `/api/usage/end`, tabela "Ferramentas" na aba Uso do admin) já é
   genérico e funciona sozinho a partir daí.

## Deploy

- GitHub: `AndreMauric/Probeef_hub`, branch `main`, auto-deploy ativado no Railway.
- Railway: variáveis de ambiente copiadas do `.env` local (ver `.env.example`) +
  `DATA_FILE=/data/db.json` apontando para um **volume persistente** montado em `/data`
  (sem isso, cada deploy apaga os dados — já aconteceu uma vez nesse projeto). Backups e
  imagens de relatório ficam ao lado do `db.json`, no mesmo volume.
- Primeiro admin: variável `BOOTSTRAP_ADMIN_EMAIL` cria um admin no primeiro boot (senha
  temporária sai nos logs). Pra resetar a senha de um admin depois, use o Console do Railway:
  `npm run create-admin -- email@exemplo.com "Nome"`.
- Antes de publicar uma mudança arriscada no armazenamento/API, teste localmente contra um
  `DATA_FILE` descartável (`DATA_FILE=/tmp/algo/db.json BOOTSTRAP_ADMIN_EMAIL=... PORT=3918
  NODE_ENV=development node server.js`) e valide com `curl` — não teste contra o `data/db.json`
  real nem contra a produção diretamente.

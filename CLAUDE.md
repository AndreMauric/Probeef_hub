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

## Painel CCV (relatório nativo, lido do modelo semântico)

A "Ferramenta CCV" (leitura de cocho) não é incorporada: o portal consulta o modelo semântico
do relatório via DAX (`executeDax`, API `executeQueries`) e desenha o painel em
`public/js/ccv.js`. Relatórios têm `kind: 'powerbi' | 'ccv'` (escolhido no cadastro do relatório).

- **O modelo junta todas as fazendas e não tem RLS.** O acesso é decidido pelo portal:
  `client.ccvFarms` (fazendas que o cliente vê) e, opcionalmente, `user.ccvFarms` (subconjunto;
  vazio = todas as do cliente). Toda consulta filtra a fazenda no servidor (`src/ccv.js`,
  `allowedFarms`/`readFilters`, falha fechada). Por isso `resolveAccess` recusa embed/PDF de
  relatórios `ccv`, e o bot/assistente os ignoram — não remova essas travas.
- As medidas são as do próprio modelo (os números batem com o relatório do Power BI). O filtro
  de período do relatório age em `Consulta1[data]` (data **com hora**: use `>= início` e
  `< fim + 1`). O service principal não consegue ler as fórmulas das medidas (INFO.MEASURES
  falha); para descobrir o que uma medida faz, avalie-a com filtros e compare com o relatório.
- Cada consulta conta na cota do service principal no Power BI (~120/min). As respostas ficam em
  cache por 5 min (painel) e 30 min (alertas).
- **Alertas CCV** (aba no admin): `computeCcvAlerts` compara a última semana com a anterior para
  cada fazenda ligada a um cliente (limites em `RULES`). O admin decide por fazenda/semana: enviar
  alerta, enviar resumo, adiar ou tratado; tudo vai para `ccvAlertLog`. O envio automático usa o
  modelo do WhatsApp `WHATSAPP_TEMPLATE_CCV`; sem ele, o admin copia o texto ou abre o WhatsApp
  dele e registra o envio.

## Mensagens (chat usuário ↔ equipe)

`src/chat.js` + `src/routes/chat.js` (usuário, `/api/chat`) + seção "Mensagens" em `admin.js`
(`/api/admin/chat`); front em `public/js/chat.js` (botão "Mensagens" no topo do portal e a aba do
admin reaproveitam `renderMessage`/`composer`). Uma conversa por usuário de cliente
(`chatThreads`, `chatMessages` no store); qualquer admin responde. Sem WebSocket: o front
consulta a cada 10 s com a conversa aberta e a cada 60 s só o contador. Cada mensagem do usuário
guarda o contexto (relatório aberto e, no CCV, a fazenda — validada contra as dele). Admin
"entrando como" só lê. Os Alertas CCV podem ser enviados pelo canal `portal`, que vira mensagem
nessa conversa.

## Faixa de cotações (rodapé do portal)

`src/quotes.js` + `public/js/ticker.js`, configurada na aba Cotações do admin (`db().quotes`).
Câmbio vem da AwesomeAPI e bolsas (Ibovespa, CBOT/CME) do endpoint não oficial do Yahoo Finance
(~15 min de atraso; pode mudar sem aviso — se quebrar, o portal mantém o último valor por até
3 dias e depois esconde o item). Os **preços brasileiros (CEPEA/B3) são lançados à mão** pelo
admin: o CEPEA bloqueia acesso automatizado e copiar de sites de terceiros (Notícias Agrícolas
etc.) foi descartado por termos de uso/licença — não troque por scraping sem uma fonte
autorizada. O servidor faz as chamadas externas (a CSP só permite `connectSrc: 'self'`).

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

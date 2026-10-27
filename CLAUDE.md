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
   se aparecer uma terceira. Administradores sempre têm acesso, sem pedir. Usuário pode não ter
   cliente nenhum ("Só ferramentas"): entra, vê só os cards das ferramentas (sem a lista de
   relatórios) e usa as que o admin liberou — no formulário de usuário, "Ferramentas liberadas"
   aprova direto. Gestor da empresa precisa de cliente; cliente desativado só bloqueia o login de
   quem não tem nenhuma ferramenta liberada.
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

### 3P · Predição de Desempenho a Pasto (segunda ferramenta)

Veio do app Shiny `relatorionutron.shinyapps.io/Probeef_Peformance_Pasto` (fonte em
`C:\Users\andre\Downloads\P3`, `app.R`). Segue o padrão acima com o campo `user.pasto`, rotas
`/api/pasto` e página `/pasto`. O cálculo roda no navegador em `public/pasto/model.js`, uma
tradução fiel do `app.R` (equação de GMD, tabelas de produto, contas econômicas e
arredondamentos). Foi conferida contra o relatório gerado pelo Shiny (`built_report.html`,
padrões, entrada em 18/03/2026): os 110 valores da tabela por época batem quando o GMD adicional
do PASTO BOM CROMO nas águas é 0,08, que era o valor da tabela naquele dia (o `app.R` atual,
de 20/03, usa 0,10, e é esse que está no portal). Se mexer na equação ou nas tabelas, refaça
essa conferência. No portal e no admin, as ferramentas já são listas (`TOOL_CARDS` em
`portal.js`, `TOOL_ACCESS` em `admin.js`): uma terceira ferramenta entra nessas listas. O Excel
é gerado no navegador com `exceljs` (`/vendor/exceljs.min.js`) e o relatório é uma página para
imprimir/salvar em PDF (`@media print`).

### Benchmarking Confinamento (coleta com validação)

Substitui a coleta pela planilha "Benchmarking Confinamento Probeef 2026 Feed Manager.xlsb"
(`Documentos\`). Não usa pedido de acesso: o admin marca `client.benchmark` e os usuários desse
cliente veem o card. Página `/benchmark` (`public/benchmark/`), API `/api/benchmark`
(`src/routes/benchmark.js`), regras em `src/benchmark.js`; rotas só de admin em `admin.js`.

- `public/benchmark/fields.js` é a fonte única das regras — campos dos lotes (com a letra da
  coluna da planilha original, usada para colar e importar), validações (coerência com
  tolerância, faixas mín/máx e listas, as mesmas da aba Configurações; o bug da planilha em
  que a tolerância de carcaça apontava para `$C$7` da própria aba foi corrigido), questionário
  (as 90 perguntas da aba Formulário/Q1) e o resultado por categoria (abas FINAL e FINAL
  RECRIA). É importado pelo navegador e pelo servidor (Node importa de `public/`).
- Dados: `db().bmkSubmissions` (um por cliente por ano; `version` evita sobrescrever o trabalho
  de outra pessoa) e `db().bmkSettings` (limites e listas, editáveis no admin). Fluxo
  rascunho → enviado → correção/aprovado; devolver/aprovar avisa os usuários pelo chat. "Apagar
  tudo" (`POST /api/benchmark/:clientId/clear`, `clearDraft`) zera lotes e/ou questionário enquanto
  dá para editar, pede para digitar APAGAR e fica no histórico (ação `limpar`).
- Importar a planilha atual é feito no navegador com SheetJS (`/vendor/xlsx.full.min.js`,
  pacote oficial de cdn.sheetjs.com — a versão do npm é antiga): lê BD_Zootec_Feed,
  BD_Econom_Feed, BD_Zootec_Feed_ Recria_Conf e Q1.
- **TGC** (clientes que não usam Feed Manager): o TGC exporta **um animal por linha** (abas
  BD_TGC_Conf / BD_TGC_Conf_Recria). `lotesFromTgc` em `fields.js` faz o que a tabela dinâmica da
  planilha fazia: agrupa por LOTE_SAIDA, conta os animais e tira a média de cada coluna (custos
  do lote = média por cabeça × animais; manejo = alimentar + fixo). Colunas achadas pelo nome
  (`tgcHeader`), não pela posição. Entra por "Importar planilha" (abas TGC da planilha ou a
  exportação pura), ou "Colar do Excel" com o cabeçalho. O TGC não traz tipo de entrada e escreve
  raça/categoria do jeito dele: depois da importação abre "Padronizar listas" e "Preencher em lote".
- Período do lote (`periodoLote` em `fields.js`, também em `calcLote`): entrada = saída − dias no
  confinamento (Dias conf.; sem ele, Dias de trato); "Águas" quando mais de 70% desses dias caem
  em dezembro–maio, senão "Seca". Aparece na tabela (ao lado de Saída), no detalhe do lote, no
  Painel (filtro e comparação) e no Excel consolidado do admin.
- Origem do lote é opcional (não existia por lote na planilha). "Preencher origem" (`originDialog`)
  aplica uma origem aos lotes sem origem, aos que a tabela mostra (filtro/busca) ou a todos; sugere
  a origem quando a pergunta 10 do questionário tem um só modelo de reposição (`Q10_ORIGEM`).
- Aba Resultado: "Painel" (`public/benchmark/dashboard.js`: filtros por raça, sexo, categoria,
  tipo de entrada e mês de saída; indicadores e comparação entre grupos, sempre médias
  ponderadas pelos animais) e "Tabelas por categoria" (as abas FINAL da planilha). Sexo sai da
  categoria (Macho de Engorda = machos; Fêmea de Engorda e Vaca de Descarte = fêmeas).
- As opções das perguntas de múltipla escolha foram montadas a partir das respostas de um
  cliente e precisam de revisão da equipe (sempre há "Outro").

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
- **PDF anexo nos alertas** (`src/ccvPdf.js`): o envio pode levar o PDF de uma página do
  relatório "Ferramenta CCV", gerado pela API ExportTo **sempre com `reportLevelFilters` na fazenda
  do alerta** (o relatório não tem RLS; conferido em out/2026: todas as páginas saem só com a
  fazenda). Leva ~30 s, então é um pedido que o navegador acompanha (`/api/admin/ccv/pdf`); o
  arquivo fica 1 h na memória. Pelo portal vira anexo da mensagem (pasta `files/` ao lado do
  `db.json`, baixado por `/api/chat/files/:id`, só pelo dono da conversa). Pelo WhatsApp vai no
  cabeçalho Documento do modelo quando `WHATSAPP_TEMPLATE_CCV_PDF=true`. O período das páginas é o
  que estiver salvo no seletor de datas do relatório.

- **Uso da ferramenta** (sub-aba de Alertas CCV, `ccvUsage` em `src/ccv.js`): por fazenda, nos
  últimos 7 dias, último voo e, para leitura da manhã, decisão de trato e leitura noturna, o
  último dia feito, quantos currais e em quantos dias. Atenção aos valores padrão do aplicativo:
  a leitura noturna grava "True" (com comida) mesmo quando ninguém lê — fazenda sem nenhum
  "False" (cocho vazio) em 7 dias é tratada como "não faz"; decisão 100% "Manteve" é sinalizada.
  A coluna IBC (`metricas.ibc`, meta 9,5 = `[Meta IBC]`) mostra o último dia com IBC — nem todo
  voo tem IBC, e IBC vazio passa num filtro `< 9,5`, por isso o `NOT ISBLANK`. Não entra no nível.

## Mensagens (chat usuário ↔ equipe)

`src/chat.js` + `src/routes/chat.js` (usuário, `/api/chat`) + seção "Mensagens" em `admin.js`
(`/api/admin/chat`); front em `public/js/chat.js` (botão "Mensagens" no topo do portal e a aba do
admin reaproveitam `renderMessage`/`composer`). Uma conversa por usuário de cliente
(`chatThreads`, `chatMessages` no store); qualquer admin responde. Sem WebSocket: o front
consulta a cada 10 s com a conversa aberta e a cada 60 s só o contador. Cada mensagem do usuário
guarda o contexto (relatório aberto e, no CCV, a fazenda — validada contra as dele; ou a
ferramenta, `{ tool: 'benchmark', clientId }`, lista `TOOL_CONTEXT` em `src/chat.js`). O botão
também está na página do Benchmarking (`initChat` com `note`/`welcome` próprios). Admin
"entrando como" só lê. Os Alertas CCV podem ser enviados pelo canal `portal`, que vira mensagem
nessa conversa.

## Faixa de cotações (rodapé do portal)

`src/quotes.js` + `public/js/ticker.js`, configurada na aba Cotações do admin (`db().quotes`).
Aparece no portal, no 4M e na 3P. O visual fica em `public/css/ticker.css` (independente do
`app.css`, porque o 4M tem tema próprio); cada página ajusta o próprio layout com `--ticker-h`
(`body.has-ticker`). Páginas que não são módulo ligam a faixa com `/js/ticker-boot.js`.
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

# Probeef Analytics — portal de BIs + ferramentas internas

(Antes chamado "BI Probeef". O nome que aparece na tela vem de `PORTAL_NAME`; chaves internas como
`bi-probeef:` no navegador e o `app: 'bi-probeef'` dos backups ficaram com o nome antigo de propósito.)

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
- **Verificação em duas etapas** (`src/mfa.js`, TOTP de aplicativo autenticador, sem biblioteca; o QR
  code sai do pacote `qrcode`): obrigatória para **administradores**. O login com senha certa deixa a
  sessão pendente (`session.mfa`, 10 min) e responde `{ mfa: 'setup' | 'verify' }`; na primeira vez o
  admin lê o QR code e recebe 8 códigos de recuperação (uso único, só o hash fica salvo). Só a sessão
  com a marca `m` vale para quem precisa da verificação (`loadUser`) — "entrar como", voltar e trocar
  a senha carregam a marca. Segredo criptografado com `secretBox`; código já usado não vale de novo.
  Celular perdido: Admin → Usuários → "Zerar duas etapas" (outro admin ou ele mesmo, com um código de
  recuperação) ou, sem nenhum acesso, `npm run create-admin` no Console do Railway (zera senha e
  verificação). `ADMIN_MFA=off` desliga só fora de produção (testes locais).
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

1. **Acesso por pedido/aprovação**, não liberado por padrão. **Só Time Cargill e Canais pedem** e veem
   todas as ferramentas no portal; o Cliente Cargill vê só as que o admin liberou e não pede
   (`canRequestTools` em `src/auth.js`, usado no `/request` de cada ferramenta e em `toolsSection`). Cada usuário tem um campo
   `confinamento: {status, requestedAt, decidedAt}` (ver `src/store.js` `normalize()`) — o nome
   do campo ficou específico do 4M porque foi o primeiro; uma segunda ferramenta provavelmente
   merece seu próprio campo (`u.nomeDaFerramenta`) ou generalizar para um objeto `u.tools[id]`
   se aparecer uma terceira. Administradores sempre têm acesso, sem pedir. Usuário pode não ter
   cliente nenhum ("Só ferramentas"): entra, vê só os cards das ferramentas (sem a lista de
   relatórios) e usa as que o admin liberou — no formulário de usuário, "Ferramentas liberadas"
   aprova direto. Cliente desativado só bloqueia o login de
   quem não tem nenhuma ferramenta liberada.
2. **Front-end estático** em `public/<nome>/`, com seu próprio `index.html`/`app.js`. Gate de
   acesso em `server.js` (`app.use('/<nome>', middleware-de-sessão, express.static(...))`) —
   só serve os arquivos pra quem está logado e aprovado.
3. **API dedicada** em `src/routes/<nome>.js`, montada em `/api/<nome>`, reaproveitando
   `requireAuth` e o `db()`/`save()` do store em vez de inventar armazenamento próprio.
4. **Métricas de uso**: ver `src/accessLog.js`, lista `TOOLS` no topo. Chame
   `recordToolAccess({userId, clientId, toolId})` e `startToolView(...)` quando a ferramenta
   abrir (rota `POST /api/<nome>/open`, ver `confinamento.js` como exemplo) — o resto
   (`/api/usage/beat`, `/api/usage/end`, sub-aba "Ferramentas" da aba Uso do admin) já é
   genérico e funciona sozinho a partir daí. A aba Uso tem duas sub-abas: "Relatórios (BI)", cujos
   números não contam eventos de ferramenta, e "Ferramentas" (`toolUsage` em `src/accessLog.js`:
   por ferramenta e por usuário, com acesso liberado, tempo e simulações salvas). Uma ferramenta
   nova entra em `TOOL_DATA` (onde ficam as simulações e o campo de acesso). O Benchmarking fica
   de fora dela: tem as métricas próprias na aba Benchmarking.

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

### 4M Fornecedores (resultado e risco por fornecedor)

Terceira ferramenta, mesmo padrão (campo `user.fornecedores`, rotas `/api/fornecedores`, página
`/fornecedores`, análises em `fornecedoresSimulations`). Importa no navegador (SheetJS) a planilha de
desempenho por fornecedor — uma aba por unidade, uma linha por fornecedor, média e "CV ..." de peso de
entrada, GMD, GDC, rendimento, @ produzidas, dias e CMS (kg MS/dia ou % PV; sem CMS usa um % do PV),
colunas achadas pelo nome (`parseSheet` em `public/fornecedores/model.js`). DP = média × CV.
- Econômico (`econ`): as contas do 4M nos quatro modelos e nos dois lados (confinamento/parceiro).
  **Conferido contra `calc.js` do 4M**: com as três diferenças desligadas, custo, receita, margem,
  rentabilidades e custo da @ batem nos 4 modelos. As diferenças (de propósito, explicadas na aba "Como
  funciona"): dieta de adaptação só nos dias de adaptação, ração perdida com os mortos = % do custo
  alimentar do fornecedor (no 4M é 455 fixo) e sem somar essa ração duas vezes no Boi Próprio.
- Risco (`simulate`, Monte Carlo com semente fixa): sorteia PE, GMD, RC, dias e CMS pelo CV de cada um;
  GDC e @ produzidas saem da conta (o CV simulado das @ é mostrado ao lado do da planilha para conferir);
  preços de compra e venda correlacionados; dieta e operacional à parte. Nível "cada animal" ou "média do
  lote" (CV ÷ √cabeças). Sensibilidade = correlação de cada fator sorteado com o resultado.
- O corpo da análise salva passa de 100 KB (planilha inteira): `server.js` usa um parser de 500 KB só em
  `/api/fornecedores/simulations`.

### Semi Confinamento (veio do Power Apps)

Quarta ferramenta, mesmo padrão (campo `user.semi`, rotas `/api/semi`, página `/semi`, simulações em
`semiSimulations`). Substitui o app "Semi Confinamento Probeef" do Power Apps (pacote exportado em
`Downloads\Seniconfinamento_*.zip`; o código das telas está nos `Src/*.pa.yaml` de dentro do `.msapp`).
As simulações gravavam numa lista do SharePoint, que não foi migrada (decisão do usuário, nov/2026).
Compara **três produtos** (formulações) lado a lado: formulação de 8 ingredientes, zootécnico (lotação UA/ha,
consumo 1/1,5/2% PV, desempenho sugerido pela qualidade do pasto), financeiro, resultados e duas grades de
risco 5×5 (compra × venda e milho × venda, lucro R$/ha). Cálculo em `public/semi/model.js`, com os
arredondamentos do app; conferido contra as fórmulas transcritas do app com os valores padrão (bate no
centavo). Erros do app que foram corrigidos estão na aba "Como funciona" (e marcados com "Corrigido" no
`model.js`). As telas "Custo Operacional" e "custo depreciação/manutenção" do app não tinham caminho de
entrada e ficaram de fora.
Relatório e Excel em `public/semi/report.js`, a partir das mesmas linhas das tabelas da tela: o relatório é um
bloco próprio (`#report`, A4, 4 páginas: resumo, premissas digitadas, resultados e risco), que também sai no
Ctrl+P (`beforeprint`); o Excel é do exceljs (Resumo, Premissas em amarelo, Resultados, Análise de risco e Cadastro).

### Benchmarking (coleta com validação)

Substitui a coleta pela planilha "Benchmarking Confinamento Probeef 2026 Feed Manager.xlsb"
(`Documentos\`). **Não é uma ferramenta**: tem seção própria no portal ("Benchmarking", acima de
Ferramentas) e não usa pedido de acesso. O nome não leva o ano: o **ciclo** é o `ano` das
configurações (Admin → Benchmarking → "Ciclo, limites e listas") e é o **ano dos dados** (o ciclo 2026
é coletado em 2027: no questionário, `{ano}` = ciclo e `{anoSeguinte}` = o ano das expectativas), com a chave **coleta aberta**
(`settings.aberta`; fechada = só o admin cadastra fazenda, altera ou envia — `assertAberta`).

**Equipes e acessos (só no Benchmarking, por enquanto; `src/bmkTeam.js`)**:
- Perfil `user.kind`: `cliente` (Cliente Cargill, a fazenda), `cargill` (Time Cargill) ou `canal`
  (Canais Cargill). Poderes, só do Time: `bmkGestor` (cria usuários de Canais e Cliente — **Time Cargill só o admin cria** — na aba
  **Equipe** do `/benchmark`), `bmkCreateTeam` (pode tornar alguém gestor) e `bmkValidator`.
- `user.reportsTo` aponta para um gestor; a equipe de alguém é todo mundo abaixo dele, em qualquer
  nível (`teamIds`; ciclo na árvore é recusado em `checkReportsTo`).
- **Incluir do Time Cargill** (aba Equipe, `includeMember`/`setMemberFarms`): o gestor não cria gente do Time, mas
  inclui quem o admin cadastrou e marca as fazendas da equipe que a pessoa pode mexer (`user.bmkFarms`, à parte do
  `clientIds` dos relatórios; entra em `participantClients`). A pessoa passa a participar da equipe
  (`bmkIncluidoEm`) **sem mudar o "responde a"**, que só o admin define; "Tirar da equipe" desfaz.
- Cada fazenda tem um responsável `client.bmkOwner` (Time ou Canais). Time e Canais veem as fazendas
  cujo responsável está no alcance deles (`ownerScope`: a própria pessoa e a equipe; **quem valida
  soma a equipe do gestor direto**), mais as vinculadas por `clientIds` (legado). Cliente vê só as
  dele (`clientIds`). Admin vê todas.
- Cadastrar fazenda: **todos** (admin, Time, Canais e Cliente; `canCreateFarm`). Responsável padrão: Time = quem
  cadastrou (ou alguém da equipe que ele escolher); Canais e Cliente = a pessoa do Time que criou o login
  dele (sem ela, o gestor do "responde a"), e a fazenda entra no `clientIds` de quem cadastrou. Trocar responsável: Time e admin (`canSetOwner`). O cliente cadastra pelo
  botão "+ Fazenda" no topo. Criar login: só gestor e admin — **Canais e Cliente nunca criam usuário**
  (o antigo "gestor da empresa", `isManager`/`/api/team`/"Minha equipe", foi removido). Quem entra no
  Benchmarking sem fazenda: admin, Time, Canais e "só Benchmarking" (`bmkMember`).
- Quem o gestor cria é **só Benchmarking** (`user.bmkOnly`): `userClients` devolve vazio, então não vê
  relatórios, CCV, visões nem ferramentas (pedido de 4M/3P é recusado), não recebe alertas de relatório/CCV
  e entra mesmo com a fazenda sendo cliente da plataforma. O admin marca/desmarca "Só Benchmarking".
  Quem foi criado pela aba Equipe antes disso é marcado no `normalize` pela auditoria (`bmk-team.create`).
- Gestor cria cliente só nas fazendas da equipe (ou sem fazenda: o login fica com quem o criou até
  ganhar uma); edita/desativa/troca senha de quem está abaixo dele
  e dos logins de cliente **só Benchmarking** cujas fazendas estão todas no alcance dele (`managedBy`). Quem
  também usa a plataforma só o admin desativa ou troca a senha.
- Aba **Clientes** do `/benchmark` (admin, Time e Canais): andamento das fazendas e o responsável
  (o Time troca entre as pessoas da equipe, `PUT /api/benchmark/clients/:id/owner`).
- Admin: perfil, "responde a" e poderes no cadastro do usuário; responsável no cadastro do cliente.
- **Gerência**: cadastro próprio (`db().gerencias`: nome + `gerenteId`, um gestor do Time, opcional; Admin → Usuários →
  "Gerências", rotas `/api/admin/gerencias`); o admin escolhe uma no cadastro de quem é do Time
  (`user.gerenciaId`; o texto livre antigo `user.gerencia` vira item do cadastro no `normalize`). Canais e Cliente herdam a de quem do Time os cadastrou (`createdBy`; sem ela, a do
  `reportsTo`) — `gerenciaOf` calcula na hora, então mudar a gerência reflete em todos. A gerência da
  fazenda é a do responsável: coluna e filtro no andamento do admin, coluna na aba Clientes.
- Usuários antigos sem perfil: Time Cargill se já validavam, senão Cliente Cargill (`normalize`).
- Teste das regras: script com 32 verificações (gestor, validador, Canais, cliente, coleta fechada) —
  se mexer em `bmkTeam.js`/`participantClients`, refaça algo equivalente contra o servidor local.

O admin marca `client.benchmark` (ou o Time cadastra a fazenda já participando). Página `/benchmark` (`public/benchmark/`), API `/api/benchmark`
(`src/routes/benchmark.js`), regras em `src/benchmark.js`; rotas só de admin em `admin.js`.

- `public/benchmark/fields.js` é a fonte única das regras — campos dos lotes (com a letra da
  coluna da planilha original, usada para colar e importar), validações (coerência com
  tolerância, faixas mín/máx e listas, as mesmas da aba Configurações; o bug da planilha em
  que a tolerância de carcaça apontava para `$C$7` da própria aba foi corrigido), questionário
  (as 90 perguntas da aba Formulário/Q1) e o resultado por categoria (abas FINAL e FINAL
  RECRIA). É importado pelo navegador e pelo servidor (Node importa de `public/`).
- Dados: `db().bmkSubmissions` (um por cliente por ano; `version` evita sobrescrever o trabalho
  de outra pessoa) e `db().bmkSettings` (limites e listas, editáveis no admin). Fluxo
  rascunho → enviado → correção/aprovado; devolver/aprovar avisa os logins de cliente pelo chat. Nas listas
  (andamento, cobrança, métricas), rascunho sem trabalho de ninguém aparece como "não iniciado" (`statusDe`):
  o questionário do ano passado trazido pelo admin não conta como início.
  **Validadores** (Time Cargill com `bmkValidator`) aprovam/devolvem/reabrem como o admin nas
  fazendas que enxergam (ver Equipes acima). A tela usa `view.access` ({edit, review}) vindo do
  servidor para mostrar os botões. "+ Cadastrar fazenda" (`POST /api/benchmark/clients`,
  `createClientFor`): nasce com `benchmark: true`, sem relatórios, `createdVia: 'benchmark'`,
  `createdBy` e `bmkOwner`. Nome repetido (sem acento/maiúsculas) é recusado.
- **Métricas do processo** (Admin → Benchmarking → Métricas do processo; projeto DMAIC):
  `src/benchmarkMetrics.js` junta o histórico do envio (`sub.messages`: enviado/devolver/aprovar,
  o envio guarda um `snapshot` da validação), as sessões de trabalho (`sub.metrics.sessions`,
  montadas a cada salvamento em `saveDraft`; 30 min sem salvar abre outra sessão), o retrato dos
  erros quando os primeiros lotes entram (`sub.metrics.primeiro`, base do Pareto) e o tempo com a
  página aberta por aba (`tool_time` do access-log; a página manda a aba no batimento e reabre a
  contagem ao trocar de cliente). `sub.metrics` não vai para a tela do cliente (`withoutMetrics`).
  Botão "Excel das métricas" exporta resumo, clientes, pessoas, Pareto, eventos e sessões. "Apagar
  tudo" (`POST /api/benchmark/:clientId/clear`, `clearDraft`) zera lotes e/ou questionário enquanto
  dá para editar, pede para digitar APAGAR e fica no histórico (ação `limpar`).
- Importar a planilha atual é feito no navegador com SheetJS (`/vendor/xlsx.full.min.js`,
  pacote oficial de cdn.sheetjs.com — a versão do npm é antiga): lê BD_Zootec_Feed,
  BD_Econom_Feed, BD_Zootec_Feed_ Recria_Conf e Q1.
- **Relatórios que saem do Feed Manager** ("Índices Zootécnicos" e "Listagem de Lotes Econômica", .xls; exemplos em
  `Downloads\Relatorio zootecnico .xls` e `Relatorio economico.xls`): mesmas colunas das abas BD_*, mas no zootécnico
  Raça (D:E) e Categoria (F:G) são mescladas (duas colunas vazias a mais, também ao copiar e colar) e depois dos lotes
  vem um "Resumo". `lerRelatorioFeed` em `fields.js` lê os dois (colar e importar; zootécnico ou econômico pelos
  dados, a coluna C) e é o leitor do "Colar do Excel" também para o modelo. Importar aceita vários arquivos de uma vez
  (os dois relatórios se juntam pelo lote); o relatório só é procurado nas abas que não são do modelo.
- Datas: `parseDate` em `fields.js` é o único leitor (colar, importar, TGC e o servidor via
  `cleanLote`). Aceita célula sem formato de data: número de série do Excel (inclusive como texto),
  dd/mm/aa(aa) com / - . ou espaço, AAAA-MM-DD, AAAAMMDD, mês por nome e hora no fim; dd/mm é o
  padrão e só vira mm/dd quando o segundo número passa de 12. Ao abrir, datas salvas em outro
  formato são convertidas e salvas.
- **Baixar modelo** (`public/benchmark/modelo.js`): Excel gerado no navegador com exceljs, com as
  **mesmas abas e colunas da planilha** (são as do relatório que sai do software): Feed Manager =
  BD_Zootec_Feed + BD_Econom_Feed + BD_Zootec_Feed_ Recria_Conf; TGC = BD_TGC_Conf +
  BD_TGC_Conf_Recria. Títulos na linha 3 e dados a partir da 4, então o importador lê como lê a
  planilha (as colunas de validação/cálculo da direita não entram). Mais uma aba "Questionário"
  (código + resposta, `lerQuestionario`) e a aba oculta "Listas" das listas suspensas. Se mudar
  uma coluna em `fields.js`, confira os títulos `FEED_ZOO`/`FEED_ECO`/`TGC` em `modelo.js`.
- **TGC** (clientes que não usam Feed Manager): o TGC exporta **um animal por linha** (abas
  BD_TGC_Conf / BD_TGC_Conf_Recria). `lotesFromTgc` em `fields.js` faz o que a tabela dinâmica da
  planilha fazia: agrupa por LOTE_SAIDA, conta os animais e tira a média de cada coluna (custos
  do lote = média por cabeça × animais; manejo = alimentar + fixo). Colunas achadas pelo nome
  (`tgcHeader`), não pela posição. Entra por "Importar planilha" (abas TGC da planilha ou a
  exportação pura), ou "Colar do Excel" com o cabeçalho. O TGC não traz tipo de entrada e escreve
  raça/categoria do jeito dele: depois da importação abre "Padronizar listas" e "Preencher em lote".
- **Cargill Feed Manager** (o programa novo, não o Feed Manager das abas BD_Zootec_Feed): exporta o
  "Relatório de fechamento individual", um animal por linha (cabeçalho na linha 4), **com os mortos**
  ("Causa da morte conf") e rendimento/IMS em fração. `lotesFromCfm` em `fields.js` agrupa por
  "LOTE Saída confinamento": animais = todas as linhas, mortes = linhas com causa de morte;
  zootécnico = média dos vendidos (carcaça, rendimento e @ produzida só de quem tem carcaça > 0 —
  vendas em leilão vêm sem carcaça); eficiência e conversão no lote (MS total ÷ @ ou kg ganhos);
  custos, receita e total de diárias somados (mortos inclusos; total de diárias = soma da "DIÁRIAS
  ALIMENTAR (TOTAL)" de todos os animais, igual no TGC); "Tipo de Cadastro = Compra" vira origem Compra
  Direta. Lotes só com mortos (o programa põe os mortos num lote de saída próprio) ficam de fora
  e a tela avisa. Conferido em out/2026 contra um relatório real (7.932 animais, 85 lotes). Entra
  pelas abas BD_CFM_Conf(_Recria) da planilha/modelo, pela exportação pura ou colando com o
  cabeçalho; `ANIMAL_SOURCES` em `app.js` reconhece TGC ou CFM pela coluna do lote. O
  "Padronizar listas" sugere os nomes desses programas (`SINONIMOS`).
- Período do lote (`periodoLote` em `fields.js`, também em `calcLote`): entrada = saída − dias no
  confinamento (Dias conf.; sem ele, Dias de trato); "Águas" quando mais de 70% desses dias caem
  em dezembro–maio, senão "Seca". Aparece na tabela (ao lado de Saída), no detalhe do lote, no
  Painel (filtro e comparação) e no Excel consolidado do admin.
- **Faixa de peso de entrada** (`FAIXAS_PESO` / `faixaPeso` em `fields.js`, também em `calcLote`): pelo peso de entrada
  e o sexo da categoria. Machos: Abaixo de 300, 301-330 … 451-480, Acima de 481; fêmeas: Abaixo de 240, 241-270 …
  361-390, Acima de 391 (cada número é o limite de cima da faixa, então todo peso cai numa). Coluna na tabela de lotes
  (selo azul = machos, rosa = fêmeas) e no detalhe do lote, filtro e "Comparar por" no Painel, coluna no Excel
  consolidado e filtro na Comparação do admin (`resultadosDoGrupo(..., filtro)`).
- Origem do lote é opcional (não existia por lote na planilha). "Preencher origem" (`originDialog`)
  aplica uma origem aos lotes sem origem, aos que a tabela mostra (filtro/busca) ou a todos; sugere
  a origem quando a pergunta 10 do questionário tem um só modelo de reposição (`Q10_ORIGEM`).
- **Critério de exclusão de dados** (`EXCLUSAO_PADRAO` / `separarExclusao` em `fields.js`, documento
  da equipe): lotes de enfermaria/refugo (pelo nome do lote ou do curral) e lotes com consumo de MS,
  dias de cocho, rendimento, @ produzidas ou GMD fora dos limites (por engorda/recria e sexo, que
  sai da categoria; limite incluído) **saem só do resultado** — tabelas por categoria, Painel e o
  resultado do Excel consolidado. A base do cliente não muda. Visão "Exclusões" no Resultado (o que
  saiu, por quê e os limites) e coluna "Resultado (critério de exclusão)" no consolidado. Limites
  em `settings.exclusao` (padrão do documento; ainda sem tela no admin).
- **Relatório do cliente** (botão "Relatório (PDF)" no Resultado, `abrirRelatorio` em `app.js`): página
  para imprimir/salvar em PDF (`@media print` com `body.print-report`) com resumo, resultado por
  categoria e lotes excluídos. **O cliente não vê dados de outros clientes.** Quando quem gera é o
  admin, entra "Comparação com o grupo" (clientes enviados e aprovados).
- **Comparação entre clientes — só admin** (Admin → Benchmarking → Comparação): `public/benchmark/comparacao.js`
  (resultado de cada cliente com o critério de exclusão, estatísticas, ranking e quartil; `SENTIDO`
  diz se maior ou menor é melhor). Dados de `/api/admin/benchmark/export`. Quartil só com 4+ clientes.
- **Questionário do ano passado** (só admin, botão na aba Questionário; `prefillQuestionario` em `src/benchmark.js`,
  `POST /api/benchmark/:clientId/prefill`): lê a planilha do ciclo anterior no navegador (`lerQuestionarioAnterior` em
  `public/benchmark/anterior.js`, usado pela página e pelo admin: aba Questionário do modelo, Q1 ou Formulário — a que
  tiver mais respostas; a de 2025 só tem a Formulário, mesmas 100 perguntas na ordem da Q1 entre títulos de seção) e
  preenche as perguntas em branco (ou todas). A planilha mostra 0 no lugar do vazio: 0 em texto/escolha, nos custos
  opcionais, em seção inteira zerada e nas energias 69a–e somando 0 vira em branco. A resposta escrita de outro jeito vira a
  alternativa (maiúscula, acento, ";" no fim, "NÃO", erros de digitação da planilha e do Forms; "5 ou mais" → 5). Guarda
  `sub.prefill` (o que veio), anota no Histórico, e a tela avisa o participante e marca "ano passado" nas respostas ainda iguais.
- **Importar participantes** (Admin → Benchmarking, botão no Andamento; `importarParticipantes` em `src/benchmark.js`,
  `POST /api/admin/benchmark/importar-participantes`, corpo até 3 MB): várias planilhas do ano passado de uma vez (as do
  Forms 2026, uma por fazenda, aba Q1). Cada uma vira participante só no Benchmarking (`createdVia: 'benchmark-import'`),
  ou acha a fazenda pelo nome e a põe no Benchmarking, com o questionário como "ano passado". Nome = pergunta 1; vazia
  ou repetida na lista, sai do nome do arquivo ("Benchmarking ... 2026 - <participante> - <programa> - <coord.> - <ger.>").
  Responsável opcional (sugerido quando o coordenador da pergunta 7 bate com alguém do Time/Canais). Ignora os "~$" do Excel.
- **Cobrança (lembretes)** (`src/bmkLembretes.js`): no Andamento do admin, quem não enviou (não iniciado, em
  preenchimento, em correção) recebe lembrete pelas Mensagens do portal — um ("Cobrar"), vários ou todos os pendentes,
  com o texto padrão da situação (`MODELOS`, com `{fazenda}`, `{ano}`, `{prazo}`, `{pendencias}`) ou um texto do
  admin; o responsável (Time/Canais) é avisado junto e, se a fazenda não tem login, só ele. Automático em "Ciclo,
  limites e listas" (`settings.lembretes`: dias antes do prazo; verificação de hora em hora, a partir das 8h, com
  prazo e coleta aberta; se o servidor ficou fora no dia, manda na volta uma vez só). Registro em
  `db().bmkLembretes` (coluna "lembrete" no Andamento) e no Histórico do participante. A janela também tem o modo "Pelo meu
  e-mail ou WhatsApp" (como nos Alertas CCV): `mailto:` (abre o Outlook com os logins, o responsável em cópia, o texto e o
  link) e `wa.me` com o texto pronto; o clique registra o lembrete com o canal (`POST /api/admin/benchmark/lembretes/registro`).
- Pergunta 24 (energia da recria) é obrigatória só com "Recria confinada na fazenda" na pergunta 10
  (`reqIf`, `isRequired`).
- Aba Resultado: "Painel" (`public/benchmark/dashboard.js`: filtros por raça, sexo, categoria,
  tipo de entrada e mês de saída; indicadores e comparação entre grupos, sempre médias
  ponderadas pelos animais) e "Tabelas por categoria" (as abas FINAL da planilha). Sexo sai da
  categoria (Macho de Engorda = machos; Fêmea de Engorda e Vaca de Descarte = fêmeas).
- As alternativas das perguntas de escolha são as da planilha oficial **`PLANILHA_BMK_Limpo.xlsb`** (Área de Trabalho),
  tiradas do VBA das janelas de digitação (listas de `Array(...)`, `AddItem`, `InitializeListBox`/`InitializeComboBox`; a
  linha da Q1 de cada lista sai de `ws.Cells(linhaInicial + k, 2)` no "Enviar"), em nov/2026. As perguntas (coluna A da Q1)
  são iguais às das 211 planilhas do Forms 2026. "Outro" virou texto livre (`other: true`); foram corrigidos três erros de
  digitação da planilha ("Getão", "Ágil de compra", "lotos").
- **Obrigatórias do questionário** = as que os formulários VBA da planilha exigem (cada seção tem um
  `ValidarFormulario`; o código foi lido do `vbaProject.bin` com `oletools`, sem abrir o Excel):
  84 de 100. Opcionais: 20, 29, 45–54 (custos e preços), 62b, 63b, 63c e 90. Regras que vieram
  junto: 41 e 42 com exatamente 5 e 7 indicadores (`min`=`max`), energias 69a–e somando 100%,
  energia líquida (23 e 24) de 0,8 a 2,2 e 66b só quando 65 = Sim. Pendências desse tipo entram em
  `faltando` com o motivo em `motivos` (`validateQuestionario`), então bloqueiam o envio.

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

## Pesquisa de satisfação (NPS)

`src/nps.js` + `public/js/nps.js` (cartão no canto da tela; visual em `public/css/nps.css`, carregado pelo
próprio `nps.js`, com cores de reserva para funcionar no tema do 4M). Pergunta "De 0 a 10, quanto o portal te
ajuda no dia a dia?" para quem já usa a plataforma: 3+ aberturas de relatório **ou ferramenta** (o Benchmarking
conta) em 2+ dias (`userActivity`), no máximo a cada 90 dias (30 depois de fechar sem responder). Nunca para
admin, "entrar como" ou quem ainda precisa trocar a senha. Aparece no portal, nas ferramentas e no Benchmarking
(`initNps()` em cada `app.js`; o 4M liga por `/js/nps-boot.js`). A resposta guarda `context` (onde: portal ou
o id da ferramenta, pelo endereço da página) e `publico` (Clientes, Time, Canais ou "só Benchmarking"). Admin →
Uso → sub-aba **Satisfação (NPS)**: NPS geral, por público e por lugar, e os comentários; nota 0–6 vira alerta.

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
Para lançar rápido: "Lançar o dia" (todos os preços numa janela, `POST /api/admin/quotes/day`) e
"Colar do CEPEA" por preço (a tabela copiada da página do indicador é lida no navegador,
`lerTabelaCotacao`, vários dias de uma vez, `POST /api/admin/quotes/:id/values`); cada preço tem o
link da página (`url`). Preço sem o valor do último dia útil (`staleManual`; feriado não entra na
conta) vira aviso na aba e alerta na central.

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
- **Backups** (`src/backup.js`): `exportData` leva **tudo** do store menos os caches (`CACHES`), então
  coleção nova entra sozinha. Uma cópia por dia no volume (14 dias) e, com as variáveis `BACKUP_S3_*` +
  `BACKUP_ENCRYPTION_KEY`, uma **cópia externa** (`src/offsiteBackup.js`): cadastros + `access-log.jsonl`,
  gzip + AES-256-GCM antes de sair, num armazenamento S3 (Cloudflare R2, Backblaze B2, AWS), assinatura
  SigV4 sem SDK (conferida contra o exemplo da documentação da AWS). Situação em `db().offsite`, no card
  de backups do admin ("Enviar cópia agora"). Quanto tempo as cópias ficam é regra de ciclo de vida do
  bucket. Abrir uma cópia: `BACKUP_ENCRYPTION_KEY=... npm run decrypt-backup -- arquivo.gz.enc` e
  restaurar o .json pelo admin. **A chave precisa estar guardada fora da Railway** (sem ela, as cópias
  não abrem).

# Probeef Analytics — portal de BIs (Power BI Embedded)

Portal para distribuir relatórios do Power BI para clientes. Cada cliente faz login e vê só os relatórios liberados para a empresa dele, opcionalmente filtrados por RLS (segurança em nível de linha).

O modelo é **"app owns data"**. O servidor se autentica no Power BI como um service principal do Azure e gera tokens de embed de curta duração. Os clientes não precisam de licença do Power BI, e o segredo do Azure nunca sai do servidor.

## Como funciona

```
Navegador do cliente ──login──▶ Servidor Node (este projeto) ──service principal──▶ API do Power BI
        ▲                              │ confere se o cliente pode ver o relatório
        └──── token de embed ◀─────────┘ gera token (com RLS, se configurado)
```

- **Administradores** acessam `/admin` para cadastrar relatórios, clientes e usuários.
- **Clientes** acessam `/portal` e veem só os relatórios da empresa deles.
- O token de embed é renovado automaticamente antes de expirar.

## 1. Configurar o Azure e o Power BI (uma vez)

1. **Registrar o aplicativo**: no [portal do Azure](https://portal.azure.com), vá em *Microsoft Entra ID → Registros de aplicativo → Novo registro*. Anote o **ID do aplicativo (cliente)** e o **ID do diretório (locatário)**.
2. **Criar o segredo**: no aplicativo, abra *Certificados e segredos → Novo segredo do cliente* e copie o **Valor**.
3. **Grupo de segurança**: crie um grupo no Entra ID e adicione o aplicativo como membro.
4. **Liberar no Power BI**: no [portal de administração do Power BI](https://app.powerbi.com/admin-portal/tenantSettings), em *Configurações do desenvolvedor*, habilite **"Entidades de serviço podem usar APIs do Fabric"** (o nome antigo é "Permitir que entidades de serviço usem APIs do Power BI") para o grupo do passo 3.
5. **Dar acesso ao workspace**: no workspace dos relatórios, clique em *Gerenciar acesso* e adicione o aplicativo como **Membro** ou **Administrador**.
6. **Capacidade**: atribua o workspace a uma capacidade **Fabric (SKU F)** ou **Power BI Embedded (SKU A)**. Sem capacidade, os tokens de embed funcionam só para testes, com limite de uso.

> O ID do workspace e o do relatório aparecem na URL do relatório:
> `app.powerbi.com/groups/{ID do workspace}/reports/{ID do relatório}`

### RLS (opcional, para relatórios com dados de vários clientes)

1. No Power BI Desktop, vá em *Modelagem → Gerenciar funções*, crie uma função (ex.: `Cliente`) com um filtro como `[CodigoCliente] = USERNAME()` e publique o relatório.
2. No portal, marque o relatório como **"Usa segurança por linha (RLS)"**.
3. Em cada cliente, preencha **Usuário RLS** (o valor que `USERNAME()` vai retornar, ex.: `acme`) e **Funções RLS** (ex.: `Cliente`).

Se um relatório com RLS for aberto por um cliente sem regra configurada, o portal bloqueia o acesso em vez de mostrar todos os dados.

## 2. Rodar localmente

Precisa do Node.js 22.9 ou superior.

```bash
npm install
cp .env.example .env        # no Windows: copy .env.example .env
# edite o .env com os IDs e o segredo do Azure
npm run create-admin -- seu@email.com "Seu Nome"
npm start
```

Abra http://localhost:3000, entre com o e-mail e a senha temporária mostrados no terminal e defina sua senha.

### Primeiros passos no painel

1. Em **Relatórios**, clique em *Importar do workspace* (ou *Novo relatório*).
2. Em **Clientes**, crie a empresa e marque os relatórios liberados para ela.
3. Em **Usuários**, crie o login de cada pessoa do cliente. A senha temporária aparece uma única vez. Envie-a ao usuário, que vai trocá-la no primeiro acesso.

## 3. Publicar

Qualquer serviço que rode Node.js serve. O caminho mais direto no ecossistema Microsoft é o **Azure App Service (Linux, Node 22)**:

1. Crie o App Service e publique esta pasta (pelo VS Code com a extensão *Azure App Service*, ou via GitHub Actions).
2. Em *Configurações → Variáveis de ambiente*, cadastre as mesmas variáveis do `.env`, com `NODE_ENV=production` e um `SESSION_SECRET` longo e aleatório.
3. Defina `DATA_FILE=/home/data/db.json` para os cadastros sobreviverem a novas publicações.
4. Comando de inicialização: `npm start`.
5. Rode o `create-admin` uma vez pelo console SSH do App Service.

Em produção o site precisa de HTTPS. O App Service já fornece HTTPS, e os cookies de sessão só são enviados por HTTPS quando `NODE_ENV=production`.

## Estrutura

| Caminho | O que faz |
| --- | --- |
| `server.js` | Servidor Express, segurança (CSP, cookies, CSRF) e rotas |
| `src/powerbi.js` | Autenticação no Azure e geração de tokens de embed |
| `src/auth.js` | Senhas (scrypt), sessão e limite de tentativas de login |
| `src/store.js` | Armazenamento em JSON (`data/db.json`) |
| `src/routes/` | APIs de login, portal e administração |
| `public/` | Telas de login, portal e administração |
| `scripts/create-admin.js` | Cria um administrador ou redefine a senha dele |

## Segurança

- Senhas guardadas com scrypt. Trocar a senha, desativar ou mudar o acesso de um usuário encerra as sessões abertas dele.
- Login limitado a 10 tentativas a cada 15 minutos por IP e e-mail.
- Cada pedido de token confere no servidor se o usuário pode ver aquele relatório. O navegador nunca recebe as credenciais do Azure, só um token de embed que vale para aquele relatório e expira em cerca de 1 hora.
- O arquivo `data/db.json` contém os hashes das senhas: não o coloque no Git (o `.gitignore` já exclui).

O armazenamento em JSON atende bem dezenas de clientes. Se o portal crescer muito, troque `src/store.js` por um banco de dados (Postgres, Azure SQL) mantendo as mesmas funções.

## Assistente no WhatsApp

O bot reconhece cada cliente pelo telefone cadastrado no usuário (Usuários → Editar → WhatsApp) e oferece:

1. **Relatório em PDF**: lista os relatórios do cliente e envia o PDF escolhido.
2. **Perguntas sobre os dados**: o Claude consulta o modelo do Power BI (só os relatórios do cliente, só leitura; relatórios com RLS ficam de fora) e responde em texto.
3. **Redefinir senha**: envia um link de uso único, válido por 30 minutos.
4. **Avisos**: botão "Avisar clientes" em Relatórios, e aviso automático quando o Power BI registra uma atualização. Só recebem os usuários com "Receber avisos" marcado.

Teste tudo pelo **simulador** na aba WhatsApp do admin, sem precisar da Meta.

### Ligar as perguntas com IA
Cada usuário cadastra a própria chave da Anthropic no portal (Conta → Meu assistente); ela fica
criptografada com `KEY_ENCRYPTION_SECRET`. O servidor não usa uma chave própria.

### Conectar o WhatsApp (API oficial da Meta)
1. Em https://developers.facebook.com, crie um app do tipo **Business** e adicione o produto **WhatsApp**.
2. Cadastre o **número do bot** (um número que não esteja em uso no aplicativo do WhatsApp).
3. Copie para as variáveis do servidor:
   - `WHATSAPP_PHONE_NUMBER_ID`: em WhatsApp → API Setup.
   - `WHATSAPP_TOKEN`: crie um usuário do sistema no Business Manager com token permanente e permissão `whatsapp_business_messaging`.
   - `WHATSAPP_APP_SECRET`: em Configurações do app → Básico → Chave secreta do app.
   - `WHATSAPP_VERIFY_TOKEN`: um texto qualquer que você inventa.
4. Em WhatsApp → Configuration → Webhook, informe:
   - URL: `https://SEU-PORTAL/webhooks/whatsapp`
   - Verify token: o mesmo de `WHATSAPP_VERIFY_TOKEN`
   - Assine o campo **messages**.
5. Para os avisos, crie um modelo de mensagem (categoria **Utilidade**) com duas variáveis, por exemplo:
   `Olá, {{1}}! O relatório {{2}} foi atualizado no Probeef Analytics.` Depois de aprovado, informe o nome em `WHATSAPP_TEMPLATE_UPDATE`.

A verificação da empresa no Meta Business costuma pedir documentos da empresa; sem ela, o número funciona com limite diário de conversas.

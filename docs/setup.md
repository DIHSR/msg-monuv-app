# Setup completo

Ordem recomendada: **Supabase → n8n → Meta App → Front (AWS) → Usuário demo**.

---

## 1. Supabase

> **Projeto compartilhado.** O Supabase do Monuv Mensagens é o mesmo de outros sistemas Monuv (mesmo `auth.users`, mesmo schema `public`). As migrations só criam e alteram objetos do Monuv Mensagens; **não mude configurações globais do projeto** (sign-up, Site URL, templates de e-mail) por causa deste app.

1. **Aplicar as migrations:** SQL Editor → cole os arquivos de `supabase/migrations/` **em ordem**, um por vez → Run:
   `…0001_schema.sql` → `…0002_security_fixes.sql` → `…0003_campaign_queue.sql` → `…0004_coexistence.sql` → `…0005_shared_project.sql`.
   - Se a `0001` já foi aplicada (as tabelas `wa_accounts`, `templates` etc. existem), **comece pela `0002`**.
   - **Não use `supabase db push`** neste projeto: o histórico de migrations é compartilhado com os outros sistemas.
2. **Quem acessa o Monuv Mensagens:** ter login no projeto **não** dá acesso. Só tem acesso quem tem perfil em `public.profiles`:
   - usuário que já existe (de outro sistema): `select public.grant_msg_access('pessoa@monuv.com.br');` (trial de 14 dias) ou `…, 'active')` (sem prazo);
   - usuário novo só do Monuv Mensagens: crie pela Admin API com `app_metadata: { "monuv_msg": true }`. O trigger cria o perfil em trial;
   - demo do revisor: `supabase/scripts/create-demo-user.mjs` (já marca `monuv_msg` e cria o perfil `permanent`).
   - Usuários de outros sistemas sem perfil veem "Este login não tem acesso ao Monuv Mensagens".
3. **Authentication → Sign In / Providers:** **não precisa mexer.** O "Allow new users to sign up" vale para todos os sistemas do projeto; mesmo ligado, quem se cadastra sozinho não ganha perfil no Monuv Mensagens.
4. **Authentication → URL Configuration:** **não altere o Site URL** (é o dos outros sistemas). Só **adicione** `https://msg.monuv.com.br/**` e `http://localhost:5173/**` em *Redirect URLs*.
5. **Vault:** já vem habilitado nos projetos Supabase. A migration usa `vault.create_secret`.
6. **Plano Free:** o projeto **pausa após cerca de 7 dias sem atividade** (os outros sistemas e a fila de campanhas, que consulta o banco a cada minuto, o mantêm ativo). Os **500 MB** do Free são divididos com os outros sistemas: leve isso em conta antes de ligar `MONUV_COEX_SYNC`. **Antes de submeter ao App Review o recomendado é migrar para o Pro.**

### Chaves

| Chave | Onde usar |
|---|---|
| `anon` | front (`VITE_SUPABASE_ANON_KEY`) e monitor do n8n |
| `service_role` | **somente** no n8n (`MONUV_SUPABASE_SERVICE_ROLE_KEY`) |

---

## 2. n8n (self-hosted)

1. **Variáveis de ambiente:** adicione as de `n8n/.env.example` ao ambiente do n8n e **reinicie**.
   - `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` permite que os Code nodes leiam `$env.MONUV_*`.
   - `NODE_FUNCTION_ALLOW_BUILTIN=crypto` é necessário para o HMAC do webhook e para gerar o PIN de registro.
   - `MONUV_COEX_SYNC` (padrão `false`): com `true`, ao conectar um número em coexistência o n8n pede à Meta os **contatos e até 180 dias de histórico** do app. O histórico é gravado em `messages`. Essa chamada só pode ser feita **uma vez, até 24 h após a conexão**; depois disso, só desconectando e conectando de novo. Avalie o espaço do Supabase (Free = 500 MB) e a LGPD antes de ligar.
   - Com task runners externos (n8n 2.x, `n8n-runners`), as variáveis `NODE_FUNCTION_ALLOW_*` vão no container do **runner**.
2. **CORS:** por padrão o workflow aceita só `https://msg.monuv.com.br`. Para um n8n de desenvolvimento, gere com origens extras:
   ```bash
   MONUV_ALLOWED_ORIGINS="https://msg.monuv.com.br,http://localhost:5173" node n8n/build.mjs
   ```
   Não importe no n8n de produção um workflow gerado com `localhost`.
3. **Importar:** um único arquivo, `n8n/workflows/monuv.json` → n8n *Import from File* → **ative** o workflow.
4. **Estrutura do workflow `Monuv`** (3 faixas, cada uma com uma nota explicativa no canvas):

   | Faixa | Gatilho | URL / frequência |
   |---|---|---|
   | API do front | Webhook POST | `/webhook/monuv/api` com `{ action, ... }` |
   | Webhook da Meta | Webhook GET + POST | `/webhook/monuv/meta-webhook` |
   | Agendador | Schedule | campanhas: a cada 1 min · monitor do demo: a cada 12 h |

   Ações da API (`action`): `es.exchange`, `connection.refresh`, `templates.sync`, `templates.create`, `messages.send`, `campaigns.start`.
   O **Roteador** autentica o JWT uma vez e o Switch **Ação** encaminha ao handler. Campanhas entram numa fila no banco e são enviadas pelo agendador em lotes.

   No front: `VITE_N8N_BASE_URL=https://n8n.seudominio.com.br/webhook/monuv`.

5. **Error Workflow:** em *Settings* do workflow `Monuv`, aponte um Error Workflow que te notifique (e-mail, Telegram etc.). Se o monitor do demo ou a fila de campanhas falharem, você fica sabendo antes do revisor.

> **Editar código:** altere `n8n/src/**.js`, rode `node n8n/build.mjs` e reimporte o `monuv.json` (substituindo o workflow existente). Não edite direto no n8n, ou o repositório perde a fonte da verdade.

---

## 3. Meta App (developers.facebook.com)

1. **App do tipo Business** com o produto **WhatsApp** adicionado. É preciso ser **Tech Provider** (Business verificado).
2. **WhatsApp → Configuration → Webhook:**
   - Callback URL: `https://n8n.seudominio.com.br/webhook/monuv/meta-webhook`
   - Verify token: o mesmo valor de `MONUV_META_VERIFY_TOKEN`
   - Assine os campos: `messages`, `message_template_status_update`, `message_template_quality_update`, `account_update`, `phone_number_quality_update`.
   - **Coexistência** (número que continua no app WhatsApp Business): assine também `smb_message_echoes` (mensagens enviadas pelo celular), `history` e `smb_app_state_sync`.
3. **Facebook Login for Business → Configurations:** crie uma configuração do tipo **WhatsApp Embedded Signup**, com as permissões `whatsapp_business_management` e `whatsapp_business_messaging`. O **Configuration ID** vai em `VITE_FB_ES_CONFIG_ID`.
   - O front abre o Embedded Signup **v5** (`extras.version: 'v5'`). No v5 a **coexistência vem ligada por padrão**: quem já usa o app WhatsApp Business escaneia um QR code e continua usando o celular; quem não usa segue o fluxo de número novo (SMS). Os v2/v3 foram descontinuados pela Meta em 15/10/2026.
   - Requisitos da Meta para coexistência: app WhatsApp Business **2.24.17+**, app como **Tech Provider/Solution Partner**, webhook ativo. O número em coexistência fica limitado a **20 mensagens/s**, e grupos, ligações, mensagens temporárias e de visualização única não passam pela API.
4. **Facebook Login for Business → Settings:**
   - Allowed Domains for the JavaScript SDK: `https://msg.monuv.com.br` (e `https://localhost:5173` se testar local com HTTPS).
   - Login with the JavaScript SDK: **Sim**.
5. **App Settings → Basic:**
   - App Domains: `msg.monuv.com.br`
   - Privacy Policy URL: `https://msg.monuv.com.br/privacidade`
   - Terms of Service URL: `https://msg.monuv.com.br/termos`
   - User data deletion → *Data deletion instructions URL*: `https://msg.monuv.com.br/exclusao-de-dados`
6. **Graph API version:** use a mais recente disponível no App Dashboard, a mesma em `MONUV_GRAPH_VERSION` e `VITE_GRAPH_VERSION`.

> O Embedded Signup **exige HTTPS**. Para testar localmente, rode o Vite com HTTPS ou teste direto no domínio publicado.

---

## 4. Front na AWS (Amplify Hosting)

1. **Novo app:** AWS Amplify → *Host web app* → GitHub → repositório `DIHSR/msg-monuv-app`, branch `main`.
2. **Build:** o Amplify detecta o `amplify.yml` da raiz (monorepo com `appRoot: web`).
3. **Environment variables:** as de `web/.env.example`.
4. **Rewrites and redirects** (obrigatório para a SPA):

   | Source | Target | Type |
   |---|---|---|
   | `</^[^.]+$\|\.(?!(css\|gif\|ico\|jpg\|js\|png\|txt\|svg\|woff\|woff2\|ttf\|map\|json\|webp)$)([^.]+$)/>` | `/index.html` | 200 (Rewrite) |

5. **Headers de segurança:** o `customHttp.yml` da raiz (HSTS, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`) é aplicado pelo Amplify automaticamente.
6. **Custom domain:** `msg.monuv.com.br`. O Amplify emite o certificado. Se o DNS de `monuv.com.br` não estiver no Route 53, crie o CNAME indicado.

**Alternativa: S3 + CloudFront.** Bucket privado com OAC, `npm run build` e `aws s3 sync web/dist s3://BUCKET --delete`. No CloudFront, configure *Error pages* 403 e 404 para `/index.html` com código 200, e faça uma invalidação a cada deploy.

---

## 5. Usuário demo (revisor da Meta)

```bash
SUPABASE_URL=https://SEU-PROJETO.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
DEMO_EMAIL=revisor@monuv.com.br \
DEMO_PASSWORD='senha-forte' \
node supabase/scripts/create-demo-user.mjs
```

- O profile fica com `is_demo=true`, `plan='permanent'`, `trial_ends_at=null` e `daily_send_limit=50`.
- **Senha, e-mail e exclusão ficam bloqueados por trigger.** Para alterar conscientemente:
  ```sql
  begin; set local app.allow_demo_change = 'on';
  update auth.users set ... where email = 'revisor@monuv.com.br';
  commit;
  ```
- **Conecte o número:** entre com o usuário demo e faça o Embedded Signup com a WABA de demonstração da Monuv. Deixe pelo menos 1 template **aprovado**.
- **Monitor:** coloque `MONUV_DEMO_EMAIL` e `MONUV_DEMO_PASSWORD` no n8n para o monitor testar o login a cada 12h.
- **Token da Meta:** o token gerado pelo Embedded Signup (business integration system user) **não expira**. Se a conexão for removida na Meta, o webhook `account_update / PARTNER_REMOVED` marca a conta como desconectada e o monitor acusa.

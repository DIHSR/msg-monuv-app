# Setup completo

Ordem recomendada: **Supabase → n8n → Meta App → Front (AWS) → Usuário demo**.

---

## 1. Supabase

1. **Aplicar a migration:** SQL Editor → cole os arquivos de `supabase/migrations/` em ordem (`…0001_schema.sql`, depois `…0002_security_fixes.sql`) → Run. Se preferir a CLI: `npx supabase link` seguido de `npx supabase db push`.
2. **Authentication → Sign In / Providers:**
   - Email: habilitado.
   - **Allow new users to sign up: DESLIGADO.** O sistema é por convite, e assim o revisor nunca cai num fluxo de trial.
   - Confirm email: tanto faz. O usuário demo é criado já confirmado.
3. **Authentication → URL Configuration:** Site URL `https://msg.monuv.com.br`. Inclua também `http://localhost:5173` nas Redirect URLs.
4. **Vault:** já vem habilitado nos projetos Supabase. A migration usa `vault.create_secret`.
5. **Plano Free:** o projeto **pausa após cerca de 7 dias sem atividade**. A fila de campanhas do workflow `Monuv` consulta o banco a cada minuto (o que mantém o projeto ativo), mas **antes de submeter ao App Review o recomendado é migrar para o Pro**. A Meta pode levar semanas para revisar, e o revisor precisa de acesso por 1 ano.

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
3. **Facebook Login for Business → Configurations:** crie uma configuração do tipo **WhatsApp Embedded Signup**, com as permissões `whatsapp_business_management` e `whatsapp_business_messaging`. O **Configuration ID** vai em `VITE_FB_ES_CONFIG_ID`.
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

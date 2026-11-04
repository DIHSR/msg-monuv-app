# Próximos passos — checklist de implantação

Lista do que falta para colocar o Monuv Mensagens no ar e submeter ao App Review da Meta.
Marque `[x]` ao concluir. O detalhe de cada passo está em [`setup.md`](setup.md).

> Fazer **um passo por vez**, na ordem. Nenhum segredo (senhas, chaves, tokens) vai neste arquivo.

## Concluído

- [x] Migrations `0001` → `0005` aplicadas no Supabase (verificado em 2026-11-04: tudo `true`, 0 perfis).

## Supabase

- [ ] **1. Criar o usuário demo do revisor.** Ver `setup.md` §5.
  - Rodar `node supabase/scripts/create-demo-user.mjs` com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DEMO_EMAIL` e `DEMO_PASSWORD`.
  - Usar um e-mail **novo**, que não seja de nenhum usuário existente dos outros sistemas.
  - Esperar `✔ Login de teste OK` e guardar a senha num cofre de senhas.
- [ ] **2. Liberar a equipe interna.** Rodar `select public.grant_msg_access('pessoa@monuv.com.br');` para cada pessoa.

## Meta App (developers.facebook.com)

- [ ] **3. Anotar os valores do app:**
  - App ID e App Secret (App Settings → Basic);
  - Configuration ID do Embedded Signup (Facebook Login for Business → Configurations; ver `setup.md` §3.3);
  - um verify token aleatório e longo.

## n8n

- [ ] **4. Variáveis de ambiente.** Copiar as de `n8n/.env.example` para o ambiente do n8n e **reiniciar** o n8n.
  - Supabase: `service_role` e `anon`.
  - Meta: os valores do passo 3.
  - `MONUV_COEX_SYNC=false`.
  - `MONUV_DEMO_EMAIL` e `MONUV_DEMO_PASSWORD`.
- [ ] **5. Importar e ativar** o workflow `n8n/workflows/monuv.json`.
- [ ] **6. Error Workflow.** Em Settings do workflow `Monuv`, apontar um workflow de erro que notifique.
- [ ] **7. Testar o webhook publicado.** Rodar `./n8n/test/send-signed-webhook.sh https://SEU-N8N/webhook/monuv/meta-webhook`.

## Meta App: webhook e login

- [ ] **8. WhatsApp → Configuration → Webhook.**
  - Callback URL: `https://SEU-N8N/webhook/monuv/meta-webhook`; verify token do passo 3.
  - Clicar em "Verificar e salvar".
- [ ] **9. Assinar os campos do webhook:**
  - `messages`, `message_template_status_update`, `message_template_quality_update`, `account_update`, `phone_number_quality_update`;
  - de coexistência: `smb_message_echoes`, `history`, `smb_app_state_sync`.
- [ ] **10. Facebook Login for Business → Settings.** Em Allowed Domains, colocar `https://msg.monuv.com.br`; ligar Login with JavaScript SDK.
- [ ] **11. App Settings → Basic.** Preencher App Domains e as URLs de privacidade, termos e exclusão de dados (ver `setup.md` §3.5).

## Supabase: URLs

- [ ] **12. Authentication → URL Configuration.**
  - **Adicionar** `https://msg.monuv.com.br/**` e `http://localhost:5173/**` em Redirect URLs.
  - **Não alterar** o Site URL, que é dos outros sistemas.

## Front (AWS Amplify)

- [ ] **13. Preencher os dados da empresa** em `web/src/config.ts` (placeholders `[CNPJ]` etc., usados nas páginas legais) e fazer commit.
- [ ] **14. Criar o app no Amplify** a partir do repositório `DIHSR/msg-monuv-app`, branch `main`. Preencher as variáveis de `web/.env.example`; `VITE_N8N_BASE_URL` é `https://SEU-N8N/webhook/monuv`.
- [ ] **15. Configurar o rewrite da SPA** (tabela em `setup.md` §4.4).
- [ ] **16. Configurar o domínio** `msg.monuv.com.br` e o DNS.

## Teste de ponta a ponta (com o demo)

- [ ] **17. Conectar o número de demonstração.** Entrar como demo e fazer o Embedded Signup; conferir que a opção de coexistência aparece.
- [ ] **18. Criar um template** e esperar a aprovação. Deixar pelo menos 1 aprovado.
- [ ] **19. Fazer um envio individual.** Conferir o painel JSON (payload × resposta) e os status chegando (enviada → entregue → lida).
- [ ] **20. Conferir o monitor do demo** nas execuções do n8n (roda a cada 12 h).

## App Review

- [ ] **21. Migrar o Supabase para o Pro** (recomendado: a revisão leva semanas e o projeto é compartilhado).
- [ ] **22. Submeter o App Review** com as permissões `whatsapp_business_management` e `whatsapp_business_messaging`, as credenciais do demo e o roteiro de `revisor.md`. Não mencionar a API não oficial.

## Decisões pendentes

- [ ] **Demo:** bloquear o Embedded Signup e a criação de templates para a conta demo?
- [ ] **`MONUV_COEX_SYNC`:** puxar contatos e histórico do app ao conectar?
  - Hoje está `false`.
  - Só pode ser feito até 24 h depois de cada conexão.
  - Pesa no espaço do Supabase e na LGPD.
- [ ] **Revisão de código `ub-mode`:** autorizar a instalação das ferramentas `crapper`, `dryer` e `mutator`?
- [ ] **Segunda auditoria de segurança:** cobrir as 5 áreas que ficaram fora da primeira (ver `security.md`).

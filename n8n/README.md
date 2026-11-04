# n8n — back-end do Monuv Mensagens

Tudo roda num **único workflow**, `Monuv` (`workflows/monuv.json`), gerado a partir de `src/`:

```bash
MONUV_ALLOWED_ORIGINS="https://msg.monuv.com.br" node n8n/build.mjs   # padrão: só produção
node --test n8n/test/*.test.mjs
```

```
src/
  _lib.js                 helpers comuns, prefixados em todo Code node (Supabase, Graph, auth, erros, envio)
  api/router.js           autentica o JWT uma vez e escolhe a saída do Switch pela `action`
  api/<ação>.js           um handler por ação (recebe { user, body } já autenticado)
  meta/verify-get.js      handshake GET da Meta (verify token em tempo constante)
  meta/verify-signature.js HMAC X-Hub-Signature-256 sobre o corpo bruto
  meta/process.js         eventos: status, mensagens recebidas, templates, PARTNER_REMOVED
  scheduler/campaigns-worker.js  fila de campanhas (1 min, lotes com SKIP LOCKED)
  scheduler/demo-monitor.js      login do demo do revisor (12 h)
```

## Faixas do workflow

```
API        Webhook POST monuv/api → Roteador → Switch "Ação" ─┬→ es.exchange ──────┐
                                                             ├→ connection.refresh│
                                                             ├→ templates.sync    ├→ Responder API
                                                             ├→ templates.create  │
                                                             ├→ messages.send     │
                                                             ├→ campaigns.start ──┘
                                                             └→ (erro de auth/ação) → Responder API
Meta       Webhook GET  → Verificar token → Responder challenge
           Webhook POST (raw body) → Validar assinatura → Responder 200/401 → Processar eventos
Agendador  A cada minuto → Fila de campanhas
           A cada 12h   → Monitor do demo
```

**Nova ação da API:**
1. crie `src/api/<nome>.js`;
2. adicione uma linha em `API_ACTIONS` no `build.mjs`. O Roteador e o Switch são gerados a partir dessa tabela.
3. adicione a ação ao tipo `N8nAction` em `web/src/lib/api.ts`.

**Respostas da API:**
- sempre `{ ok, request, response, http_status, data?, error? }`. `request` e `response` alimentam o painel JSON do front;
- o token da Meta nunca volta: ele vai no header `Authorization`;
- erros internos voltam genéricos, com `error.ref` igual ao id da execução. O detalhe fica em `public.app_errors`.

**Campanhas:**
1. `campaigns.start` só move `draft → queued`;
2. a faixa Agendador reserva lotes no banco (`claim_campaign_batch`, com `FOR UPDATE SKIP LOCKED`), envia e marca cada destinatário.

Execuções sobrepostas não duplicam envios. Se uma execução cai no meio, os destinatários que ficaram em `sending` há mais de 10 minutos voltam para a fila. O agendador alterna entre campanhas de tenants diferentes.

**Webhook da Meta:**
- assinatura `HMAC-SHA256(corpo bruto, APP_SECRET)`, comparada com `timingSafeEqual`;
- o 200 sai antes do processamento;
- POST com assinatura inválida grava só tamanho e SHA-256;
- o evento só é atribuído à conta cuja WABA bate com o envelope assinado.

**Coexistência** (número que continua no app WhatsApp Business):
- o front abre o Embedded Signup v5, em que a coexistência vem ligada por padrão;
- `es.exchange` lê `is_on_biz_app` do número na Graph API (a dica do navegador só vale se a Graph falhar). Em coexistência o número **não** é registrado, porque já está;
- com `MONUV_COEX_SYNC=true`, depois do vínculo, pede contatos e histórico (`POST /{phone}/smb_app_data`), uma única vez;
- webhook: `smb_message_echoes` e `history` viram linhas em `messages`. `smb_app_state_sync` (contatos) não é persistido. `account_update` `PARTNER_REMOVED`/`ACCOUNT_OFFBOARDED` desconecta a conta;
- `webhook_events` guarda só um resumo dos lotes de histórico e contatos, sem o conteúdo.

Para testar o webhook publicado:

```bash
APP_SECRET=... VERIFY_TOKEN=... ./n8n/test/send-signed-webhook.sh https://n8n.seudominio.com.br/webhook/monuv/meta-webhook
```

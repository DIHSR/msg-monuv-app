# n8n — back-end do Monuv Mensagens

`src/*.js` contém o código de cada Code node. `build.mjs` junta `src/_lib.js` (helpers de Supabase, Graph API, autenticação e erros) a cada arquivo e gera `workflows/*.json` para importar.

```bash
MONUV_ALLOWED_ORIGINS="https://msg.monuv.com.br,http://localhost:5173" node n8n/build.mjs
node n8n/test/run-code-node.test.mjs
```

## Padrão de cada endpoint

```
Webhook (POST, responseMode = responseNode, CORS restrito)
  → Code "Processar"   valida JWT do Supabase → n8n_user_context (token via Vault) → Graph API → grava
  → Respond to Webhook { status, body }
```

- **Respostas:** sempre `{ ok, request, response, http_status, data?, error? }`. `request` e `response` alimentam o painel JSON do front. O token **nunca** volta na resposta: ele vai no header `Authorization`, não na URL.
- **Execuções:** as bem-sucedidas não são salvas (`saveDataSuccessExecution: none`), para não guardar dados pessoais no n8n. As com erro ficam salvas.

## Webhook da Meta

```
GET  → Verificar token → Responder challenge (texto)
POST (Raw Body) → Validar assinatura → Responder 200/401 → Processar eventos
```

- **Assinatura:** `HMAC-SHA256(corpo bruto, APP_SECRET)` comparado com `X-Hub-Signature-256` via `crypto.timingSafeEqual`.
- **Resposta rápida:** a resposta sai **antes** do processamento, porque a Meta reenvia se não receber 200 rápido.
- **Status fora de ordem:** são tratados no banco (`apply_message_status`). Um `read` não volta para `delivered`, e eventos duplicados são ignorados.
- **Corrida:** se o status chegar antes do n8n gravar o `wamid`, o evento fica guardado e `attach_message_events` o liga à mensagem depois.

Para testar o webhook publicado:

```bash
APP_SECRET=... VERIFY_TOKEN=... ./n8n/test/send-signed-webhook.sh https://n8n.seudominio.com.br/webhook/monuv/meta-webhook
```

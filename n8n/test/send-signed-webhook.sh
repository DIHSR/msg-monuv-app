#!/usr/bin/env bash
# Testa o webhook REAL no n8n com assinatura válida e inválida.
# Uso:
#   APP_SECRET=xxx ./n8n/test/send-signed-webhook.sh https://n8n.seudominio.com.br/webhook/monuv/meta-webhook
# Esperado: válido → 200 EVENT_RECEIVED | inválido → 401
set -euo pipefail
URL="${1:?informe a URL do webhook}"
: "${APP_SECRET:?defina APP_SECRET}"

BODY='{"object":"whatsapp_business_account","entry":[{"id":"0","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"0","phone_number_id":"0"},"statuses":[{"id":"wamid.TESTE","status":"delivered","timestamp":"1700000000","recipient_id":"0"}],"teste":"Olá"}}]}]}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$APP_SECRET" | sed 's/^.*= //')"

echo "→ assinatura válida"
curl -sS -o /dev/stderr -w "HTTP %{http_code}\n" -X POST "$URL" \
  -H 'Content-Type: application/json' -H "X-Hub-Signature-256: $SIG" --data-binary "$BODY"

echo "→ assinatura inválida"
curl -sS -o /dev/stderr -w "HTTP %{http_code}\n" -X POST "$URL" \
  -H 'Content-Type: application/json' -H "X-Hub-Signature-256: sha256=deadbeef" --data-binary "$BODY"

echo "→ verificação GET (use o MONUV_META_VERIFY_TOKEN em VERIFY_TOKEN)"
curl -sS -w "\nHTTP %{http_code}\n" "$URL?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN:-errado}&hub.challenge=12345"

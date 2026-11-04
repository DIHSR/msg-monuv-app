# Instruções para o revisor da Meta (modelo)

> ⚠️ **Não coloque a senha real neste arquivo.** O repositório é versionado. Preencha só no formulário do App Review.

**Texto sugerido para o campo "Instructions for reviewer" (em inglês):**

```
App URL: https://msg.monuv.com.br/login

Test credentials (permanent demo account, valid for at least 12 months):
  Email:    revisor@monuv.com.br
  Password: <PASSWORD>

The demo account is already connected to a WhatsApp Business Account through
Embedded Signup and has approved message templates.

How to test whatsapp_business_management:
  1. Log in and open "Conexão" (Connection): connected phone number, WABA ID and
     webhook subscription status. "Conectar com o Facebook" starts Embedded Signup.
  2. Open "Templates": list of message templates with their review status.
     Click "Sincronizar com a Meta" to fetch them from the Graph API.
  3. Click "Novo template" to create a template. The panel at the bottom shows
     the exact payload sent to POST /{waba-id}/message_templates and Meta's response.

How to test whatsapp_business_messaging:
  1. Open "Enviar mensagem" (Send message), enter a phone number with country
     code, pick an approved template and click "Enviar mensagem".
  2. The panel shows the payload sent to POST /{phone-number-id}/messages side by
     side with Meta's response (message ID).
  3. Delivery/read statuses received via webhook appear in real time below.

The demo account has a limit of 50 messages per day.
```

# Monuv Mensagens

Painel para empresas conectarem o próprio número ao **WhatsApp Business Platform (Cloud API)**, gerenciarem templates e enviarem mensagens. Foi construído para passar no **App Review da Meta** como Tech Provider.

```
┌──────────────────────┐  supabase-js (login + leitura com RLS + Realtime)  ┌──────────────────┐
│  web/  React + Vite  │ ─────────────────────────────────────────────────▶ │ Supabase         │
│  (AWS Amplify)       │                                                    │ Auth + Postgres  │
│                      │ ── fetch + JWT ──▶ ┌──────────────────────┐        │ + Vault          │
└──────────────────────┘                    │ n8n (self-hosted)    │──────▶ (service_role)     │
                                            │ n8n/workflows/*.json │        └──────────────────┘
          Meta Webhooks (assinados) ──────▶ │                      │──────▶ Graph API (WhatsApp)
                                            └──────────────────────┘
```

- O **front nunca fala com a Meta** e nunca vê tokens. Ele lê o Supabase (RLS por usuário) e chama o n8n com o JWT do Supabase.
- O **n8n é o back-end**: valida o JWT, busca o token da Meta no **Supabase Vault**, chama a Graph API e grava os resultados.
- O **webhook da Meta** valida o `X-Hub-Signature-256` sobre o corpo bruto antes de processar qualquer evento.
- O **Realtime** atualiza status de mensagens e de templates ao vivo na tela.

## Estrutura

| Pasta | O que tem |
|---|---|
| `web/` | SPA React 19 + Vite + Tailwind 4 + TanStack Query |
| `supabase/migrations/` | Schema, RLS, triggers, funções do n8n e Realtime |
| `supabase/scripts/create-demo-user.mjs` | Cria o usuário demo permanente do revisor |
| `n8n/src/` | Código dos Code nodes (fonte da verdade) |
| `n8n/workflows/` | Workflows importáveis, **gerados** por `node n8n/build.mjs` |
| `n8n/test/` | Testes do código dos nodes + script de teste do webhook real |
| `docs/` | Setup, roteiro dos vídeos e instruções ao revisor |

## Telas

| Rota | Tela | Nos vídeos? |
|---|---|---|
| `/login` | Login por e-mail e senha | ✅ |
| `/conexao` | Embedded Signup e status do número | ✅ |
| `/templates`, `/templates/novo` | Listar com status e criar (com painel JSON) | ✅ |
| `/enviar` | Envio individual, painel **payload × resposta da Meta** e timeline de status | ✅ |
| `/lote` | Envio em lote via CSV (oculto para o usuário demo) | ❌ |
| `/privacidade`, `/termos`, `/exclusao-de-dados` | Páginas públicas exigidas pela Meta | — |

## Começando

```bash
cd web && cp .env.example .env.local   # preencha
npm install && npm run dev             # http://localhost:5173
```

O passo a passo completo (Supabase, n8n, Meta App e AWS) está em **[docs/setup.md](docs/setup.md)**.

## Testes

```bash
node n8n/build.mjs                    # gera os workflows (checa a sintaxe de cada Code node)
node n8n/test/run-code-node.test.mjs  # assinatura do webhook, payload de envio, limites
cd web && npm run lint && npm run build
```

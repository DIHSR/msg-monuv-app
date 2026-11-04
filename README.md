# Monuv Mensagens

Painel para empresas conectarem o próprio número ao **WhatsApp Business Platform (Cloud API)**, gerenciarem templates e enviarem mensagens. Foi construído para passar no **App Review da Meta** como Tech Provider.

```
┌──────────────────────┐  supabase-js (login + leitura com RLS + Realtime)  ┌──────────────────┐
│  web/  React + Vite  │ ─────────────────────────────────────────────────▶ │ Supabase         │
│  (AWS Amplify)       │                                                    │ Auth + Postgres  │
│                      │ ── fetch + JWT ──▶ ┌──────────────────────┐        │ + Vault          │
└──────────────────────┘                    │ n8n (self-hosted)    │──────▶ (service_role)     │
                                            │ workflow único Monuv │        └──────────────────┘
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
| `n8n/src/` | Código dos Code nodes (fonte da verdade): `api/`, `meta/`, `scheduler/` e `_lib.js` |
| `n8n/workflows/monuv.json` | Workflow **único** importável, **gerado** por `node n8n/build.mjs` |
| `n8n/test/` | Testes do código dos nodes + script de teste do webhook real |
| `docs/` | Setup e instruções ao revisor |

## Telas

| Rota | Tela | Para o revisor? |
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
O que ainda falta fazer, em ordem, está em **[docs/proximos-passos.md](docs/proximos-passos.md)**.

## Testes

```bash
node n8n/build.mjs                              # gera o workflow único (checa a sintaxe de cada Code node)
node --test n8n/test/*.test.mjs                 # Code nodes reais com mocks (assinatura, envio, regressões de segurança)
cd supabase/tests && npm install && npm test    # migrations em Postgres local (PGlite): RLS, Vault, cotas, regressões
cd web && npm run lint && npm run build
```

## Segurança

A auditoria (skill `security-audit`, perfil `quick`) e suas correções estão descritas em [docs/security.md](docs/security.md).

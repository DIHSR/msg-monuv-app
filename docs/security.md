# Segurança

## Auditoria run-1 (04/11/2026)

- **Skill:** `security-audit` (Cloudflare), perfil **`quick`**.
- **Commit auditado:** `da30be8`.
- **Agentes:** 4 caçadores, 1 crítico de cobertura e 3 verificadores independentes.
- **Execução:** só código-fonte e checagens locais em sandbox `bwrap`, sem rede. Nenhum serviço real foi contatado.
- **Artefatos completos:** ficam fora do repositório, em `~/security-audit-skill/msg-monuv-app/run-1/` (`REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md`, `findings.json`, `coverage-ledger.json`).

### Achados e correções

| Severidade | Achado | Correção | Teste de regressão |
|---|---|---|---|
| **Média** | O Embedded Signup aceitava um `phone_number_id` não verificado. Um tenant podia "ocupar" o número de outra empresa e receber as mensagens dela. | O `es-exchange` exige a WABA entre as concedidas ao token (falha fechado), exige o número em `GET /{waba}/phone_numbers` com o próprio token, checa o dono **antes** de `subscribed_apps`/`register` e grava com a RPC atômica `claim_wa_account`, que nunca troca o dono. | `n8n/test/security-regressions.test.mjs`, `supabase/tests/security.test.mjs` |
| **Baixa** | O limite diário do demo podia ser furado com requisições concorrentes. | RPC `reserve_outbound_message`: trava o profile, reconta e insere na mesma transação. O caminho de campanhas também passa por ela, via `sendTemplateMessage`. | idem |
| A validar | O webhook roteava mensagens pelo `phone_number_id` sem conferir a WABA do envelope assinado. | O `webhook-process` só atribui o evento se `wa_accounts.waba_id == entry.id`. | `security-regressions.test.mjs` |

### Endurecimentos aplicados

- **Webhook da Meta:**
  - POST sem assinatura válida grava só tamanho e SHA-256, nunca o corpo;
  - o payload só é lido dos mesmos bytes assinados;
  - status e qualidade de template atualizam só as contas da WABA do envelope;
  - o verify token é comparado em tempo constante;
  - o workflow não guarda execuções bem-sucedidas.
- **n8n:**
  - erros internos voltam genéricos ao navegador, com `ref` da execução, e os detalhes vão para `public.app_errors`;
  - o PIN e os tokens ficam totalmente mascarados;
  - o CORS padrão aceita só `https://msg.monuv.com.br`.
- **Campanhas:**
  - a transição `draft→running` é atômica, o que evita envio duplicado;
  - o `total` é calculado no servidor;
  - o front só grava `wa_account_id, name, template_name, template_language` em `campaigns` e `campaign_recipients(campaign_id, to_number, params)`.
- **Banco:**
  - falha de status só marca o destinatário da campanha da própria mensagem;
  - `TRUNCATE/REFERENCES/TRIGGER` revogados de `anon` e `authenticated`;
  - apagar a credencial apaga o token e o PIN do Vault;
  - conta `disconnected` nunca entrega token;
  - a ordem dos status ficou num lugar só (`message_status_rank`), assim como a janela do dia de envio (`sends_today`).
- **Front:**
  - allowlist exata de origens HTTPS no `postMessage` do Embedded Signup;
  - headers de segurança no Amplify (`customHttp.yml`).

### Em aberto (não auditado ou pendente de decisão)

O perfil `quick` deixou 5 áreas **sem auditoria** (`deferred`). Recomenda-se uma passada `standard` sobre elas:

1. **Ciclo de vida das credenciais.** Parcialmente coberto pelas correções acima. Falta decidir o que fazer quando um número `disconnected` de outro tenant bloqueia o reonboarding.
2. **Webhook sem assinatura em alto volume.** Agora só metadados são gravados, mas ainda não há rate limit nem retenção do `webhook_events`.
3. **Campanhas grandes no n8n compartilhado.** Hoje são até 50 mil itens por execução, sem limite de campanhas simultâneas.
4. **Capacidades da credencial demo.** O demo ainda consegue rodar o Embedded Signup e criar templates. **Decisão de produto:** o revisor da Meta precisa conseguir testar a conexão?
5. **Supabase Realtime.** Falta checar a autorização por linha, inclusive os eventos de DELETE.

**Outros pendentes:**
- o trigger do demo não cobre MFA, identities e telefone;
- a CSP completa (`script-src`/`connect-src`) depende dos domínios finais do n8n e do Supabase;
- falta `npm audit` no CI.

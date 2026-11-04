# Roteiro dos vídeos do App Review

Grave em resolução de tela cheia, com o navegador em **inglês ou português e legendas em inglês**. A Meta pede que o vídeo mostre o fluxo **de ponta a ponta**, inclusive o login. Narre ou legende o que está sendo feito.

> O envio em lote **não** entra nos vídeos.

---

## Vídeo 1 — `whatsapp_business_management`

**Objetivo:** mostrar que o app gerencia ativos do WhatsApp do cliente (conexão da WABA e templates).

1. Abrir `https://msg.monuv.com.br/login` e entrar com e-mail e senha.
2. **Conexão:**
   - clicar em **Conectar com o Facebook**;
   - na janela da Meta, entrar, selecionar o Business, a WABA e o número, e concluir;
   - de volta ao app, mostrar o card do número (nome verificado, WABA ID, Phone number ID, qualidade, **Webhooks: Assinado**);
   - abrir **Etapas da conexão** e expandir *Assinatura do app na WABA* e *Registro do número* para mostrar o JSON.
3. **Templates:**
   - clicar em **Sincronizar com a Meta** e mostrar a lista com os badges de status (Aprovado, Em análise, Rejeitado);
   - clicar num template aprovado para ver a prévia;
   - mostrar o card *Última sincronização* (GET `/{waba_id}/message_templates`).
4. **Criar template:**
   - **Novo template**, nome `pedido_confirmado_demo`, categoria Utilidade, corpo com `{{1}}` e `{{2}}` e os exemplos preenchidos;
   - mostrar a prévia e o painel JSON com o payload, que se atualiza enquanto você digita;
   - **Enviar para aprovação** e mostrar a **resposta da Meta** (`id`, `status: PENDING`) no lado direito;
   - voltar à lista: o template aparece *Em análise*. Se aprovar durante a gravação, o badge muda sozinho via webhook.

## Vídeo 2 — `whatsapp_business_messaging`

**Objetivo:** mostrar o envio de mensagem e o recebimento dos status por webhook.

1. Login (pode ser corte rápido).
2. **Enviar mensagem:**
   - número de destino (um celular seu, visível na câmera ou em espelhamento de tela);
   - escolher o template aprovado e preencher as variáveis, mostrando a prévia;
   - **Enviar mensagem**.
3. **Painel JSON lado a lado:** à esquerda o payload `POST /{phone_number_id}/messages`, à direita a resposta da Meta com `wamid` e `HTTP 200`.
4. **Timeline:** *Aceita pela API → Enviada → Entregue*. Abra a mensagem no celular e mostre o status mudar para **Lida** na tela.
5. Em **Últimos envios**, clique numa mensagem anterior para recarregar o JSON.

---

## Dicas

- Antes de gravar, confirme que o número demo está *Conectado* e tem ao menos 1 template aprovado.
- Não mostre o `APP_SECRET`, o token nem o `.env` em nenhum momento.
- No formulário do App Review, descreva para cada permissão **onde** ela é usada (tela e ação) e cole as credenciais de `docs/revisor.md`.

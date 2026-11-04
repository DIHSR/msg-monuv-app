// action "messages.send" — envio individual de template
// body: { wa_account_id, to, template_name, language, params, body_preview }
const { user, body } = $input.first().json; // vindo do Roteador (já autenticado)

try {
  const ctx = await userContext(user.id, body.wa_account_id);

  const to = onlyDigits(body.to);
  if (to.length < 10 || to.length > 15) throw new HttpError(400, 'bad_request', 'Número de destino inválido.');
  if (!body.template_name || !body.language) throw new HttpError(400, 'bad_request', 'Template e idioma são obrigatórios.');

  const r = await sendTemplateMessage({
    userId: user.id,
    account: ctx.account,
    token: ctx.token,
    to,
    templateName: body.template_name,
    language: body.language,
    params: body.params,
    bodyPreview: body.body_preview,
  });

  if (r.limited) throw new HttpError(429, 'daily_limit', `Limite diário de ${r.dailyLimit} envios atingido para esta conta.`);
  if (r.reserveError) throw new HttpError(404, r.reserveError, 'Conta do WhatsApp indisponível para envio.');

  const result = {
    request: r.graph.request,
    response: r.graph.response,
    http_status: r.graph.http_status,
    data: { message_id: r.messageId, wa_message_id: r.waMessageId },
  };
  if (r.sent) return respond(200, { ok: true, ...result });
  return respond(422, {
    ok: false,
    error: { code: 'meta_error', message: (r.error || {}).message || 'A Meta recusou a mensagem.' },
    ...result,
  });
} catch (e) {
  return handleError(e);
}

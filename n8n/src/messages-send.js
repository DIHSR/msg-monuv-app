// POST monuv/messages-send — envio individual de template
// body: { wa_account_id, to, template_name, language, params, body_preview }
const req = $input.first().json;

try {
  const user = await authUser(req);
  const body = req.body || {};
  const ctx = await userContext(user.id, body.wa_account_id);
  const acc = ctx.account;

  if (ctx.daily_send_limit !== null && ctx.daily_send_limit !== undefined && ctx.sends_today >= ctx.daily_send_limit) {
    throw new HttpError(429, 'daily_limit', `Limite diário de ${ctx.daily_send_limit} envios atingido para esta conta.`);
  }

  const to = onlyDigits(body.to);
  if (to.length < 10 || to.length > 15) throw new HttpError(400, 'bad_request', 'Número de destino inválido.');
  if (!body.template_name || !body.language) throw new HttpError(400, 'bad_request', 'Template e idioma são obrigatórios.');

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: buildTemplate(body.template_name, body.language, body.params || {}),
  };

  // 1) grava a mensagem ANTES de chamar a Meta (o webhook de status pode chegar em milissegundos)
  const [msg] = await sb('POST', '/rest/v1/messages', {
    user_id: user.id,
    wa_account_id: acc.id,
    direction: 'outbound',
    to_number: to,
    from_number: acc.display_phone_number,
    type: 'template',
    template_name: body.template_name,
    template_language: body.language,
    body_preview: typeof body.body_preview === 'string' ? body.body_preview.slice(0, 4096) : null,
    request_payload: payload,
    status: 'pending',
  });

  // 2) envia
  const g = await graph('POST', `/${acc.phone_number_id}/messages`, { token: ctx.token, body: payload });
  const sent = g.ok && g.response && g.response.messages && g.response.messages[0];

  // 3) atualiza
  await sb(
    'PATCH',
    `/rest/v1/messages?id=eq.${msg.id}`,
    {
      request_payload: g.request.body,
      response_payload: g.response,
      http_status: g.http_status,
      wa_message_id: sent ? sent.id : null,
      status: sent ? 'accepted' : 'failed',
      error: sent ? null : metaError(g.response),
    },
    { Prefer: 'return=minimal' },
  );
  if (sent) await rpc('attach_message_events', { p_message_id: msg.id });

  const data = { message_id: msg.id, wa_message_id: sent ? sent.id : null };
  if (sent) return respond(200, { ok: true, request: g.request, response: g.response, http_status: g.http_status, data });

  return respond(422, {
    ok: false,
    error: { code: 'meta_error', message: (metaError(g.response) || {}).message || 'A Meta recusou a mensagem.' },
    request: g.request,
    response: g.response,
    http_status: g.http_status,
    data,
  });
} catch (e) {
  return handleError(e);
}

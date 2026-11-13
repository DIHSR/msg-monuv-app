// action "connection.refresh" — atualiza dados do número e garante a assinatura de webhooks
// body: { wa_account_id }
// Resposta: request/response/http_status = leitura do número (GET /{phone_number_id}); `steps` = todas as chamadas.
const { user, body } = $input.first().json; // vindo do Roteador (já autenticado)
const steps = [];

try {
  const ctx = await userContext(user.id, body.wa_account_id);
  const acc = ctx.account;
  const token = ctx.token;

  const ph = await graph('GET', `/${acc.phone_number_id}`, { token, qs: { fields: PHONE_FIELDS } });
  steps.push(step('phone_details', ph));

  const limit = await fetchMessagingLimit(acc.phone_number_id, token);
  steps.push(limit.step);

  const subs = await graph('GET', `/${acc.waba_id}/subscribed_apps`, { token });
  steps.push(step('subscribed_apps', subs));
  let subscribed = appIsSubscribed(subs);
  if (!subscribed) {
    const sub = await graph('POST', `/${acc.waba_id}/subscribed_apps`, { token });
    steps.push(step('subscribe_app', sub));
    const check = await graph('GET', `/${acc.waba_id}/subscribed_apps`, { token });
    steps.push(step('subscribed_apps', check));
    subscribed = appIsSubscribed(check);
  }

  const now = new Date().toISOString();
  const patch = {
    webhook_subscribed: subscribed,
    last_error: ph.ok ? null : metaError(ph.response),
    status: ph.ok ? (subscribed ? 'connected' : 'pending') : 'error',
    ...(ph.ok ? { ...phoneColumns(ph.response), quality_updated_at: now } : {}),
    ...(limit.limit ? { messaging_limit: limit.limit } : {}),
  };
  const rows = await sb('PATCH', `/rest/v1/wa_accounts?id=eq.${acc.id}`, patch);

  const result = {
    data: { account: rows[0] },
    account: rows[0],
    steps,
    request: maskSecrets(ph.request),
    response: maskSecrets(ph.response),
    http_status: ph.http_status,
  };
  if (ph.ok) return respond(200, { ok: true, ...result });
  return respond(502, {
    ok: false,
    error: { code: 'meta_error', message: (metaError(ph.response) || {}).message || 'Erro na Meta' },
    ...result,
  });
} catch (e) {
  return handleError(e, { steps });
}

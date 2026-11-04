// action "connection.refresh" — atualiza dados do número e garante a assinatura de webhooks
// body: { wa_account_id }
const { user, body } = $input.first().json; // vindo do Roteador (já autenticado)
const steps = [];

try {
  const ctx = await userContext(user.id, body.wa_account_id);
  const acc = ctx.account;
  const token = ctx.token;

  const ph = await graph('GET', `/${acc.phone_number_id}`, { token, qs: { fields: PHONE_FIELDS } });
  steps.push(step('phone_details', ph));

  const subs = await graph('GET', `/${acc.waba_id}/subscribed_apps`, { token });
  steps.push(step('subscribed_apps', subs));
  const isSubscribed = (r) =>
    r.ok && (r.response.data || []).some((a) => String((a.whatsapp_business_api_data || {}).id) === String(ENV.APP_ID));

  let subscribed = isSubscribed(subs);
  if (!subscribed) {
    const sub = await graph('POST', `/${acc.waba_id}/subscribed_apps`, { token });
    steps.push(step('subscribe_app', sub));
    subscribed = sub.ok;
  }

  const patch = {
    webhook_subscribed: subscribed,
    last_error: ph.ok ? null : metaError(ph.response),
    status: ph.ok ? 'connected' : 'error',
    ...(ph.ok ? phoneColumns(ph.response) : {}),
  };
  const rows = await sb('PATCH', `/rest/v1/wa_accounts?id=eq.${acc.id}`, patch);

  return respond(ph.ok ? 200 : 502, {
    ok: ph.ok,
    account: rows[0],
    steps,
    ...(ph.ok ? {} : { error: { code: 'meta_error', message: (metaError(ph.response) || {}).message || 'Erro na Meta' } }),
  });
} catch (e) {
  return handleError(e, { steps });
}

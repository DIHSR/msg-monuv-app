// POST monuv/connection-refresh — atualiza dados do número e garante a assinatura de webhooks
// body: { wa_account_id }
const req = $input.first().json;
const steps = [];

try {
  const user = await authUser(req);
  const ctx = await userContext(user.id, (req.body || {}).wa_account_id);
  const acc = ctx.account;
  const token = ctx.token;

  const ph = await graph('GET', `/${acc.phone_number_id}`, {
    token,
    qs: { fields: 'display_phone_number,verified_name,quality_rating,code_verification_status,name_status,status' },
  });
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

  const p = ph.ok ? ph.response : {};
  const patch = {
    webhook_subscribed: subscribed,
    last_error: ph.ok ? null : metaError(ph.response),
    status: ph.ok ? 'connected' : 'error',
  };
  if (ph.ok) {
    Object.assign(patch, {
      display_phone_number: p.display_phone_number || acc.display_phone_number,
      verified_name: p.verified_name || acc.verified_name,
      quality_rating: p.quality_rating || null,
      name_status: p.name_status || null,
      code_verification_status: p.code_verification_status || null,
      phone_status: p.status || null,
    });
  }
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

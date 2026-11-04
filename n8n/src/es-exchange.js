// POST monuv/es-exchange — finaliza o Embedded Signup
// body: { code, waba_id?, phone_number_id?, business_id?, event? }
const req = $input.first().json;
const steps = [];

try {
  const user = await authUser(req);
  await userContext(user.id, null, { requireAccount: false });

  const body = req.body || {};
  if (!body.code) throw new HttpError(400, 'bad_request', 'Parâmetro "code" ausente.');
  if (!ENV.APP_ID || !ENV.APP_SECRET) throw new HttpError(500, 'config', 'MONUV_META_APP_ID / MONUV_META_APP_SECRET não configurados.');

  // 1) Troca do code por token (business integration system user token)
  const ex = await graph('GET', '/oauth/access_token', {
    qs: { client_id: ENV.APP_ID, client_secret: ENV.APP_SECRET, code: body.code },
  });
  steps.push(step('exchange_code', ex));
  if (!ex.ok || !ex.response.access_token) {
    throw new HttpError(502, 'exchange_failed', (metaError(ex.response) || {}).message || 'Falha ao trocar o code pelo token.');
  }
  const token = ex.response.access_token;

  // 2) Confere quais WABAs o token realmente pode acessar
  const dbg = await graph('GET', '/debug_token', {
    qs: { input_token: token },
    token: `${ENV.APP_ID}|${ENV.APP_SECRET}`,
  });
  steps.push(step('debug_token', dbg));
  const scopes = (dbg.response && dbg.response.data && dbg.response.data.granular_scopes) || [];
  const mgmt = scopes.find((s) => s.scope === 'whatsapp_business_management');
  const allowedWabas = (mgmt && mgmt.target_ids) || [];

  let wabaId = body.waba_id ? String(body.waba_id) : null;
  if (!wabaId && allowedWabas.length) wabaId = String(allowedWabas[allowedWabas.length - 1]);
  if (!wabaId) throw new HttpError(400, 'no_waba', 'Não foi possível identificar a conta do WhatsApp Business (WABA).');
  if (allowedWabas.length && !allowedWabas.map(String).includes(wabaId)) {
    throw new HttpError(403, 'waba_not_granted', 'A WABA informada não foi autorizada para este aplicativo.');
  }

  // 3) Número de telefone (se o session info não trouxe, pega o primeiro da WABA)
  let phoneId = body.phone_number_id ? String(body.phone_number_id) : null;
  if (!phoneId) {
    const list = await graph('GET', `/${wabaId}/phone_numbers`, { token, qs: { fields: 'id,display_phone_number,verified_name' } });
    steps.push(step('list_phone_numbers', list));
    phoneId = list.ok && list.response.data && list.response.data[0] ? String(list.response.data[0].id) : null;
  }
  if (!phoneId) throw new HttpError(400, 'no_phone', 'Nenhum número encontrado na WABA.');

  // 4) Assina o app na WABA (necessário para receber webhooks)
  const sub = await graph('POST', `/${wabaId}/subscribed_apps`, { token });
  steps.push(step('subscribe_app', sub));

  // 5) Registra o número na Cloud API (pula no modo coexistência com o app WhatsApp Business)
  const coexistence = String(body.event || '').includes('WHATSAPP_BUSINESS_APP');
  let pin = null;
  let registered = coexistence;
  if (!coexistence) {
    pin = String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');
    const reg = await graph('POST', `/${phoneId}/register`, { token, body: { messaging_product: 'whatsapp', pin } });
    steps.push(step('register_phone', reg));
    const err = metaError(reg.response);
    // número já registrado anteriormente também serve
    registered = reg.ok || (err && /already registered/i.test(err.message || ''));
    if (!reg.ok) pin = null;
  }

  // 6) Detalhes do número e da WABA
  const ph = await graph('GET', `/${phoneId}`, {
    token,
    qs: { fields: 'display_phone_number,verified_name,quality_rating,code_verification_status,name_status,status' },
  });
  steps.push(step('phone_details', ph));
  const wb = await graph('GET', `/${wabaId}`, { token, qs: { fields: 'name' } });
  steps.push(step('waba_details', wb));

  // 7) Grava (impede que outro usuário "sequestre" um número já conectado)
  const existing = await sb('GET', `/rest/v1/wa_accounts?phone_number_id=eq.${encodeURIComponent(phoneId)}&select=id,user_id`);
  if (existing.length && existing[0].user_id !== user.id) {
    throw new HttpError(409, 'phone_in_use', 'Este número já está conectado a outra conta Monuv.');
  }
  const p = ph.ok ? ph.response : {};
  const rows = await sb(
    'POST',
    '/rest/v1/wa_accounts?on_conflict=phone_number_id',
    {
      user_id: user.id,
      business_id: body.business_id ? String(body.business_id) : null,
      waba_id: wabaId,
      waba_name: wb.ok ? wb.response.name : null,
      phone_number_id: phoneId,
      display_phone_number: p.display_phone_number || null,
      verified_name: p.verified_name || null,
      quality_rating: p.quality_rating || null,
      name_status: p.name_status || null,
      code_verification_status: p.code_verification_status || null,
      phone_status: p.status || null,
      status: registered && sub.ok ? 'connected' : 'pending',
      webhook_subscribed: sub.ok,
      last_error: registered && sub.ok ? null : { steps: steps.filter((s) => !s.ok).map((s) => s.name) },
      connected_at: new Date().toISOString(),
    },
    { Prefer: 'resolution=merge-duplicates,return=representation' },
  );
  const account = rows[0];

  await rpc('wa_store_secret', { p_wa_account_id: account.id, p_kind: 'token', p_value: token });
  if (pin) await rpc('wa_store_secret', { p_wa_account_id: account.id, p_kind: 'pin', p_value: pin });
  steps.push({ name: 'save_account', ok: true, response: { wa_account_id: account.id, status: account.status } });

  return respond(200, { ok: true, account, steps });
} catch (e) {
  return handleError(e, { steps });
}

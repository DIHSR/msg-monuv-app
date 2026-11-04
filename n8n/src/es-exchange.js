// POST monuv/es-exchange — finaliza o Embedded Signup
// body: { code, waba_id?, phone_number_id?, business_id?, event? }
//
// Ordem importa (auditoria run-1): toda checagem de posse acontece ANTES de qualquer
// efeito colateral na Meta (subscribed_apps, register) ou no banco.
const req = $input.first().json;
const steps = [];

/** WABAs que o token trocado realmente pode gerenciar (falha fechado). */
async function grantedWabas(token) {
  const dbg = await graph('GET', '/debug_token', { qs: { input_token: token }, token: `${ENV.APP_ID}|${ENV.APP_SECRET}` });
  steps.push(step('debug_token', dbg));
  const scopes = (dbg.ok && dbg.response.data && dbg.response.data.granular_scopes) || [];
  const mgmt = scopes.find((s) => s.scope === 'whatsapp_business_management');
  const ids = ((mgmt && mgmt.target_ids) || []).map(String);
  if (!ids.length) throw new HttpError(403, 'waba_not_granted', 'O token não concede acesso a nenhuma conta do WhatsApp Business.');
  return ids;
}

/** Números da WABA visíveis para o token trocado. */
async function grantedPhones(wabaId, token) {
  const phones = [];
  let after = null;
  for (let page = 0; page < 10; page++) {
    const qs = { fields: 'id', limit: '100' };
    if (after) qs.after = after;
    const list = await graph('GET', `/${wabaId}/phone_numbers`, { token, qs });
    steps.push(step('list_phone_numbers', list));
    if (!list.ok) break;
    phones.push(...(list.response.data || []).map((p) => String(p.id)));
    after = list.response.paging && list.response.paging.next && list.response.paging.cursors ? list.response.paging.cursors.after : null;
    if (!after) break;
  }
  return phones;
}

async function assertPhoneFree(phoneId, userId) {
  const existing = await sb('GET', `/rest/v1/wa_accounts?phone_number_id=eq.${encodeURIComponent(phoneId)}&select=user_id`);
  if (existing.length && existing[0].user_id !== userId) {
    throw new HttpError(409, 'phone_in_use', 'Este número já está conectado a outra conta Monuv.');
  }
}

/** Registra o número na Cloud API (pula no modo coexistência). Retorna { registered, pin }. */
async function registerPhone(phoneId, token, event) {
  if (String(event || '').includes('WHATSAPP_BUSINESS_APP')) return { registered: true, pin: null };
  const pin = String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');
  const reg = await graph('POST', `/${phoneId}/register`, { token, body: { messaging_product: 'whatsapp', pin } });
  steps.push(step('register_phone', reg));
  const err = metaError(reg.response);
  const already = !!(err && /already registered/i.test(err.message || ''));
  return { registered: reg.ok || already, pin: reg.ok ? pin : null };
}

try {
  const user = await authUser(req);
  await userContext(user.id, null, { requireAccount: false });

  const body = req.body || {};
  if (!body.code) throw new HttpError(400, 'bad_request', 'Parâmetro "code" ausente.');
  if (!ENV.APP_ID || !ENV.APP_SECRET) throw new HttpError(500, 'config', 'MONUV_META_APP_ID / MONUV_META_APP_SECRET não configurados.');

  // 1) code → token
  const ex = await graph('GET', '/oauth/access_token', {
    qs: { client_id: ENV.APP_ID, client_secret: ENV.APP_SECRET, code: body.code },
  });
  steps.push(step('exchange_code', ex));
  if (!ex.ok || !ex.response.access_token) {
    throw new HttpError(502, 'exchange_failed', (metaError(ex.response) || {}).message || 'Falha ao trocar o code pelo token.');
  }
  const token = ex.response.access_token;

  // 2) WABA precisa estar entre as concedidas ao token
  const wabas = await grantedWabas(token);
  const wabaId = body.waba_id ? String(body.waba_id) : wabas[wabas.length - 1];
  if (!wabas.includes(wabaId)) throw new HttpError(403, 'waba_not_granted', 'A WABA informada não foi autorizada para este aplicativo.');

  // 3) número precisa pertencer a essa WABA, visto pelo próprio token
  const phones = await grantedPhones(wabaId, token);
  const phoneId = body.phone_number_id ? String(body.phone_number_id) : phones[0];
  if (!phoneId || !phones.includes(phoneId)) {
    throw new HttpError(403, 'phone_not_granted', 'O número informado não pertence à conta do WhatsApp autorizada.');
  }

  // 4) número livre (ou já deste usuário) — ainda sem nenhum efeito colateral
  await assertPhoneFree(phoneId, user.id);

  // 5) efeitos na Meta: assina webhooks e registra o número
  const sub = await graph('POST', `/${wabaId}/subscribed_apps`, { token });
  steps.push(step('subscribe_app', sub));
  const { registered, pin } = await registerPhone(phoneId, token, body.event);

  // 6) detalhes
  const ph = await graph('GET', `/${phoneId}`, { token, qs: { fields: PHONE_FIELDS } });
  steps.push(step('phone_details', ph));
  const wb = await graph('GET', `/${wabaId}`, { token, qs: { fields: 'name' } });
  steps.push(step('waba_details', wb));

  // 7) vínculo atômico que nunca troca o dono de um número
  const ready = registered && sub.ok;
  const claim = await rpc('claim_wa_account', {
    p_user_id: user.id,
    p_row: {
      business_id: body.business_id ? String(body.business_id) : null,
      waba_id: wabaId,
      waba_name: wb.ok ? wb.response.name : null,
      phone_number_id: phoneId,
      ...(ph.ok ? phoneColumns(ph.response) : {}),
      status: ready ? 'connected' : 'pending',
      webhook_subscribed: sub.ok,
      last_error: ready ? null : { steps: steps.filter((s) => !s.ok).map((s) => s.name) },
    },
  });
  if (!claim || !claim.ok) throw new HttpError(409, 'phone_in_use', 'Este número já está conectado a outra conta Monuv.');
  const account = claim.account;

  await rpc('wa_store_secret', { p_wa_account_id: account.id, p_kind: 'token', p_value: token });
  if (pin) await rpc('wa_store_secret', { p_wa_account_id: account.id, p_kind: 'pin', p_value: pin });
  steps.push({ name: 'save_account', ok: true, response: { wa_account_id: account.id, status: account.status } });

  return respond(200, { ok: true, account, steps });
} catch (e) {
  return handleError(e, { steps });
}

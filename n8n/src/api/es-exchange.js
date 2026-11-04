// action "es.exchange" — finaliza o Embedded Signup (v5, coexistência ligada por padrão)
// body: { code, waba_id?, phone_number_id?, business_id?, event?, is_on_biz_app? }
//
// Coexistência (número que continua no app WhatsApp Business): NÃO registra o número
// (já está registrado) e, se MONUV_COEX_SYNC=true, pede contatos + histórico do app
// (a Meta só aceita esse pedido uma vez, até 24 h após o onboarding).
//
// Ordem importa (auditoria run-1): toda checagem de posse acontece ANTES de qualquer
// efeito colateral na Meta (subscribed_apps, register) ou no banco.
const { user, body } = $input.first().json; // vindo do Roteador (já autenticado)
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

/** Registra o número na Cloud API com PIN aleatório. Retorna { registered, pin }. */
async function registerPhone(phoneId, token) {
  const pin = String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');
  const reg = await graph('POST', `/${phoneId}/register`, { token, body: { messaging_product: 'whatsapp', pin } });
  steps.push(step('register_phone', reg));
  const err = metaError(reg.response);
  const already = !!(err && /already registered/i.test(err.message || ''));
  return { registered: reg.ok || already, pin: reg.ok ? pin : null };
}

/** Coexistência: a Graph API é a fonte da verdade; a dica do navegador só vale se a Graph falhar. */
function isCoexistence(phoneDetails) {
  if (phoneDetails.ok) return phoneDetails.response.is_on_biz_app === true;
  return body.is_on_biz_app === true || body.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
}

/** Pede à Meta os contatos e depois o histórico do app (nessa ordem, como a Meta recomenda). */
async function requestCoexSync(phoneId, token) {
  let any = false;
  for (const syncType of ['smb_app_state_sync', 'history']) {
    const r = await graph('POST', `/${phoneId}/smb_app_data`, { token, body: { messaging_product: 'whatsapp', sync_type: syncType } });
    steps.push(step(`sync_${syncType}`, r));
    any = any || r.ok;
  }
  return any;
}

try {
  await userContext(user.id, null, { requireAccount: false });

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

  // 5) efeitos na Meta: assina webhooks
  const sub = await graph('POST', `/${wabaId}/subscribed_apps`, { token });
  steps.push(step('subscribe_app', sub));

  // 6) detalhes (dizem se o número está em coexistência) e registro só fora da coexistência
  const ph = await graph('GET', `/${phoneId}`, { token, qs: { fields: PHONE_FIELDS } });
  steps.push(step('phone_details', ph));
  const wb = await graph('GET', `/${wabaId}`, { token, qs: { fields: 'name' } });
  steps.push(step('waba_details', wb));
  const coexistence = isCoexistence(ph);
  const { registered, pin } = coexistence ? { registered: true, pin: null } : await registerPhone(phoneId, token);

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
      is_on_biz_app: coexistence,
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

  // 8) coexistência: sincronização única, só depois do vínculo garantido
  let saved = account;
  if (coexistence && ENV.COEX_SYNC && await requestCoexSync(phoneId, token)) {
    const rows = await sb('PATCH', `/rest/v1/wa_accounts?id=eq.${account.id}`, { coex_sync_requested_at: new Date().toISOString() });
    saved = rows[0] || account;
  }

  return respond(200, { ok: true, account: saved, coexistence, steps });
} catch (e) {
  return handleError(e, { steps });
}

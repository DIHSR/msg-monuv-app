// Processa eventos da Meta (roda DEPOIS do 200 já ter sido respondido).
const { valid, reason, payload, raw_size, raw_sha256 } = $input.first().json;

// Assinatura inválida: registra só metadados (nunca o corpo enviado pelo remetente não autenticado)
if (!valid) {
  await sb(
    'POST',
    '/rest/v1/webhook_events',
    { signature_valid: false, payload: { size: raw_size ?? null, sha256: raw_sha256 ?? null }, processed: false, error: reason },
    MINIMAL,
  );
  return [{ json: { valid: false, reason } }];
}

const cache = {};
async function cached(key, load) {
  if (!(key in cache)) cache[key] = await load();
  return cache[key];
}

/** Contas Monuv vinculadas à WABA do envelope assinado. */
function wabaAccounts(wabaId) {
  return cached(`w:${wabaId}`, () =>
    sb('GET', `/rest/v1/wa_accounts?waba_id=eq.${encodeURIComponent(wabaId)}&select=id,user_id,waba_id`),
  );
}

/**
 * Conta dona do número — somente se ela pertence à MESMA WABA do envelope assinado (entry.id).
 * Um vínculo divergente (auditoria run-1) é ignorado: o evento não é entregue a ninguém.
 */
async function phoneAccount(wabaId, phoneNumberId) {
  const rows = await cached(`p:${phoneNumberId}`, () =>
    sb('GET', `/rest/v1/wa_accounts?phone_number_id=eq.${encodeURIComponent(phoneNumberId)}&select=id,user_id,waba_id&limit=1`),
  );
  const acc = rows[0] || null;
  return acc && String(acc.waba_id) === wabaId ? acc : null;
}

async function accountFor(wabaId, value) {
  const phoneNumberId = value.metadata && value.metadata.phone_number_id;
  if (phoneNumberId) return phoneAccount(wabaId, String(phoneNumberId));
  return (await wabaAccounts(wabaId))[0] || null;
}

function inboundRow(acc, value, m) {
  const contact = (value.contacts || []).find((x) => x.wa_id === m.from);
  const name = contact && contact.profile && contact.profile.name ? `${contact.profile.name}: ` : '';
  const text = (m.text && m.text.body) || (m.button && m.button.text) || (m.interactive && JSON.stringify(m.interactive)) || `[${m.type}]`;
  return {
    user_id: acc.user_id,
    wa_account_id: acc.id,
    direction: 'inbound',
    from_number: m.from,
    to_number: value.metadata && value.metadata.display_phone_number,
    type: m.type,
    body_preview: name + String(text).slice(0, 4000),
    response_payload: m,
    wa_message_id: m.id,
    status: 'received',
    created_at: new Date(m.timestamp ? Number(m.timestamp) * 1000 : Date.now()).toISOString(),
  };
}

/** PATCH em templates restrito às contas da WABA do envelope. */
async function patchTemplate(wabaId, templateId, fields) {
  const ids = (await wabaAccounts(wabaId)).map((a) => a.id);
  if (!ids.length) return;
  await sb(
    'PATCH',
    `/rest/v1/templates?meta_template_id=eq.${encodeURIComponent(String(templateId))}&wa_account_id=in.(${ids.join(',')})`,
    fields,
    MINIMAL,
  );
}

async function handleChange(wabaId, field, value, acc, results) {
  if (field === 'messages') {
    for (const s of value.statuses || []) {
      const r = await rpc('apply_message_status', {
        p_wa_message_id: s.id,
        p_status: s.status,
        p_occurred_at: new Date(s.timestamp ? Number(s.timestamp) * 1000 : Date.now()).toISOString(),
        p_payload: s,
      });
      results.push({ type: 'status', id: s.id, status: s.status, r });
    }
    if (acc && Array.isArray(value.messages) && value.messages.length) {
      await sb('POST', '/rest/v1/messages?on_conflict=wa_message_id', value.messages.map((m) => inboundRow(acc, value, m)), {
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      });
      results.push({ type: 'inbound', count: value.messages.length });
    }
  } else if (field === 'message_template_status_update') {
    await patchTemplate(wabaId, value.message_template_id, {
      status: value.event,
      rejected_reason: value.reason && value.reason !== 'NONE' ? value.reason : null,
    });
    results.push({ type: 'template_status', id: value.message_template_id, status: value.event });
  } else if (field === 'message_template_quality_update') {
    await patchTemplate(wabaId, value.message_template_id, { quality_score: value.new_quality_score || null });
    results.push({ type: 'template_quality', id: value.message_template_id });
  } else if (field === 'account_update' && value.event === 'PARTNER_REMOVED' && wabaId) {
    // cliente removeu o app na Meta → contas da WABA ficam desconectadas (e sem token, ver n8n_user_context)
    await sb('PATCH', `/rest/v1/wa_accounts?waba_id=eq.${encodeURIComponent(wabaId)}`, { status: 'disconnected', webhook_subscribed: false }, MINIMAL);
    results.push({ type: 'partner_removed', waba_id: wabaId });
  }
}

const results = [];
for (const entry of (payload && payload.entry) || []) {
  const wabaId = String(entry.id || '');
  for (const change of entry.changes || []) {
    const value = change.value || {};
    let error = null;
    let acc = null;
    try {
      acc = await accountFor(wabaId, value);
      await handleChange(wabaId, change.field, value, acc, results);
    } catch (e) {
      error = String((e && e.message) || e);
    }
    await sb(
      'POST',
      '/rest/v1/webhook_events',
      {
        signature_valid: true,
        object: payload.object,
        field: change.field,
        waba_id: wabaId || null,
        user_id: acc ? acc.user_id : null,
        payload: { entry_id: entry.id, change },
        processed: !error,
        error,
      },
      MINIMAL,
    );
  }
}

return [{ json: { valid: true, results } }];

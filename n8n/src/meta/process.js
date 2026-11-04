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

/** Texto curto para a lista de mensagens, qualquer que seja o tipo. */
function previewText(m) {
  return (m.text && m.text.body) || (m.button && m.button.text) || (m.interactive && JSON.stringify(m.interactive)) || `[${m.type}]`;
}

const tsIso = (ts) => new Date(ts ? Number(ts) * 1000 : Date.now()).toISOString();

function inboundRow(acc, value, m) {
  const contact = (value.contacts || []).find((x) => x.wa_id === m.from);
  const name = contact && contact.profile && contact.profile.name ? `${contact.profile.name}: ` : '';
  return {
    user_id: acc.user_id,
    wa_account_id: acc.id,
    direction: 'inbound',
    from_number: m.from,
    to_number: value.metadata && value.metadata.display_phone_number,
    type: m.type,
    body_preview: name + String(previewText(m)).slice(0, 4000),
    response_payload: m,
    wa_message_id: m.id,
    status: 'received',
    created_at: tsIso(m.timestamp),
  };
}

/** Coexistência: mensagem que a empresa enviou pelo app WhatsApp Business (ou aparelho vinculado). */
function echoRow(acc, m) {
  return {
    user_id: acc.user_id,
    wa_account_id: acc.id,
    direction: 'outbound',
    from_number: m.from,
    to_number: m.to,
    type: m.type,
    body_preview: String(previewText(m)).slice(0, 4000),
    response_payload: m,
    wa_message_id: m.id,
    status: 'sent',
    created_at: tsIso(m.timestamp),
  };
}

const HISTORY_STATUS = { SENT: 'sent', DELIVERED: 'delivered', READ: 'read', PLAYED: 'read', ERROR: 'failed', FAILED: 'failed' };

/** Coexistência: mensagem do histórico do app. thread.id é o número do cliente. */
function historyRow(acc, value, thread, m) {
  const fromCustomer = String(m.from) === String(thread.id);
  const business = value.metadata && value.metadata.display_phone_number;
  const ctx = String((m.history_context && m.history_context.status) || '').toUpperCase();
  return {
    user_id: acc.user_id,
    wa_account_id: acc.id,
    direction: fromCustomer ? 'inbound' : 'outbound',
    from_number: fromCustomer ? m.from : m.from || business,
    to_number: fromCustomer ? business : thread.id,
    type: m.type,
    body_preview: String(previewText(m)).slice(0, 4000),
    response_payload: m,
    wa_message_id: m.id,
    status: fromCustomer ? 'received' : HISTORY_STATUS[ctx] || 'sent',
    created_at: tsIso(m.timestamp),
  };
}

async function insertMessages(rows) {
  if (!rows.length) return;
  await sb('POST', '/rest/v1/messages?on_conflict=wa_message_id', rows, { Prefer: 'resolution=ignore-duplicates,return=minimal' });
}

/** Lotes grandes (histórico, contatos) não vão inteiros para webhook_events: só um resumo, sem dados pessoais. */
function auditPayload(entry, change) {
  const v = change.value || {};
  if (change.field === 'history') {
    return {
      entry_id: entry.id,
      field: 'history',
      chunks: (v.history || []).map((h) => ({
        metadata: h.metadata || null,
        threads: (h.threads || []).length,
        messages: (h.threads || []).reduce((n, t) => n + (t.messages || []).length, 0),
        errors: h.errors || null,
      })),
    };
  }
  if (change.field === 'smb_app_state_sync') {
    return { entry_id: entry.id, field: 'smb_app_state_sync', items: (v.state_sync || []).length };
  }
  return { entry_id: entry.id, change };
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
      await insertMessages(value.messages.map((m) => inboundRow(acc, value, m)));
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
  } else if (field === 'smb_message_echoes') {
    if (acc) {
      const echoes = value.message_echoes || [];
      await insertMessages(echoes.map((m) => echoRow(acc, m)));
      results.push({ type: 'echo', count: echoes.length });
    }
  } else if (field === 'history') {
    if (acc) {
      const rows = [];
      for (const chunk of value.history || []) {
        for (const thread of chunk.threads || []) {
          for (const m of thread.messages || []) rows.push(historyRow(acc, value, thread, m));
        }
      }
      await insertMessages(rows);
      results.push({ type: 'history', count: rows.length });
    }
  } else if (field === 'smb_app_state_sync') {
    // contatos do app: hoje o Monuv não tem agenda — só registramos que chegou (sem dados pessoais)
    results.push({ type: 'contacts_sync', count: (value.state_sync || []).length });
  } else if (field === 'account_update' && DISCONNECT_EVENTS.has(value.event) && wabaId) {
    // PARTNER_REMOVED: cliente removeu o app (na Meta ou no app WhatsApp Business).
    // ACCOUNT_OFFBOARDED: o número saiu da coexistência (troca de aparelho, novo registro no app).
    // Em ambos a conta fica desconectada (e sem token, ver n8n_user_context) até reconectar pelo Embedded Signup.
    await sb(
      'PATCH',
      `/rest/v1/wa_accounts?waba_id=eq.${encodeURIComponent(wabaId)}`,
      { status: 'disconnected', webhook_subscribed: false, last_error: { event: value.event, disconnection_info: value.disconnection_info || null } },
      MINIMAL,
    );
    results.push({ type: 'disconnected', event: value.event, waba_id: wabaId });
  }
}

const DISCONNECT_EVENTS = new Set(['PARTNER_REMOVED', 'ACCOUNT_OFFBOARDED']);

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
        payload: auditPayload(entry, change),
        processed: !error,
        error,
      },
      MINIMAL,
    );
  }
}

return [{ json: { valid: true, results } }];

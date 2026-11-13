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
    sb('GET', `/rest/v1/wa_accounts?waba_id=eq.${encodeURIComponent(wabaId)}&select=id,user_id,waba_id,display_phone_number,phone_number_id`),
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
  return {
    user_id: acc.user_id,
    wa_account_id: acc.id,
    direction: 'inbound',
    origin: 'api',
    from_number: m.from,
    to_number: value.metadata && value.metadata.display_phone_number,
    contact_name: (contact && contact.profile && contact.profile.name) || null,
    type: m.type,
    body_preview: String(previewText(m)).slice(0, 4000),
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
    origin: 'business_app',
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
    origin: 'history',
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
      await touchApp(acc);
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
    // contatos do app: hoje o Monuv não tem agenda — só registramos que chegou (sem dados pessoais).
    // Mudança de contato no app é sinal de que o celular está ativo.
    if (acc) await touchApp(acc);
    results.push({ type: 'contacts_sync', count: (value.state_sync || []).length });
  } else if (field === 'phone_number_quality_update') {
    await handleQualityUpdate(wabaId, value, results);
  } else if (field === 'account_update') {
    await handleAccountUpdate(wabaId, value, results);
  }
}

// ---------------------------------------------------------------- coexistência: atividade do celular (lacuna 3)
/** Mensagem enviada pelo app ou contato alterado no app = celular ativo. Zera o alerta de inatividade. */
async function touchApp(acc) {
  await sb('PATCH', `/rest/v1/wa_accounts?id=eq.${acc.id}`, { last_seen_at: new Date().toISOString(), inactivity_alert_at: null }, MINIMAL);
}

async function logAccountEvent(accounts, field, event, payload) {
  if (!accounts.length) return;
  await sb('POST', '/rest/v1/wa_account_events', accounts.map((a) => ({
    wa_account_id: a.id,
    user_id: a.user_id,
    field,
    event: event || null,
    payload,
  })), MINIMAL);
}

// ---------------------------------------------------------------- qualidade e limite (lacuna 2)
/**
 * phone_number_quality_update não traz phone_number_id: o número vem em display_phone_number.
 * O limite hoje é do portfólio (max_daily_conversations_per_business; current_limit sai em fev/2026),
 * então vale para todas as contas da WABA. A qualidade (GREEN/YELLOW/RED) é relida na Graph API.
 */
async function handleQualityUpdate(wabaId, value, results) {
  const all = await wabaAccounts(wabaId);
  if (!all.length) return;
  const digits = onlyDigits(value.display_phone_number);
  const matched = all.filter((a) => digits && onlyDigits(a.display_phone_number) === digits);
  const targets = matched.length ? matched : all;
  const limit = value.max_daily_conversations_per_business ?? value.current_limit ?? null;

  const patch = { quality_updated_at: new Date().toISOString() };
  if (limit !== null && limit !== undefined) patch.messaging_limit = String(limit);
  await sb('PATCH', `/rest/v1/wa_accounts?id=in.(${all.map((a) => a.id).join(',')})`, patch, MINIMAL);
  await logAccountEvent(targets, 'phone_number_quality_update', value.event, value);

  for (const acc of matched) {
    try {
      const ctx = await userContext(acc.user_id, acc.id);
      const g = await graph('GET', `/${acc.phone_number_id}`, { token: ctx.token, qs: { fields: 'quality_rating' } });
      if (g.ok && g.response && g.response.quality_rating) {
        await sb('PATCH', `/rest/v1/wa_accounts?id=eq.${acc.id}`, { quality_rating: g.response.quality_rating }, MINIMAL);
      }
    } catch (_) { /* best-effort: o evento e o limite já foram gravados */ }
  }
  results.push({ type: 'quality', event: value.event, limit, accounts: targets.length });
}

// ---------------------------------------------------------------- account_update (lacuna 3)
// Desconexões. Em PARTNER_REMOVED de coexistência, disconnection_info.reason diz o motivo
// (PRIMARY_INACTIVITY ~14 dias sem abrir o app, COMPANION_INACTIVITY, CHANGE_NUMBER, USER_RE_REGISTERED...).
const DISCONNECT_EVENTS = new Set(['PARTNER_REMOVED', 'ACCOUNT_OFFBOARDED', 'PARTNER_APP_UNINSTALLED', 'ACCOUNT_DELETED']);
// Avisos que não derrubam a conexão, mas precisam aparecer na tela.
const WARNING_EVENTS = new Set(['ACCOUNT_VIOLATION', 'ACCOUNT_RESTRICTION']);

const DISCONNECT_MESSAGES = {
  PRIMARY_INACTIVITY: 'O WhatsApp Business ficou cerca de 14 dias sem ser aberto no celular. Reconecte o número.',
  COMPANION_INACTIVITY: 'Um aparelho vinculado ficou cerca de 30 dias inativo. Reconecte o número.',
  CHANGE_NUMBER: 'O número foi trocado no app WhatsApp Business. Reconecte com o número novo.',
  USER_RE_REGISTERED: 'O número foi registrado de novo em outro aparelho. Reconecte o número.',
  BUSINESS_DOWNGRADE: 'A conta voltou para o WhatsApp comum. Reconecte pelo WhatsApp Business.',
  ACCOUNT_DISCONNECTED: 'A conexão com a API foi desfeita no app WhatsApp Business. Reconecte o número.',
  ACCOUNT_OFFBOARDED: 'O número saiu da coexistência (troca de aparelho ou novo registro).',
  PARTNER_APP_UNINSTALLED: 'O cliente removeu as permissões do app Monuv na Meta. Reconecte o número.',
  PARTNER_REMOVED: 'A conta do WhatsApp deixou de ser compartilhada com a Monuv. Reconecte o número.',
  ACCOUNT_DELETED: 'A conta do WhatsApp foi excluída na Meta.',
};

/** O envelope é assinado pela Meta; o WABA ID pode vir em entry.id e/ou em waba_info.waba_id. */
async function accountUpdateAccounts(wabaId, value) {
  const ids = [...new Set([wabaId, value.waba_info && value.waba_info.waba_id].filter(Boolean).map(String))];
  const lists = await Promise.all(ids.map((id) => wabaAccounts(id)));
  const seen = new Set();
  return lists.flat().filter((a) => !seen.has(a.id) && seen.add(a.id));
}

async function handleAccountUpdate(wabaId, value, results) {
  const accounts = await accountUpdateAccounts(wabaId, value);
  const ev = value.event;
  await logAccountEvent(accounts, 'account_update', ev, value);
  if (!accounts.length) {
    results.push({ type: 'account_update', event: ev, accounts: 0 });
    return;
  }
  const idsFilter = `id=in.(${accounts.map((a) => a.id).join(',')})`;
  const now = new Date().toISOString();

  if (DISCONNECT_EVENTS.has(ev)) {
    // Conta fica desconectada (e sem token, ver n8n_user_context) até reconectar pelo Embedded Signup.
    const info = value.disconnection_info || null;
    const reason = (info && info.reason) || ev;
    await sb('PATCH', `/rest/v1/wa_accounts?${idsFilter}`, {
      status: 'disconnected',
      webhook_subscribed: false,
      disconnected_at: now,
      inactivity_alert_at: null,
      last_error: { event: ev, reason, initiated_by: (info && info.initiated_by) || null, message: DISCONNECT_MESSAGES[reason] || DISCONNECT_MESSAGES[ev] || null, disconnection_info: info },
    }, MINIMAL);
    results.push({ type: 'disconnected', event: ev, reason, accounts: accounts.length });
  } else if (ev === 'ACCOUNT_RECONNECTED') {
    // volta só quem caiu por ACCOUNT_OFFBOARDED (troca de aparelho / novo registro)
    await sb('PATCH', `/rest/v1/wa_accounts?${idsFilter}&last_error->>event=eq.ACCOUNT_OFFBOARDED`, {
      status: 'connected',
      disconnected_at: null,
      last_error: null,
      last_seen_at: now,
    }, MINIMAL);
    results.push({ type: 'reconnected', accounts: accounts.length });
  } else if (ev === 'DISABLED_UPDATE') {
    const ban = value.ban_info || {};
    const state = String(ban.waba_ban_state || '').toUpperCase();
    await sb('PATCH', `/rest/v1/wa_accounts?${idsFilter}`, {
      ...(state === 'DISABLE' ? { status: 'error' } : {}),
      last_error: { event: ev, ban_info: ban, message: state === 'DISABLE' ? 'A Meta desativou esta conta do WhatsApp.' : `Aviso da Meta: ${state || 'atualização de bloqueio'}.` },
    }, MINIMAL);
    results.push({ type: 'disabled_update', state, accounts: accounts.length });
  } else if (WARNING_EVENTS.has(ev)) {
    await sb('PATCH', `/rest/v1/wa_accounts?${idsFilter}`, {
      last_error: { event: ev, violation_info: value.violation_info || null, restriction_info: value.restriction_info || null, message: 'A Meta registrou uma violação ou restrição de política nesta conta.' },
    }, MINIMAL);
    results.push({ type: 'warning', event: ev, accounts: accounts.length });
  } else if (ev === 'PARTNER_ADDED') {
    // confirma o onboarding e completa o portfólio do cliente, se ainda não temos
    const owner = value.waba_info && value.waba_info.owner_business_id;
    if (owner) {
      await sb('PATCH', `/rest/v1/wa_accounts?${idsFilter}&business_id=is.null`, { business_id: String(owner) }, MINIMAL);
    }
    results.push({ type: 'partner_added', accounts: accounts.length });
  } else {
    results.push({ type: 'account_update', event: ev, accounts: accounts.length });
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
        payload: auditPayload(entry, change),
        processed: !error,
        error,
      },
      MINIMAL,
    );
  }
}

return [{ json: { valid: true, results } }];

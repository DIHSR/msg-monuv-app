// Processa eventos da Meta (roda DEPOIS do 200 já ter sido respondido).
const { valid, reason, payload } = $input.first().json;

// Assinatura inválida: só registra (sem processar nada)
if (!valid) {
  await sb(
    'POST',
    '/rest/v1/webhook_events',
    { signature_valid: false, object: payload && payload.object, payload, processed: false, error: reason },
    { Prefer: 'return=minimal' },
  );
  return [{ json: { valid: false, reason } }];
}

const accountsByWaba = {};
async function accountFor({ wabaId, phoneNumberId }) {
  const key = phoneNumberId ? `p:${phoneNumberId}` : `w:${wabaId}`;
  if (key in accountsByWaba) return accountsByWaba[key];
  const filter = phoneNumberId ? `phone_number_id=eq.${encodeURIComponent(phoneNumberId)}` : `waba_id=eq.${encodeURIComponent(wabaId)}`;
  const rows = await sb('GET', `/rest/v1/wa_accounts?${filter}&select=id,user_id,waba_id,display_phone_number&limit=1`);
  accountsByWaba[key] = rows[0] || null;
  return accountsByWaba[key];
}

const results = [];

for (const entry of (payload && payload.entry) || []) {
  const wabaId = String(entry.id || '');
  for (const change of entry.changes || []) {
    const field = change.field;
    const value = change.value || {};
    let error = null;
    let acc = null;

    try {
      acc = await accountFor({ wabaId, phoneNumberId: value.metadata && value.metadata.phone_number_id });

      if (field === 'messages') {
        // status de mensagens enviadas
        for (const s of value.statuses || []) {
          const r = await rpc('apply_message_status', {
            p_wa_message_id: s.id,
            p_status: s.status,
            p_occurred_at: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString(),
            p_payload: s,
          });
          results.push({ type: 'status', id: s.id, status: s.status, r });
        }
        // mensagens recebidas
        if (acc && Array.isArray(value.messages) && value.messages.length) {
          const contacts = value.contacts || [];
          await sb(
            'POST',
            '/rest/v1/messages?on_conflict=wa_message_id',
            value.messages.map((m) => {
              const c = contacts.find((x) => x.wa_id === m.from);
              const text =
                (m.text && m.text.body) ||
                (m.button && m.button.text) ||
                (m.interactive && JSON.stringify(m.interactive)) ||
                `[${m.type}]`;
              return {
                user_id: acc.user_id,
                wa_account_id: acc.id,
                direction: 'inbound',
                from_number: m.from,
                to_number: value.metadata && value.metadata.display_phone_number,
                type: m.type,
                body_preview: (c && c.profile && c.profile.name ? `${c.profile.name}: ` : '') + String(text).slice(0, 4000),
                response_payload: m,
                wa_message_id: m.id,
                status: 'received',
                created_at: new Date(m.timestamp ? Number(m.timestamp) * 1000 : Date.now()).toISOString(),
              };
            }),
            { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          );
          results.push({ type: 'inbound', count: value.messages.length });
        }
      } else if (field === 'message_template_status_update') {
        const patch = { status: value.event };
        patch.rejected_reason = value.reason && value.reason !== 'NONE' ? value.reason : null;
        await sb('PATCH', `/rest/v1/templates?meta_template_id=eq.${encodeURIComponent(String(value.message_template_id))}`, patch, {
          Prefer: 'return=minimal',
        });
        results.push({ type: 'template_status', id: value.message_template_id, status: value.event });
      } else if (field === 'message_template_quality_update') {
        await sb(
          'PATCH',
          `/rest/v1/templates?meta_template_id=eq.${encodeURIComponent(String(value.message_template_id))}`,
          { quality_score: value.new_quality_score || null },
          { Prefer: 'return=minimal' },
        );
        results.push({ type: 'template_quality', id: value.message_template_id });
      } else if (field === 'account_update' && value.event === 'PARTNER_REMOVED' && wabaId) {
        // cliente removeu o app na Meta → marca contas da WABA como desconectadas
        await sb('PATCH', `/rest/v1/wa_accounts?waba_id=eq.${encodeURIComponent(wabaId)}`, { status: 'disconnected', webhook_subscribed: false }, {
          Prefer: 'return=minimal',
        });
        results.push({ type: 'partner_removed', waba_id: wabaId });
      }
    } catch (e) {
      error = String((e && e.message) || e);
    }

    await sb(
      'POST',
      '/rest/v1/webhook_events',
      {
        signature_valid: true,
        object: payload.object,
        field,
        waba_id: wabaId || null,
        user_id: acc ? acc.user_id : null,
        payload: { entry_id: entry.id, change },
        processed: !error,
        error,
      },
      { Prefer: 'return=minimal' },
    );
  }
}

return [{ json: { valid: true, results } }];

// Envia um lote de destinatários (o node "Loop" entrega N itens por vez).
const prep = $('Preparar campanha').first().json;
const camp = prep.campaign;

let ctx;
try {
  ctx = await userContext(prep.user_id, camp.wa_account_id);
} catch (e) {
  await sb(
    'PATCH',
    `/rest/v1/campaigns?id=eq.${camp.id}`,
    { status: 'failed', finished_at: new Date().toISOString() },
    { Prefer: 'return=minimal' },
  );
  throw e;
}
const acc = ctx.account;

// Campanha cancelada no meio? para de enviar.
const [current] = await sb('GET', `/rest/v1/campaigns?id=eq.${camp.id}&select=status`);
if (!current || current.status !== 'running') return [];

const out = [];
for (const item of $input.all()) {
  const r = item.json;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: onlyDigits(r.to_number),
    type: 'template',
    template: buildTemplate(camp.template_name, camp.template_language, r.params || {}),
  };

  try {
    const [msg] = await sb('POST', '/rest/v1/messages', {
      user_id: prep.user_id,
      wa_account_id: acc.id,
      campaign_id: camp.id,
      direction: 'outbound',
      to_number: payload.to,
      from_number: acc.display_phone_number,
      type: 'template',
      template_name: camp.template_name,
      template_language: camp.template_language,
      request_payload: payload,
      status: 'pending',
    });

    const g = await graph('POST', `/${acc.phone_number_id}/messages`, { token: ctx.token, body: payload });
    const sent = g.ok && g.response && g.response.messages && g.response.messages[0];

    await sb(
      'PATCH',
      `/rest/v1/messages?id=eq.${msg.id}`,
      {
        response_payload: g.response,
        http_status: g.http_status,
        wa_message_id: sent ? sent.id : null,
        status: sent ? 'accepted' : 'failed',
        error: sent ? null : metaError(g.response),
      },
      { Prefer: 'return=minimal' },
    );
    if (sent) await rpc('attach_message_events', { p_message_id: msg.id });

    await sb(
      'PATCH',
      `/rest/v1/campaign_recipients?id=eq.${r.id}`,
      {
        status: sent ? 'sent' : 'failed',
        message_id: msg.id,
        wa_message_id: sent ? sent.id : null,
        error: sent ? null : metaError(g.response),
        processed_at: new Date().toISOString(),
      },
      { Prefer: 'return=minimal' },
    );
    out.push({ json: { id: r.id, ok: !!sent } });
  } catch (e) {
    // erro inesperado (rede/Supabase): marca o destinatário e segue o lote
    await sb(
      'PATCH',
      `/rest/v1/campaign_recipients?id=eq.${r.id}`,
      { status: 'failed', error: { message: String((e && e.message) || e) }, processed_at: new Date().toISOString() },
      { Prefer: 'return=minimal' },
    ).catch(() => {});
    out.push({ json: { id: r.id, ok: false } });
  }
}

await rpc('refresh_campaign_counters', { p_campaign_id: camp.id });
return out;

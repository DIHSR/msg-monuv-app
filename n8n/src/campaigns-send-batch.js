// Envia um lote de destinatários (o node "Loop" entrega N itens por vez).
const prep = $('Preparar campanha').first().json;
const camp = prep.campaign;

async function markCampaign(status) {
  await sb('PATCH', `/rest/v1/campaigns?id=eq.${camp.id}`, { status, finished_at: new Date().toISOString() }, MINIMAL);
}

async function markRecipient(id, fields) {
  await sb('PATCH', `/rest/v1/campaign_recipients?id=eq.${id}`, { ...fields, processed_at: new Date().toISOString() }, MINIMAL);
}

let ctx;
try {
  ctx = await userContext(prep.user_id, camp.wa_account_id);
} catch (e) {
  await markCampaign('failed');
  throw e;
}

// Campanha cancelada no meio? para de enviar.
const [current] = await sb('GET', `/rest/v1/campaigns?id=eq.${camp.id}&select=status`);
if (!current || current.status !== 'running') return [];

const out = [];
for (const item of $input.all()) {
  const r = item.json;
  try {
    const s = await sendTemplateMessage({
      userId: prep.user_id,
      account: ctx.account,
      token: ctx.token,
      to: onlyDigits(r.to_number),
      templateName: camp.template_name,
      language: camp.template_language,
      params: r.params,
      campaignId: camp.id,
    });
    if (s.limited || s.reserveError) {
      await markRecipient(r.id, { status: 'failed', error: { code: s.reserveError } });
    } else {
      await markRecipient(r.id, {
        status: s.sent ? 'sent' : 'failed',
        message_id: s.messageId,
        wa_message_id: s.waMessageId,
        error: s.error,
      });
    }
    out.push({ json: { id: r.id, ok: !!s.sent } });
  } catch (e) {
    // erro inesperado (rede/Supabase): marca o destinatário e segue o lote
    await markRecipient(r.id, { status: 'failed', error: { message: String((e && e.message) || e) } }).catch(() => {});
    out.push({ json: { id: r.id, ok: false } });
  }
}

await rpc('refresh_campaign_counters', { p_campaign_id: camp.id });
return out;

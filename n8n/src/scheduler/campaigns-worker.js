// Agendador (1x/min): processa a fila de campanhas em lotes até o orçamento de tempo.
// Cada lote é reservado no banco com SKIP LOCKED (claim_campaign_batch), então execuções
// sobrepostas não enviam o mesmo destinatário duas vezes, e um crash no meio é retomado.
// A consulta a cada minuto também mantém o Supabase (plano Free) ativo.
const BUDGET_MS = 45000; // < intervalo do agendador e < timeout do task runner
const BATCH_SIZE = 20;
const startedAt = Date.now();
const contexts = {};
const summary = { batches: 0, sent: 0, failed: 0 };

async function markRecipient(id, fields) {
  await sb('PATCH', `/rest/v1/campaign_recipients?id=eq.${id}`, { ...fields, processed_at: new Date().toISOString() }, MINIMAL);
}

/** Campanha sem condição de envio (plano expirado, conta desconectada, demo): falha o lote e a campanha. */
async function failCampaign(camp, recipients, reason) {
  for (const r of recipients) await markRecipient(r.id, { status: 'failed', error: { code: reason } });
  await sb('PATCH', `/rest/v1/campaigns?id=eq.${camp.id}`, { status: 'failed', finished_at: new Date().toISOString() }, MINIMAL);
  await rpc('refresh_campaign_counters', { p_campaign_id: camp.id });
}

async function contextFor(camp) {
  if (!(camp.id in contexts)) {
    try {
      const ctx = await userContext(camp.user_id, camp.wa_account_id);
      contexts[camp.id] = ctx.is_demo ? { error: 'demo' } : ctx;
    } catch (e) {
      contexts[camp.id] = { error: (e && e.code) || 'context_error' };
    }
  }
  return contexts[camp.id];
}

async function sendOne(camp, ctx, r) {
  try {
    const s = await sendTemplateMessage({
      userId: camp.user_id,
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
      return false;
    }
    await markRecipient(r.id, { status: s.sent ? 'sent' : 'failed', message_id: s.messageId, wa_message_id: s.waMessageId, error: s.error });
    return s.sent;
  } catch (e) {
    // erro inesperado: marca o destinatário e segue o lote
    await markRecipient(r.id, { status: 'failed', error: { message: String((e && e.message) || e) } }).catch(() => {});
    return false;
  }
}

while (Date.now() - startedAt < BUDGET_MS) {
  const batch = await rpc('claim_campaign_batch', { p_limit: BATCH_SIZE });
  if (!batch || !batch.campaign) break;
  const camp = batch.campaign;
  summary.batches++;

  const ctx = await contextFor(camp);
  if (ctx.error) {
    await failCampaign(camp, batch.recipients, ctx.error);
    summary.failed += batch.recipients.length;
    continue;
  }

  for (const r of batch.recipients) {
    if (await sendOne(camp, ctx, r)) summary.sent++;
    else summary.failed++;
  }
  await rpc('refresh_campaign_counters', { p_campaign_id: camp.id });
}

return [{ json: { ...summary, ms: Date.now() - startedAt } }];

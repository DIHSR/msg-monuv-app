// action "campaigns.start" — coloca a campanha na fila; o Agendador envia em lotes.
// body: { campaign_id }
const { user, body } = $input.first().json; // vindo do Roteador (já autenticado)

try {
  const campaignId = String(body.campaign_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) throw new HttpError(400, 'bad_request', 'campaign_id inválido.');

  const [camp] = await sb('GET', `/rest/v1/campaigns?id=eq.${campaignId}&user_id=eq.${user.id}&select=id,wa_account_id,status`);
  if (!camp) throw new HttpError(404, 'not_found', 'Campanha não encontrada.');
  if (camp.status !== 'draft') throw new HttpError(409, 'invalid_state', `Campanha já está em "${camp.status}".`);

  const ctx = await userContext(user.id, camp.wa_account_id);
  if (ctx.is_demo) throw new HttpError(403, 'demo', 'Envio em lote indisponível na conta de demonstração.');

  // total calculado no servidor (o front não grava contadores)
  const recipients = await sb('GET', `/rest/v1/campaign_recipients?campaign_id=eq.${campaignId}&select=id&limit=50000`);

  // draft → queued atômico: só uma requisição consegue enfileirar
  const queued = await sb('PATCH', `/rest/v1/campaigns?id=eq.${campaignId}&status=eq.draft`, {
    status: 'queued',
    total: recipients.length,
  });
  if (!queued.length) throw new HttpError(409, 'invalid_state', 'Campanha já foi iniciada.');

  return respond(202, { ok: true, data: { campaign_id: campaignId, total: recipients.length, status: 'queued' } });
} catch (e) {
  return handleError(e);
}

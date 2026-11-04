// POST monuv/campaigns-start — valida e marca a campanha como "running".
// A resposta HTTP sai logo depois deste node; o envio continua em background no loop.
// body: { campaign_id }
const req = $input.first().json;

try {
  const user = await authUser(req);
  const campaignId = String((req.body || {}).campaign_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) throw new HttpError(400, 'bad_request', 'campaign_id inválido.');

  const [camp] = await sb('GET', `/rest/v1/campaigns?id=eq.${campaignId}&user_id=eq.${user.id}&select=*`);
  if (!camp) throw new HttpError(404, 'not_found', 'Campanha não encontrada.');
  if (camp.status !== 'draft') throw new HttpError(409, 'invalid_state', `Campanha já está em "${camp.status}".`);

  const ctx = await userContext(user.id, camp.wa_account_id);
  if (ctx.is_demo) throw new HttpError(403, 'demo', 'Envio em lote indisponível na conta de demonstração.');

  await sb(
    'PATCH',
    `/rest/v1/campaigns?id=eq.${campaignId}`,
    { status: 'running', started_at: new Date().toISOString() },
    { Prefer: 'return=minimal' },
  );

  return [
    {
      json: {
        status: 202,
        body: { ok: true, data: { campaign_id: campaignId, total: camp.total } },
        proceed: true,
        campaign: camp,
        user_id: user.id,
      },
    },
  ];
} catch (e) {
  return handleError(e);
}

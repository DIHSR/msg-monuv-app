// Finaliza a campanha quando o loop termina.
const prep = $('Preparar campanha').first().json;
if (!prep.proceed) return [];

await rpc('refresh_campaign_counters', { p_campaign_id: prep.campaign.id });
const [camp] = await sb('GET', `/rest/v1/campaigns?id=eq.${prep.campaign.id}&select=status,sent_count,failed_count,total`);
if (camp && camp.status === 'running') {
  await sb(
    'PATCH',
    `/rest/v1/campaigns?id=eq.${prep.campaign.id}`,
    { status: camp.sent_count === 0 && camp.failed_count > 0 ? 'failed' : 'completed', finished_at: new Date().toISOString() },
    { Prefer: 'return=minimal' },
  );
}
return [{ json: { campaign_id: prep.campaign.id, ...camp } }];

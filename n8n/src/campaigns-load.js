// Carrega os destinatários pendentes como itens (1 item = 1 destinatário).
const prep = $input.first().json;
if (!prep.proceed) return [];

const items = [];
const pageSize = 1000;
for (let offset = 0; offset < 50000; offset += pageSize) {
  const rows = await sb(
    'GET',
    `/rest/v1/campaign_recipients?campaign_id=eq.${prep.campaign.id}&status=eq.pending&select=id,to_number,params&order=created_at.asc&limit=${pageSize}&offset=${offset}`,
  );
  for (const r of rows) items.push({ json: r });
  if (rows.length < pageSize) break;
}

if (!items.length) {
  await sb(
    'PATCH',
    `/rest/v1/campaigns?id=eq.${prep.campaign.id}`,
    { status: 'completed', finished_at: new Date().toISOString() },
    { Prefer: 'return=minimal' },
  );
}
return items;

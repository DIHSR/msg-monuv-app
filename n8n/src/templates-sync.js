// POST monuv/templates-sync — traz todos os templates da WABA para o Supabase
// body: { wa_account_id }
const req = $input.first().json;

try {
  const user = await authUser(req);
  const ctx = await userContext(user.id, (req.body || {}).wa_account_id);
  const acc = ctx.account;

  const fields = 'id,name,language,status,category,components,rejected_reason,quality_score,parameter_format';
  const all = [];
  let first = null;
  let after = null;
  for (let page = 0; page < 20; page++) {
    const qs = { fields, limit: '100' };
    if (after) qs.after = after;
    const g = await graph('GET', `/${acc.waba_id}/message_templates`, { token: ctx.token, qs });
    if (!first) first = g;
    if (!g.ok) {
      return respond(502, {
        ok: false,
        error: { code: 'meta_error', message: (metaError(g.response) || {}).message || 'Erro ao listar templates' },
        request: g.request,
        response: g.response,
        http_status: g.http_status,
      });
    }
    all.push(...(g.response.data || []));
    after = g.response.paging && g.response.paging.next && g.response.paging.cursors ? g.response.paging.cursors.after : null;
    if (!after) break;
  }

  const now = new Date().toISOString();
  if (all.length) {
    await sb(
      'POST',
      '/rest/v1/templates?on_conflict=wa_account_id,name,language',
      all.map((t) => ({
        user_id: user.id,
        wa_account_id: acc.id,
        meta_template_id: String(t.id),
        name: t.name,
        language: t.language,
        category: t.category || null,
        status: t.status || null,
        parameter_format: t.parameter_format || null,
        components: t.components || [],
        rejected_reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
        quality_score: t.quality_score ? t.quality_score.score || null : null,
        synced_at: now,
      })),
      { Prefer: 'resolution=merge-duplicates,return=minimal' },
    );
    const ids = all.map((t) => `"${t.id}"`).join(',');
    await sb('DELETE', `/rest/v1/templates?wa_account_id=eq.${acc.id}&meta_template_id=not.in.(${ids})`, undefined, {
      Prefer: 'return=minimal',
    });
  } else {
    await sb('DELETE', `/rest/v1/templates?wa_account_id=eq.${acc.id}`, undefined, { Prefer: 'return=minimal' });
  }

  return respond(200, {
    ok: true,
    data: { count: all.length },
    request: first.request,
    response: first.response,
    http_status: first.http_status,
  });
} catch (e) {
  return handleError(e);
}

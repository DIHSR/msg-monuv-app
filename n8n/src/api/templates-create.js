// action "templates.create" — cria template na WABA
// body: { wa_account_id, template: { name, language, category, components, parameter_format? } }
const { user, body } = $input.first().json; // vindo do Roteador (já autenticado)

try {
  const ctx = await userContext(user.id, body.wa_account_id);
  const acc = ctx.account;
  const t = body.template || {};

  if (!/^[a-z0-9_]{1,512}$/.test(t.name || '')) throw new HttpError(400, 'bad_request', 'Nome de template inválido.');
  if (!['UTILITY', 'MARKETING', 'AUTHENTICATION'].includes(t.category)) throw new HttpError(400, 'bad_request', 'Categoria inválida.');
  if (!t.language || !Array.isArray(t.components)) throw new HttpError(400, 'bad_request', 'Idioma e componentes são obrigatórios.');

  const payload = {
    name: t.name,
    language: t.language,
    category: t.category,
    components: t.components,
  };
  if (t.parameter_format) payload.parameter_format = t.parameter_format;

  const g = await graph('POST', `/${acc.waba_id}/message_templates`, { token: ctx.token, body: payload });

  if (g.ok && g.response && g.response.id) {
    await sb(
      'POST',
      '/rest/v1/templates?on_conflict=wa_account_id,name,language',
      {
        user_id: user.id,
        wa_account_id: acc.id,
        meta_template_id: String(g.response.id),
        name: t.name,
        language: t.language,
        category: g.response.category || t.category,
        status: g.response.status || 'PENDING',
        parameter_format: t.parameter_format || 'POSITIONAL',
        components: t.components,
        rejected_reason: null,
        last_request: g.request,
        last_response: g.response,
        synced_at: new Date().toISOString(),
      },
      { Prefer: 'resolution=merge-duplicates,return=minimal' },
    );
    return respond(200, { ok: true, request: g.request, response: g.response, http_status: g.http_status, data: g.response });
  }

  const me = metaError(g.response) || {};
  return respond(422, {
    ok: false,
    error: { code: 'meta_error', message: me.message || 'A Meta recusou o template.' },
    request: g.request,
    response: g.response,
    http_status: g.http_status,
  });
} catch (e) {
  return handleError(e);
}

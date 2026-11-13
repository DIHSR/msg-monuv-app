// action "connection.disconnect" — desconecta um número do Monuv
// body: { wa_account_id }
//
// 1) Se nenhuma outra conexão ativa usa a mesma WABA, remove a inscrição do app
//    (DELETE /{waba_id}/subscribed_apps): a Meta para de mandar webhooks dessa WABA.
// 2) Marca a conexão como "disconnected" e apaga token e PIN (Vault). Reconectar exige um novo Embedded Signup.
// NÃO chama /deregister: em coexistência isso tiraria o número do app WhatsApp Business do celular.
const { user, body } = $input.first().json; // vindo do Roteador (já autenticado)

try {
  const ctx = await userContext(user.id, body.wa_account_id);
  if (ctx.is_demo) throw new HttpError(403, 'demo', 'A conta de demonstração não pode ser desconectada.');
  const acc = ctx.account;

  const others = await sb(
    'GET',
    `/rest/v1/wa_accounts?waba_id=eq.${encodeURIComponent(acc.waba_id)}&id=neq.${acc.id}&status=neq.disconnected&select=id`,
  );
  const unsub = others.length ? null : await graph('DELETE', `/${acc.waba_id}/subscribed_apps`, { token: ctx.token });

  const rows = await sb('PATCH', `/rest/v1/wa_accounts?id=eq.${acc.id}`, {
    status: 'disconnected',
    webhook_subscribed: false,
    disconnected_at: new Date().toISOString(),
    inactivity_alert_at: null,
    last_error: { event: 'DISCONNECTED_BY_USER' },
  });
  await sb('DELETE', `/rest/v1/wa_credentials?wa_account_id=eq.${acc.id}`, undefined, MINIMAL);
  await sb('POST', '/rest/v1/wa_account_events', {
    wa_account_id: acc.id,
    user_id: user.id,
    field: 'monuv',
    event: 'DISCONNECTED_BY_USER',
    payload: { unsubscribed_app: !!(unsub && unsub.ok), shared_waba: others.length > 0 },
  }, MINIMAL);

  return respond(200, {
    ok: true,
    data: { account: rows[0], unsubscribed_app: !!(unsub && unsub.ok), shared_waba: others.length > 0 },
    request: unsub ? unsub.request : null,
    response: unsub ? unsub.response : { note: 'Outra conexão usa a mesma WABA: a inscrição do app foi mantida.' },
    http_status: unsub ? unsub.http_status : null,
  });
} catch (e) {
  return handleError(e);
}

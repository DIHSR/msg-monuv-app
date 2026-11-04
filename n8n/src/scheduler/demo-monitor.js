// Agendador (a cada 12h): testa o login do usuário demo e se ele ainda tem número e token.
// Falha a execução de propósito quando algo quebra → aparece em Executions / Error Workflow.
// (O Supabase Free já fica ativo pelo worker de campanhas, que consulta o banco 1x/min.)
// Variáveis: MONUV_SUPABASE_ANON_KEY, MONUV_DEMO_EMAIL, MONUV_DEMO_PASSWORD (opcionais para o teste de login).
const report = { at: new Date().toISOString() };

// 1) consulta simples ao banco
const rows = await sb('GET', '/rest/v1/profiles?select=id&limit=1');
report.db = Array.isArray(rows) ? 'ok' : 'unexpected';

// 2) login do demo (Auth)
if ($env.MONUV_DEMO_EMAIL && $env.MONUV_DEMO_PASSWORD && $env.MONUV_SUPABASE_ANON_KEY) {
  const r = await http({
    method: 'POST',
    url: `${ENV.SUPABASE_URL}/auth/v1/token?grant_type=password`,
    headers: { apikey: $env.MONUV_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: { email: $env.MONUV_DEMO_EMAIL, password: $env.MONUV_DEMO_PASSWORD },
  });
  report.demo_login = r.status === 200 ? 'ok' : `falhou (${r.status})`;
  if (r.status !== 200) {
    // falha a execução de propósito → aparece em Executions / dispara o Error Workflow
    throw new Error(`Login do usuário demo falhou: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  }

  // 3) a conta demo ainda tem número conectado e token?
  const userId = r.body.user && r.body.user.id;
  if (userId) {
    const ctx = await rpc('n8n_user_context', { p_user_id: userId, p_wa_account_id: null });
    report.demo_can_use_app = ctx.can_use_app;
    report.demo_has_account = !!ctx.account;
    report.demo_has_token = !!ctx.token;
    if (!ctx.can_use_app) throw new Error('Usuário demo sem acesso (can_use_app=false). Verifique o profile.');
  }
}

return [{ json: report }];

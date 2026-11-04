// Regressões da auditoria de segurança (run-1). Executa o código real dos Code nodes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ENV, httpMock, is, nodeCode, ok, runNode, sign, workflow } from './code-node.mjs'

const auth = [is('GET', '/auth/v1/user'), ok({ id: 'user-A' })]
const ctxNoAccount = [is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: true, account: null, token: null })]
const req = (body) => [{ json: { headers: { authorization: 'Bearer jwt' }, body } }]

// ---------------------------------------------------------------- es-exchange
const esCode = nodeCode('monuv-es-exchange.json', 'Processar')
const esRoutes = ({ targetIds = ['WABA_A'], phones = ['PN_A'], existing = [], claim = { ok: true, account: { id: 'acc-1', status: 'connected' } } } = {}) => [
  auth,
  ctxNoAccount,
  [is('GET', '/oauth/access_token'), ok({ access_token: 'TOKEN_A' })],
  [is('GET', '/debug_token'), ok({ data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: targetIds }] } })],
  [is('GET', '/phone_numbers'), ok({ data: phones.map((id) => ({ id })) })],
  [is('GET', '/rest/v1/wa_accounts'), ok(existing)],
  [is('POST', '/subscribed_apps'), ok({ success: true })],
  [is('POST', '/register'), ok({ success: true })],
  [is('POST', '/rpc/claim_wa_account'), ok(claim)],
  [is('POST', '/rpc/wa_store_secret'), ok('secret-id')],
  [(o) => o.method === 'GET' && o.url.includes('graph.facebook.com'), ok({ name: 'x' })],
]
const sideEffects = (calls) => calls.filter((c) => /subscribed_apps|\/register|claim_wa_account|wa_store_secret/.test(c.url))

test('es-exchange recusa phone_number_id que não pertence à WABA concedida, sem efeitos colaterais', async () => {
  const m = httpMock(esRoutes())
  const [o] = await runNode(esCode, { items: req({ code: 'c', waba_id: 'WABA_A', phone_number_id: 'PN_VICTIM' }), helpers: m.helpers })
  assert.equal(o.json.status, 403)
  assert.equal(o.json.body.error.code, 'phone_not_granted')
  assert.deepEqual(sideEffects(m.calls), [])
})

test('es-exchange falha fechado quando debug_token não traz WABAs concedidas', async () => {
  const m = httpMock(esRoutes({ targetIds: [] }))
  const [o] = await runNode(esCode, { items: req({ code: 'c', waba_id: 'WABA_ANY', phone_number_id: 'PN_A' }), helpers: m.helpers })
  assert.equal(o.json.status, 403)
  assert.equal(o.json.body.error.code, 'waba_not_granted')
  assert.deepEqual(sideEffects(m.calls), [])
})

test('es-exchange recusa número já de outro tenant ANTES de assinar/registrar na Meta', async () => {
  const m = httpMock(esRoutes({ existing: [{ id: 'x', user_id: 'user-B' }] }))
  const [o] = await runNode(esCode, { items: req({ code: 'c', waba_id: 'WABA_A', phone_number_id: 'PN_A' }), helpers: m.helpers })
  assert.equal(o.json.status, 409)
  assert.deepEqual(sideEffects(m.calls), [])
})

test('es-exchange conecta número concedido via claim atômico e guarda o token', async () => {
  const m = httpMock(esRoutes())
  const [o] = await runNode(esCode, { items: req({ code: 'c', waba_id: 'WABA_A', phone_number_id: 'PN_A' }), helpers: m.helpers })
  assert.equal(o.json.status, 200, JSON.stringify(o.json.body))
  const order = m.calls.map((c) => c.url.replace(/^https?:\/\/[^/]+/, '')).filter((u) => /phone_numbers|wa_accounts|subscribed_apps|register|claim/.test(u))
  assert.ok(order.findIndex((u) => u.includes('phone_numbers')) < order.findIndex((u) => u.includes('subscribed_apps')))
  assert.ok(order.findIndex((u) => u.includes('wa_accounts')) < order.findIndex((u) => u.includes('subscribed_apps')))
  const claim = m.calls.find((c) => c.url.includes('/rpc/claim_wa_account'))
  assert.equal(claim.body.p_user_id, 'user-A')
  assert.equal(claim.body.p_row.phone_number_id, 'PN_A')
  assert.ok(!JSON.stringify(o.json.body).includes('TOKEN_A'), 'token não pode voltar ao navegador')
})

test('es-exchange devolve 409 se o claim atômico perder a corrida', async () => {
  const m = httpMock(esRoutes({ claim: { ok: false, error: 'phone_in_use' } }))
  const [o] = await runNode(esCode, { items: req({ code: 'c', waba_id: 'WABA_A', phone_number_id: 'PN_A' }), helpers: m.helpers })
  assert.equal(o.json.status, 409)
  assert.ok(!m.calls.some((c) => c.url.includes('wa_store_secret')))
})

test('es-exchange não devolve o PIN de registro na resposta', async () => {
  const m = httpMock(esRoutes())
  const [o] = await runNode(esCode, { items: req({ code: 'c', waba_id: 'WABA_A', phone_number_id: 'PN_A' }), helpers: m.helpers })
  const reg = m.calls.find((c) => c.url.includes('/register'))
  assert.ok(!JSON.stringify(o.json.body).includes(reg.body.pin))
})

// ---------------------------------------------------------------- webhook
const procCode = nodeCode('monuv-meta-webhook.json', 'Processar eventos')
const sigCode = nodeCode('monuv-meta-webhook.json', 'Validar assinatura')

test('webhook não atribui mensagem a tenant cuja WABA difere do envelope assinado', async () => {
  const m = httpMock([[is('GET', '/rest/v1/wa_accounts'), ok([{ id: 'acc-B', user_id: 'user-B', waba_id: 'WABA_B' }])]])
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA_A', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'PN_A2' }, messages: [{ from: '5511', id: 'wamid.IN', type: 'text', text: { body: 'oi' } }] } }] }],
  }
  await runNode(procCode, { items: [{ json: { valid: true, payload } }], helpers: m.helpers })
  assert.ok(!m.calls.some((c) => c.method === 'POST' && c.url.includes('/rest/v1/messages')), 'mensagem não pode ir para B')
  const ev = m.calls.find((c) => c.url.includes('/rest/v1/webhook_events'))
  assert.equal(ev.body.user_id, null)
})

test('webhook com assinatura inválida não persiste o corpo enviado pelo atacante', async () => {
  const raw = Buffer.from(JSON.stringify({ object: 'x', junk: 'A'.repeat(1000) }))
  const [sig] = await runNode(sigCode, {
    items: [{ json: { headers: { 'x-hub-signature-256': 'sha256=00' }, body: {} } }],
    helpers: { getBinaryDataBuffer: async () => raw },
  })
  const m = httpMock([])
  await runNode(procCode, { items: [{ json: sig.json }], helpers: m.helpers })
  const ev = m.calls.find((c) => c.url.includes('/rest/v1/webhook_events'))
  assert.equal(ev.body.signature_valid, false)
  assert.equal(ev.body.payload.size, raw.length)
  assert.match(ev.body.payload.sha256, /^[0-9a-f]{64}$/)
  assert.ok(!JSON.stringify(ev.body).includes('AAAA'))
})

test('webhook atualiza status de template só nas contas da WABA do envelope', async () => {
  const m = httpMock([[is('GET', '/rest/v1/wa_accounts'), ok([{ id: 'acc-A', user_id: 'user-A', waba_id: 'WABA_A' }])]])
  const payload = { object: 'whatsapp_business_account', entry: [{ id: 'WABA_A', changes: [{ field: 'message_template_status_update', value: { event: 'APPROVED', message_template_id: 77 } }] }] }
  await runNode(procCode, { items: [{ json: { valid: true, payload } }], helpers: m.helpers })
  const patch = m.calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/templates'))
  assert.match(patch.url, /meta_template_id=eq\.77/)
  assert.match(patch.url, /wa_account_id=in\.\(acc-A\)/)
})

// ---------------------------------------------------------------- envio
const sendCode = nodeCode('monuv-messages-send.json', 'Processar')
const ctxDemo = [is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: true, daily_send_limit: 1, sends_today: 0, token: 'TKN', account: { id: 'acc-1', phone_number_id: 'PN1' } })]

test('messages-send reserva a cota de forma atômica e devolve 429 sem chamar a Meta', async () => {
  const m = httpMock([auth, ctxDemo, [is('POST', '/rpc/reserve_outbound_message'), ok({ ok: false, error: 'daily_limit', daily_send_limit: 1 })]])
  const [o] = await runNode(sendCode, { items: req({ wa_account_id: 'acc-1', to: '5511999990000', template_name: 't', language: 'pt_BR' }), helpers: m.helpers })
  assert.equal(o.json.status, 429)
  assert.ok(!m.calls.some((c) => c.url.includes('graph.facebook.com')))
  assert.ok(!m.calls.some((c) => c.method === 'POST' && c.url.endsWith('/rest/v1/messages')), 'insert direto foi substituído pela reserva')
})

// ---------------------------------------------------------------- campanhas
const prepCode = nodeCode('monuv-campaigns-start.json', 'Preparar campanha')

test('campaigns-start só inicia se a transição draft→running ocorrer (sem envio duplicado)', async () => {
  const camp = { id: '11111111-1111-1111-1111-111111111111', wa_account_id: 'acc-1', status: 'draft', user_id: 'user-A' }
  const m = httpMock([
    auth,
    [is('GET', '/rest/v1/campaigns'), ok([camp])],
    [is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: true, is_demo: false, token: 't', account: { id: 'acc-1' } })],
    [is('GET', '/rest/v1/campaign_recipients'), ok([{ id: 'r1' }, { id: 'r2' }])],
    [is('PATCH', '/rest/v1/campaigns'), ok([])], // outra execução já iniciou
  ])
  const [o] = await runNode(prepCode, { items: req({ campaign_id: camp.id }), helpers: m.helpers })
  const patch = m.calls.find((c) => c.method === 'PATCH')
  assert.match(patch.url, /status=eq\.draft/)
  assert.equal(o.json.status, 409)
  assert.notEqual(o.json.proceed, true)
})

// ---------------------------------------------------------------- erros e build
const refreshCode = nodeCode('monuv-connection-refresh.json', 'Processar')

test('erros internos não expõem detalhes do Supabase ao navegador', async () => {
  const m = httpMock([auth, [is('POST', '/rpc/n8n_user_context'), { statusCode: 500, body: { message: 'relation "x" secret detail' } }]])
  const [o] = await runNode(refreshCode, { items: req({ wa_account_id: 'acc-1' }), helpers: m.helpers })
  assert.equal(o.json.status, 500)
  assert.ok(!JSON.stringify(o.json.body).includes('secret detail'))
  assert.equal(o.json.body.error.ref, 'exec-1')
})

test('workflows: webhook da Meta não guarda execuções bem-sucedidas; CORS padrão sem localhost', async () => {
  assert.equal(workflow('monuv-meta-webhook.json').settings.saveDataSuccessExecution, 'none')
  for (const f of ['monuv-messages-send.json', 'monuv-es-exchange.json']) {
    const wh = workflow(f).nodes.find((n) => n.type === 'n8n-nodes-base.webhook')
    assert.ok(!wh.parameters.options.allowedOrigins.includes('localhost'), f)
  }
})

test('verificação GET continua aceitando só o verify token configurado', async () => {
  const code = nodeCode('monuv-meta-webhook.json', 'Verificar token')
  const q = (t) => [{ json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': t, 'hub.challenge': '9' } } }]
  assert.equal((await runNode(code, { items: q(ENV.MONUV_META_VERIFY_TOKEN) }))[0].json.status, 200)
  assert.equal((await runNode(code, { items: q('verifica-12') }))[0].json.status, 403)
  assert.equal((await runNode(code, { items: q(['verifica-123']) }))[0].json.status, 403)
  void sign
})

// Coexistência (app WhatsApp Business + Cloud API no mesmo número). Executa o código real dos Code nodes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ENV, httpMock, is, nodeCode, ok, routed, runNode } from './code-node.mjs'

const esCode = nodeCode('es.exchange')
const procCode = nodeCode('Processar eventos')

const esRoutes = ({ phone = {}, phoneOk = true } = {}) => [
  [is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: true, account: null, token: null })],
  [is('GET', '/oauth/access_token'), ok({ access_token: 'TOKEN_A' })],
  [is('GET', '/debug_token'), ok({ data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA_A'] }] } })],
  [is('GET', '/phone_numbers'), ok({ data: [{ id: 'PN_A' }] })],
  [is('GET', '/rest/v1/wa_accounts'), ok([])],
  [is('POST', '/subscribed_apps'), ok({ success: true })],
  [is('POST', '/register'), ok({ success: true })],
  [is('POST', '/smb_app_data'), ok({ messaging_product: 'whatsapp', request_id: 'REQ' })],
  [is('POST', '/rpc/claim_wa_account'), (o) => ok({ ok: true, account: { id: 'acc-1', status: o.body.p_row.status, is_on_biz_app: o.body.p_row.is_on_biz_app } })],
  [is('POST', '/rpc/wa_store_secret'), ok('secret-id')],
  [is('PATCH', '/rest/v1/wa_accounts'), (o) => ok([{ id: 'acc-1', ...o.body }])],
  [(o) => o.method === 'GET' && o.url.endsWith('/PN_A'), phoneOk ? ok({ display_phone_number: '+55 11 99999-0000', ...phone }) : { statusCode: 400, body: { error: { message: 'x' } } }],
  [(o) => o.method === 'GET' && o.url.includes('graph.facebook.com'), ok({ name: 'WABA' })],
]
const body = (extra = {}) => routed({ code: 'c', waba_id: 'WABA_A', phone_number_id: 'PN_A', ...extra })
const urls = (calls) => calls.map((c) => c.url)

test('coexistência: não registra o número e grava is_on_biz_app', async () => {
  const m = httpMock(esRoutes({ phone: { is_on_biz_app: true, platform_type: 'CLOUD_API' } }))
  const [o] = await runNode(esCode, { items: body(), helpers: m.helpers })
  assert.equal(o.json.status, 200, JSON.stringify(o.json.body))
  assert.equal(o.json.body.coexistence, true)
  assert.ok(!urls(m.calls).some((u) => u.includes('/register')), 'número em coexistência já está registrado')
  const claim = m.calls.find((c) => c.url.includes('claim_wa_account'))
  assert.equal(claim.body.p_row.is_on_biz_app, true)
  assert.equal(claim.body.p_row.platform_type, 'CLOUD_API')
  assert.equal(claim.body.p_row.status, 'connected')
})

test('coexistência sem MONUV_COEX_SYNC: não pede contatos nem histórico', async () => {
  const m = httpMock(esRoutes({ phone: { is_on_biz_app: true } }))
  await runNode(esCode, { items: body(), helpers: m.helpers })
  assert.ok(!urls(m.calls).some((u) => u.includes('smb_app_data')))
})

test('coexistência com MONUV_COEX_SYNC=true: pede contatos e depois histórico, só após o vínculo', async () => {
  const m = httpMock(esRoutes({ phone: { is_on_biz_app: true } }))
  const [o] = await runNode(esCode, { items: body(), helpers: m.helpers, env: { ...ENV, MONUV_COEX_SYNC: 'true' } })
  const syncs = m.calls.filter((c) => c.url.includes('/PN_A/smb_app_data')).map((c) => c.body.sync_type)
  assert.deepEqual(syncs, ['smb_app_state_sync', 'history'])
  const u = urls(m.calls)
  assert.ok(u.findIndex((x) => x.includes('claim_wa_account')) < u.findIndex((x) => x.includes('smb_app_data')))
  const patch = m.calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/wa_accounts'))
  assert.ok(patch.body.coex_sync_requested_at)
  assert.ok(o.json.body.account.coex_sync_requested_at)
})

test('número só na Cloud API: registra com PIN e não pede sincronização', async () => {
  const m = httpMock(esRoutes({ phone: { is_on_biz_app: false } }))
  const [o] = await runNode(esCode, { items: body({ is_on_biz_app: true }), helpers: m.helpers, env: { ...ENV, MONUV_COEX_SYNC: 'true' } })
  assert.equal(o.json.body.coexistence, false, 'a Graph API vence a dica do navegador')
  assert.ok(urls(m.calls).some((u) => u.includes('/PN_A/register')))
  assert.ok(!urls(m.calls).some((u) => u.includes('smb_app_data')))
})

test('Graph sem detalhes do número: usa o evento do Embedded Signup como dica', async () => {
  const m = httpMock(esRoutes({ phoneOk: false }))
  const [o] = await runNode(esCode, { items: body({ event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' }), helpers: m.helpers })
  assert.equal(o.json.body.coexistence, true)
  assert.ok(!urls(m.calls).some((u) => u.includes('/register')))
})

// ---------------------------------------------------------------- webhook
const accA = [is('GET', '/rest/v1/wa_accounts'), ok([{ id: 'acc-A', user_id: 'user-A', waba_id: 'WABA_A' }])]
const meta = { display_phone_number: '5511999990000', phone_number_id: 'PN_A' }
const event = (field, value) => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA_A', changes: [{ field, value: { messaging_product: 'whatsapp', metadata: meta, ...value } }] }] })
const run = async (payload) => {
  const m = httpMock([accA])
  await runNode(procCode, { items: [{ json: { valid: true, payload } }], helpers: m.helpers })
  return m
}
const inserted = (m) => m.calls.filter((c) => c.method === 'POST' && c.url.includes('/rest/v1/messages')).flatMap((c) => c.body)
const audit = (m) => m.calls.find((c) => c.url.includes('/rest/v1/webhook_events')).body

test('smb_message_echoes: mensagem enviada pelo app vira outbound do tenant', async () => {
  const m = await run(event('smb_message_echoes', {
    message_echoes: [{ from: '5511999990000', to: '5511888880000', id: 'wamid.ECHO', timestamp: '1730000000', type: 'text', text: { body: 'enviado do celular' } }],
  }))
  const [row] = inserted(m)
  assert.equal(row.direction, 'outbound')
  assert.equal(row.wa_account_id, 'acc-A')
  assert.equal(row.to_number, '5511888880000')
  assert.equal(row.body_preview, 'enviado do celular')
  assert.equal(row.status, 'sent')
})

test('history: grava as duas direções e não duplica o lote em webhook_events', async () => {
  const m = await run(event('history', {
    history: [{
      metadata: { phase: 0, chunk_order: 1, progress: 100 },
      threads: [{
        id: '5511888880000',
        messages: [
          { from: '5511888880000', id: 'wamid.H1', timestamp: '1720000000', type: 'text', text: { body: 'oi' }, history_context: { status: 'READ' } },
          { from: '5511999990000', id: 'wamid.H2', timestamp: '1720000100', type: 'text', text: { body: 'olá!' }, history_context: { status: 'DELIVERED' } },
        ],
      }],
    }],
  }))
  const rows = inserted(m)
  assert.deepEqual(rows.map((r) => [r.direction, r.status, r.to_number]), [
    ['inbound', 'received', '5511999990000'],
    ['outbound', 'delivered', '5511888880000'],
  ])
  const ev = audit(m)
  assert.ok(!JSON.stringify(ev.payload).includes('olá!'), 'histórico não é copiado inteiro para a auditoria')
  assert.equal(ev.payload.chunks[0].messages, 2)
})

test('smb_app_state_sync: contatos não são persistidos', async () => {
  const m = await run(event('smb_app_state_sync', {
    state_sync: [{ type: 'contact', contact: { full_name: 'Fulano', phone_number: '5511777770000' }, action: 'add', metadata: { timestamp: '1' } }],
  }))
  assert.ok(!JSON.stringify(m.calls.map((c) => c.body)).includes('Fulano'))
})

for (const ev of ['PARTNER_REMOVED', 'ACCOUNT_OFFBOARDED']) {
  test(`account_update ${ev}: contas da WABA ficam desconectadas`, async () => {
    const m = await run({ object: 'whatsapp_business_account', entry: [{ id: 'WABA_A', changes: [{ field: 'account_update', value: { event: ev } }] }] })
    const patch = m.calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/wa_accounts'))
    assert.match(patch.url, /waba_id=eq\.WABA_A/)
    assert.equal(patch.body.status, 'disconnected')
  })
}

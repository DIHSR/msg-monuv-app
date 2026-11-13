// Spec v2: cifragem do token (lacuna 4), qualidade/limite (lacuna 2), desconexões e atividade (lacuna 3),
// desconectar pela tela, origem das mensagens e validações novas. Executa o código real dos Code nodes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ENV, httpMock, is, nodeCode, ok, routed, runNode } from './code-node.mjs'

const esCode = nodeCode('es.exchange')
const sendCode = nodeCode('messages.send')
const disconnectCode = nodeCode('connection.disconnect')
const refreshCode = nodeCode('connection.refresh')
const createCode = nodeCode('templates.create')
const startCode = nodeCode('campaigns.start')
const procCode = nodeCode('Processar eventos')
const inactivityCode = nodeCode('Alerta de inatividade')

const SUBSCRIBED = ok({ data: [{ whatsapp_business_api_data: { id: 'APPID' } }] })
const esRoutes = ({ subscribedApps = SUBSCRIBED } = {}) => [
  [is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: true, account: null, token: null })],
  [is('GET', '/oauth/access_token'), ok({ access_token: 'TOKEN_A' })],
  [is('GET', '/debug_token'), ok({ data: { granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA_A'] }] } })],
  [is('GET', '/phone_numbers'), ok({ data: [{ id: 'PN_A' }] })],
  [is('GET', '/rest/v1/wa_accounts'), ok([])],
  [is('POST', '/subscribed_apps'), ok({ success: true })],
  [is('GET', '/subscribed_apps'), subscribedApps],
  [is('POST', '/register'), ok({ success: true })],
  [is('POST', '/rpc/claim_wa_account'), (o) => ok({ ok: true, account: { id: 'acc-1', ...o.body.p_row } })],
  [is('POST', '/rpc/wa_store_secret'), ok('secret-id')],
  [(o) => o.method === 'GET' && o.qs?.fields === 'whatsapp_business_manager_messaging_limit', ok({ whatsapp_business_manager_messaging_limit: 'TIER_2K' })],
  [(o) => o.method === 'GET' && o.url.endsWith('/PN_A'), ok({ display_phone_number: '+55 11 99999-0000', is_on_biz_app: true })],
  [(o) => o.method === 'GET' && o.url.includes('graph.facebook.com'), ok({ name: 'WABA' })],
]
const esBody = routed({ code: 'c', waba_id: 'WABA_A', phone_number_id: 'PN_A' })
const stored = (m) => m.calls.find((c) => c.url.includes('wa_store_secret') && c.body.p_kind === 'token')?.body.p_value

// ---------------------------------------------------------------- lacuna 4: cifragem
test('es.exchange grava o token cifrado (AES-GCM), nunca em texto puro', async () => {
  const m = httpMock(esRoutes())
  const [o] = await runNode(esCode, { items: esBody, helpers: m.helpers })
  assert.equal(o.json.status, 200, JSON.stringify(o.json.body))
  const v = stored(m)
  assert.match(v, /^enc:v1:/)
  assert.ok(!v.includes('TOKEN_A'))
  assert.ok(!JSON.stringify(m.calls.map((c) => c.body)).includes('"TOKEN_A"'), 'token não vai em claro a nenhuma chamada do Supabase')
})

test('o token cifrado volta a funcionar no envio (ida e volta pelo userContext)', async () => {
  const es = httpMock(esRoutes())
  await runNode(esCode, { items: esBody, helpers: es.helpers })
  const sealed = stored(es)

  const m = httpMock([
    [is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: true, account: { id: 'acc-1', phone_number_id: 'PN_A' }, token: sealed })],
    [is('POST', '/rpc/reserve_outbound_message'), ok({ ok: true, id: 'msg-1' })],
    [is('POST', '/PN_A/messages'), ok({ messages: [{ id: 'wamid.1' }] })],
  ])
  const [o] = await runNode(sendCode, { items: routed({ wa_account_id: 'acc-1', to: '5511999990000', template_name: 't', language: 'pt_BR' }), helpers: m.helpers })
  assert.equal(o.json.status, 200, JSON.stringify(o.json.body))
  const graphCall = m.calls.find((c) => c.url.includes('/PN_A/messages'))
  assert.equal(graphCall.headers.Authorization, 'Bearer TOKEN_A')
})

test('segredo de uma conta não decifra em outra (AAD amarra conta e tipo)', async () => {
  const es = httpMock(esRoutes())
  await runNode(esCode, { items: esBody, helpers: es.helpers })
  const m = httpMock([[is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: true, account: { id: 'acc-OUTRA', phone_number_id: 'PN_A' }, token: stored(es) })]])
  const [o] = await runNode(sendCode, { items: routed({ wa_account_id: 'acc-OUTRA', to: '5511999990000', template_name: 't', language: 'pt_BR' }), helpers: m.helpers })
  assert.equal(o.json.status, 500)
  assert.ok(!m.calls.some((c) => c.url.includes('graph.facebook.com')))
})

test('token legado em texto puro continua funcionando até a reconexão', async () => {
  const m = httpMock([
    [is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: true, account: { id: 'acc-1', phone_number_id: 'PN_A' }, token: 'LEGADO' })],
    [is('POST', '/rpc/reserve_outbound_message'), ok({ ok: true, id: 'msg-1' })],
    [is('POST', '/PN_A/messages'), ok({ messages: [{ id: 'wamid.1' }] })],
  ])
  const [o] = await runNode(sendCode, { items: routed({ wa_account_id: 'acc-1', to: '5511999990000', template_name: 't', language: 'pt_BR' }), helpers: m.helpers })
  assert.equal(o.json.status, 200)
  assert.equal(m.calls.find((c) => c.url.includes('/messages')).headers.Authorization, 'Bearer LEGADO')
})

test('sem MONUV_TOKEN_ENCRYPTION_KEY o es.exchange falha antes de qualquer efeito na Meta', async () => {
  const m = httpMock(esRoutes())
  const env = { ...ENV, MONUV_TOKEN_ENCRYPTION_KEY: '' }
  const [o] = await runNode(esCode, { items: esBody, helpers: m.helpers, env })
  assert.equal(o.json.status, 500)
  assert.ok(!m.calls.some((c) => /oauth|subscribed_apps|register|claim_wa_account|wa_store_secret/.test(c.url)))
})

// ---------------------------------------------------------------- subscribed_apps
test('es.exchange só marca "connected" se o App ID da Monuv aparece em GET subscribed_apps', async () => {
  const m = httpMock(esRoutes({ subscribedApps: ok({ data: [] }) }))
  const [o] = await runNode(esCode, { items: esBody, helpers: m.helpers })
  const claim = m.calls.find((c) => c.url.includes('claim_wa_account'))
  assert.equal(claim.body.p_row.status, 'pending')
  assert.equal(claim.body.p_row.webhook_subscribed, false)
  assert.equal(claim.body.p_row.messaging_limit, 'TIER_2K')
  assert.equal(o.json.body.data.account.status, 'pending')
})

test('connection.refresh devolve request/response da leitura do número e grava o limite', async () => {
  const m = httpMock([
    [is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: true, account: { id: 'acc-1', phone_number_id: 'PN_A', waba_id: 'WABA_A' }, token: 'LEGADO' })],
    [is('GET', '/subscribed_apps'), SUBSCRIBED],
    [(o) => o.method === 'GET' && o.qs?.fields === 'whatsapp_business_manager_messaging_limit', ok({ whatsapp_business_manager_messaging_limit: 'TIER_10K' })],
    [(o) => o.method === 'GET' && o.url.includes('/PN_A'), ok({ display_phone_number: '5511', quality_rating: 'YELLOW' })],
    [is('PATCH', '/rest/v1/wa_accounts'), (o) => ok([{ id: 'acc-1', ...o.body }])],
  ])
  const [o] = await runNode(refreshCode, { items: routed({ wa_account_id: 'acc-1' }), helpers: m.helpers })
  assert.equal(o.json.status, 200)
  assert.equal(o.json.body.http_status, 200)
  assert.match(o.json.body.request.url, /\/PN_A\?fields=/)
  assert.equal(o.json.body.response.quality_rating, 'YELLOW')
  const patch = m.calls.find((c) => c.method === 'PATCH').body
  assert.equal(patch.messaging_limit, 'TIER_10K')
  assert.equal(patch.status, 'connected')
})

// ---------------------------------------------------------------- desconectar
const ctxRoute = (extra = {}) => [is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: true, is_demo: false, account: { id: 'acc-1', waba_id: 'WABA_A', phone_number_id: 'PN_A' }, token: 'LEGADO', ...extra })]

test('connection.disconnect: tira a inscrição da WABA, marca desconectada e apaga o token', async () => {
  const m = httpMock([
    ctxRoute(),
    [is('GET', '/rest/v1/wa_accounts'), ok([])],
    [is('DELETE', '/WABA_A/subscribed_apps'), ok({ success: true })],
    [is('PATCH', '/rest/v1/wa_accounts'), (o) => ok([{ id: 'acc-1', ...o.body }])],
  ])
  const [o] = await runNode(disconnectCode, { items: routed({ wa_account_id: 'acc-1' }), helpers: m.helpers })
  assert.equal(o.json.status, 200, JSON.stringify(o.json.body))
  assert.equal(o.json.body.data.account.status, 'disconnected')
  assert.equal(o.json.body.response.success, true)
  assert.ok(m.calls.some((c) => c.method === 'DELETE' && c.url.includes('/rest/v1/wa_credentials?wa_account_id=eq.acc-1')))
  assert.ok(!m.calls.some((c) => c.url.includes('/deregister')), 'nunca tira o número do app do celular')
})

test('connection.disconnect: WABA compartilhada com outra conexão ativa mantém a inscrição do app', async () => {
  const m = httpMock([ctxRoute(), [is('GET', '/rest/v1/wa_accounts'), ok([{ id: 'acc-2' }])], [is('PATCH', '/rest/v1/wa_accounts'), ok([{ id: 'acc-1' }])]])
  const [o] = await runNode(disconnectCode, { items: routed({ wa_account_id: 'acc-1' }), helpers: m.helpers })
  assert.equal(o.json.status, 200)
  assert.ok(!m.calls.some((c) => c.method === 'DELETE' && c.url.includes('graph.facebook.com')))
})

test('connection.disconnect: conta demo do revisor não pode ser desconectada', async () => {
  const m = httpMock([ctxRoute({ is_demo: true })])
  const [o] = await runNode(disconnectCode, { items: routed({ wa_account_id: 'acc-1' }), helpers: m.helpers })
  assert.equal(o.json.status, 403)
  assert.ok(!m.calls.some((c) => c.method === 'PATCH' || c.method === 'DELETE'))
})

// ---------------------------------------------------------------- validações
test('templates.create recusa example.body_text com quantidade diferente das variáveis, sem chamar a Meta', async () => {
  const m = httpMock([ctxRoute()])
  const template = {
    name: 'pedido', language: 'pt_BR', category: 'UTILITY',
    components: [{ type: 'BODY', text: 'Olá {{1}}, pedido {{2}}', example: { body_text: [['Ana']] } }],
  }
  const [o] = await runNode(createCode, { items: routed({ wa_account_id: 'acc-1', template }), helpers: m.helpers })
  assert.equal(o.json.status, 400)
  assert.match(o.json.body.error.message, /2 exemplo/)
  assert.ok(!m.calls.some((c) => c.url.includes('graph.facebook.com')))
})

test('campaigns.start exige origem da lista e consentimento', async () => {
  const id = '11111111-1111-1111-1111-111111111111'
  const m = httpMock([[is('GET', '/rest/v1/campaigns'), ok([{ id, wa_account_id: 'acc-1', status: 'draft', list_source: null, consent_confirmed: false }])]])
  const [o] = await runNode(startCode, { items: routed({ campaign_id: id }), helpers: m.helpers })
  assert.equal(o.json.status, 422)
  assert.equal(o.json.body.error.code, 'consent_required')
  assert.ok(!m.calls.some((c) => c.method === 'PATCH'))
})

// ---------------------------------------------------------------- webhook
const accA = { id: 'acc-A', user_id: 'user-A', waba_id: 'WABA_A', display_phone_number: '+55 11 99999-0000', phone_number_id: 'PN_A' }
const accA2 = { id: 'acc-A2', user_id: 'user-A', waba_id: 'WABA_A', display_phone_number: '+55 11 98888-0000', phone_number_id: 'PN_A2' }
const runProc = async (payload, extra = []) => {
  const m = httpMock([
    ...extra,
    [is('GET', '/rest/v1/wa_accounts?waba_id=eq.WABA_A'), ok([accA, accA2])],
    [is('GET', '/rest/v1/wa_accounts?phone_number_id=eq.PN_A'), ok([accA])],
    [is('GET', '/rest/v1/wa_accounts'), ok([])],
  ])
  await runNode(procCode, { items: [{ json: { valid: true, payload } }], helpers: m.helpers })
  return m
}
const envelope = (field, value, id = 'WABA_A') => ({ object: 'whatsapp_business_account', entry: [{ id, changes: [{ field, value }] }] })
const patches = (m) => m.calls.filter((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/wa_accounts'))
const events = (m) => m.calls.filter((c) => c.url.includes('/rest/v1/wa_account_events')).flatMap((c) => c.body)

test('phone_number_quality_update: grava o limite na WABA, registra o histórico e relê a qualidade do número', async () => {
  const m = await runProc(
    envelope('phone_number_quality_update', { display_phone_number: '5511999990000', event: 'FLAGGED', max_daily_conversations_per_business: 'TIER_2K' }),
    [
      [is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: true, account: { id: 'acc-A' }, token: 'LEGADO' })],
      [(o) => o.method === 'GET' && o.url.endsWith('/PN_A') && o.qs?.fields === 'quality_rating', ok({ quality_rating: 'RED' })],
    ],
  )
  const [limit, quality] = patches(m)
  assert.match(limit.url, /id=in\.\(acc-A,acc-A2\)/)
  assert.equal(limit.body.messaging_limit, 'TIER_2K')
  assert.match(quality.url, /id=eq\.acc-A$/)
  assert.equal(quality.body.quality_rating, 'RED')
  const [ev] = events(m)
  assert.equal(ev.wa_account_id, 'acc-A')
  assert.equal(ev.event, 'FLAGGED')
})

test('phone_number_quality_update antigo (current_limit) também grava o limite', async () => {
  const m = await runProc(envelope('phone_number_quality_update', { display_phone_number: '000', event: 'UPGRADE', current_limit: 'TIER_10K' }))
  assert.equal(patches(m)[0].body.messaging_limit, 'TIER_10K')
  assert.equal(events(m).length, 2, 'número não identificado: registra em todas as contas da WABA')
})

test('PARTNER_REMOVED por PRIMARY_INACTIVITY: desconecta com motivo acionável', async () => {
  const m = await runProc(envelope('account_update', {
    event: 'PARTNER_REMOVED',
    waba_info: { waba_id: 'WABA_A', owner_business_id: 'B1' },
    disconnection_info: { reason: 'PRIMARY_INACTIVITY', initiated_by: 'SYSTEM' },
  }))
  const [p] = patches(m)
  assert.equal(p.body.status, 'disconnected')
  assert.equal(p.body.last_error.reason, 'PRIMARY_INACTIVITY')
  assert.match(p.body.last_error.message, /14 dias/)
  assert.ok(p.body.disconnected_at)
})

test('account_update com entry.id diferente do waba_info.waba_id encontra a conta pelo waba_info', async () => {
  const m = await runProc(envelope('account_update', { event: 'ACCOUNT_DELETED', waba_info: { waba_id: 'WABA_A' } }, 'OUTRO_ID'))
  assert.match(patches(m)[0].url, /id=in\.\(acc-A,acc-A2\)/)
})

test('ACCOUNT_RECONNECTED só reativa quem caiu por ACCOUNT_OFFBOARDED', async () => {
  const m = await runProc(envelope('account_update', { event: 'ACCOUNT_RECONNECTED' }))
  const [p] = patches(m)
  assert.match(p.url, /last_error->>event=eq\.ACCOUNT_OFFBOARDED/)
  assert.equal(p.body.status, 'connected')
})

test('ACCOUNT_VIOLATION vira aviso na conta sem derrubar a conexão', async () => {
  const m = await runProc(envelope('account_update', { event: 'ACCOUNT_VIOLATION', violation_info: { violation_type: 'SPAM' } }))
  const [p] = patches(m)
  assert.equal(p.body.status, undefined)
  assert.equal(p.body.last_error.violation_info.violation_type, 'SPAM')
})

const meta = { display_phone_number: '5511999990000', phone_number_id: 'PN_A' }
const inserted = (m) => m.calls.filter((c) => c.method === 'POST' && c.url.includes('/rest/v1/messages')).flatMap((c) => c.body)

test('smb_message_echoes: origin business_app e atualiza a atividade do celular', async () => {
  const m = await runProc(envelope('smb_message_echoes', {
    metadata: meta,
    message_echoes: [{ from: '5511999990000', to: '5511888880000', id: 'wamid.E', timestamp: '1730000000', type: 'text', text: { body: 'do celular' } }],
  }))
  assert.equal(inserted(m)[0].origin, 'business_app')
  const touch = patches(m).find((p) => p.body.last_seen_at)
  assert.match(touch.url, /id=eq\.acc-A$/)
  assert.equal(touch.body.inactivity_alert_at, null)
})

test('mensagem recebida: nome do contato em contact_name, sem prefixar o texto', async () => {
  const m = await runProc(envelope('messages', {
    metadata: meta,
    contacts: [{ wa_id: '558695211166', profile: { name: 'Maria' } }],
    messages: [{ from: '558695211166', id: 'wamid.IN', timestamp: '1730000000', type: 'text', text: { body: 'oi' } }],
  }))
  const [row] = inserted(m)
  assert.equal(row.body_preview, 'oi')
  assert.equal(row.contact_name, 'Maria')
  assert.equal(row.origin, 'api')
})

test('agendador de inatividade chama refresh_inactivity_alerts', async () => {
  const m = httpMock([[is('POST', '/rpc/refresh_inactivity_alerts'), ok({ flagged: 1, cleared: 0 })]])
  const [o] = await runNode(inactivityCode, { items: [{ json: {} }], helpers: m.helpers })
  assert.equal(o.json.flagged, 1)
})

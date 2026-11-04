// Estrutura do workflow único e Roteador da API.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { httpMock, is, nodeCode, ok, routed, runNode, workflow } from './code-node.mjs'

const ACTIONS = ['es.exchange', 'connection.refresh', 'templates.sync', 'templates.create', 'messages.send', 'campaigns.start']
const routerCode = nodeCode('Roteador')
const call = (body, headers = { authorization: 'Bearer jwt' }) => [{ json: { headers, body } }]
const authOk = [is('GET', '/auth/v1/user'), ok({ id: 'user-A', email: 'a@x.com' })]

test('um único workflow com as três faixas', () => {
  const wf = workflow()
  const types = wf.nodes.map((n) => n.type)
  assert.equal(types.filter((t) => t === 'n8n-nodes-base.webhook').length, 3)
  assert.equal(types.filter((t) => t === 'n8n-nodes-base.scheduleTrigger').length, 2)
})

test('Switch "Ação": uma saída por ação, na mesma ordem do Roteador, mais a saída de erro', () => {
  const wf = workflow()
  const sw = wf.nodes.find((n) => n.name === 'Ação')
  assert.equal(sw.parameters.numberOutputs, ACTIONS.length + 1)
  const outs = wf.connections['Ação'].main.map((o) => o.map((c) => c.node))
  assert.deepEqual(outs, [...ACTIONS.map((a) => [a]), ['Responder API']])
  for (const a of ACTIONS) assert.deepEqual(wf.connections[a].main[0].map((c) => c.node), ['Responder API'])
})

test('Roteador encaminha ação conhecida com o usuário autenticado', async () => {
  const m = httpMock([authOk])
  for (const [i, action] of ACTIONS.entries()) {
    const [o] = await runNode(routerCode, { items: call({ action, x: 1 }), helpers: m.helpers })
    assert.deepEqual(o.json, { route: i, user: { id: 'user-A', email: 'a@x.com' }, body: { action, x: 1 } })
  }
})

test('Roteador: sem token → saída de erro 401; ação desconhecida → 400 (sem chamar o Auth)', async () => {
  const m = httpMock([authOk])
  const [noAuth] = await runNode(routerCode, { items: call({ action: 'messages.send' }, {}), helpers: m.helpers })
  assert.equal(noAuth.json.route, ACTIONS.length)
  assert.equal(noAuth.json.status, 401)
  const before = m.calls.length
  const [unknown] = await runNode(routerCode, { items: call({ action: 'admin.drop' }), helpers: m.helpers })
  assert.equal(unknown.json.route, ACTIONS.length)
  assert.equal(unknown.json.status, 400)
  assert.equal(m.calls.length, before)
})

test('Roteador ignora user vindo do body (identidade só do token)', async () => {
  const m = httpMock([authOk])
  const [o] = await runNode(routerCode, { items: call({ action: 'messages.send', user: { id: 'user-B' } }), helpers: m.helpers })
  assert.equal(o.json.user.id, 'user-A')
})

// ---------------------------------------------------------------- agendador
const workerCode = nodeCode('Fila de campanhas')
const camp = { id: 'camp-1', user_id: 'user-A', wa_account_id: 'acc-1', template_name: 't', template_language: 'pt_BR' }

test('worker envia o lote reservado, marca cada destinatário e para quando a fila esvazia', async () => {
  let claims = 0
  const m = httpMock([
    [is('POST', '/rpc/claim_campaign_batch'), () => ok(claims++ === 0
      ? { campaign: camp, recipients: [{ id: 'r1', to_number: '5511999990001', params: {} }, { id: 'r2', to_number: '5511999990002', params: {} }] }
      : { campaign: null, recipients: [] })],
    [is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: true, is_demo: false, token: 'T', account: { id: 'acc-1', phone_number_id: 'PN' } })],
    [is('POST', '/rpc/reserve_outbound_message'), ok({ ok: true, id: 'msg' })],
    [(o) => o.url.includes('graph.facebook.com'), ok({ messages: [{ id: 'wamid.X' }] })],
  ])
  const [o] = await runNode(workerCode, { items: [{ json: {} }], helpers: m.helpers })
  assert.equal(o.json.sent, 2)
  assert.equal(o.json.batches, 1)
  const marks = m.calls.filter((c) => c.method === 'PATCH' && c.url.includes('campaign_recipients'))
  assert.deepEqual(marks.map((c) => c.body.status), ['sent', 'sent'])
  assert.ok(m.calls.some((c) => c.url.includes('/rpc/refresh_campaign_counters')))
})

test('worker falha a campanha quando o dono perdeu o acesso (sem enviar nada)', async () => {
  let claims = 0
  const m = httpMock([
    [is('POST', '/rpc/claim_campaign_batch'), () => ok(claims++ === 0 ? { campaign: camp, recipients: [{ id: 'r1', to_number: '5511999990001' }] } : { campaign: null })],
    [is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: false })],
  ])
  await runNode(workerCode, { items: [{ json: {} }], helpers: m.helpers })
  assert.ok(!m.calls.some((c) => c.url.includes('graph.facebook.com')))
  const campPatch = m.calls.find((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/campaigns'))
  assert.equal(campPatch.body.status, 'failed')
})

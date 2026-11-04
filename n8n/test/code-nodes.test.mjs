// Comportamento base dos Code nodes: assinatura do webhook, verificação GET e envio de template.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { ENV, httpMock, is, nodeCode, ok, routed, runNode, sign } from './code-node.mjs'

const sigCode = nodeCode('Validar assinatura')
async function verify(raw, header) {
  const headers = header === undefined ? {} : { 'x-hub-signature-256': header }
  const [out] = await runNode(sigCode, { items: [{ json: { headers, body: {} } }], helpers: { getBinaryDataBuffer: async () => raw } })
  return out.json
}

// Corpo exatamente como a Meta envia: acentos escapados como é
const raw = Buffer.from('{"object":"whatsapp_business_account","entry":[{"id":"123","changes":[{"field":"messages","value":{"text":"Ol\\u00e1 Jos\\u00e9"}}]}]}', 'utf8')

test('assinatura válida → 200 e payload lido dos mesmos bytes assinados', async () => {
  const r = await verify(raw, sign(raw))
  assert.equal(r.status, 200)
  assert.equal(r.payload.entry[0].changes[0].value.text, 'Olá José')
})

test('assinatura com outro secret → 401', async () => {
  const r = await verify(raw, 'sha256=' + createHmac('sha256', 'outro').update(raw).digest('hex'))
  assert.equal(r.status, 401)
  assert.equal(r.reason, 'signature_mismatch')
  assert.equal(r.payload, null)
})

test('re-serializar com JSON.stringify quebraria o hash (prova do raw body)', async () => {
  const reserialized = Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))), 'utf8')
  assert.notEqual(sign(reserialized), sign(raw))
  assert.equal((await verify(raw, sign(reserialized))).valid, false)
})

test('corpo adulterado, header ausente ou digest curto → 401', async () => {
  const tampered = Buffer.from(raw.toString('utf8').replace('123', '999'), 'utf8')
  assert.equal((await verify(tampered, sign(raw))).valid, false)
  assert.equal((await verify(raw, undefined)).reason, 'signature_header_missing')
  assert.equal((await verify(raw, 'sha256=abc')).valid, false)
})

test('GET de verificação: token certo devolve challenge; errado → 403', async () => {
  const code = nodeCode('Verificar token')
  const q = (t) => [{ json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': t, 'hub.challenge': '42' } } }]
  assert.deepEqual((await runNode(code, { items: q(ENV.MONUV_META_VERIFY_TOKEN) }))[0].json, { status: 200, body: '42' })
  assert.equal((await runNode(code, { items: q('x') }))[0].json.status, 403)
})

const sendCode = nodeCode('messages.send')

test('messages-send monta o payload do template e não vaza o token', async () => {
  const m = httpMock([
    [is('POST', '/rpc/n8n_user_context'), ok({ ok: true, can_use_app: true, token: 'TKN', account: { id: 'acc-1', phone_number_id: 'PN1', display_phone_number: '+55 11 4000-0000' } })],
    [is('POST', '/rpc/reserve_outbound_message'), ok({ ok: true, id: 'msg-1' })],
    [(o) => o.url.includes('graph.facebook.com'), ok({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC', message_status: 'accepted' }] })],
  ])
  const body = {
    wa_account_id: 'acc-1', to: '+55 (11) 99999-8888', template_name: 'pedido_confirmado', language: 'pt_BR',
    params: { body: [{ key: '1', value: 'Maria' }, { key: '2', value: '#123' }], buttons: [{ index: 0, value: 'abc' }] },
  }
  const [o] = await runNode(sendCode, { items: routed(body, 'user-1'), helpers: m.helpers })
  assert.equal(o.json.status, 200, JSON.stringify(o.json.body))
  const g = m.calls.find((c) => c.url.includes('graph.facebook.com'))
  assert.equal(g.url, 'https://graph.facebook.com/v24.0/PN1/messages')
  assert.equal(g.headers.Authorization, 'Bearer TKN')
  assert.deepEqual(g.body.template, {
    name: 'pedido_confirmado', language: { code: 'pt_BR' },
    components: [
      { type: 'body', parameters: [{ type: 'text', text: 'Maria' }, { type: 'text', text: '#123' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'abc' }] },
    ],
  })
  assert.equal(g.body.to, '5511999998888')
  assert.equal(o.json.body.data.wa_message_id, 'wamid.ABC')
  assert.ok(!JSON.stringify(o.json.body).includes('TKN'))
  assert.ok(m.calls.some((c) => c.url.includes('/rpc/attach_message_events')))
})

#!/usr/bin/env node
// Executa o código real dos Code nodes (gerado em n8n/workflows) com mocks do n8n.
// Uso: node n8n/test/run-code-node.test.mjs
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

function nodeCode(workflowFile, nodeName) {
  const wf = JSON.parse(readFileSync(join(here, '..', 'workflows', workflowFile), 'utf8'))
  return wf.nodes.find((n) => n.name === nodeName).parameters.jsCode
}

async function run(code, { items, env, helpers = {}, nodes = {} }) {
  const $input = { first: () => items[0], all: () => items }
  const $ = (name) => ({ first: () => nodes[name] })
  const fn = new AsyncFunction('$input', '$env', '$', 'require', code)
  return fn.call({ helpers }, $input, env, $, require)
}

const SECRET = 'app-secret-de-teste'
const env = { MONUV_META_APP_SECRET: SECRET, MONUV_META_VERIFY_TOKEN: 'verifica-123', MONUV_SUPABASE_URL: 'http://x', MONUV_SUPABASE_SERVICE_ROLE_KEY: 'k' }
const sign = (buf) => 'sha256=' + createHmac('sha256', SECRET).update(buf).digest('hex')
const sigCode = nodeCode('monuv-meta-webhook.json', 'Validar assinatura')

async function verify(raw, header) {
  const helpers = { getBinaryDataBuffer: async () => raw }
  const headers = header === undefined ? {} : { 'x-hub-signature-256': header }
  const [out] = await run(sigCode, { items: [{ json: { headers, body: {} } }], env, helpers })
  return out.json
}

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log(`✔ ${name}`)
}

// Corpo exatamente como a Meta envia: acentos escapados como é
const raw = Buffer.from('{"object":"whatsapp_business_account","entry":[{"id":"123","changes":[{"field":"messages","value":{"text":"Ol\\u00e1 Jos\\u00e9"}}]}]}', 'utf8')

await test('assinatura válida → 200', async () => {
  const r = await verify(raw, sign(raw))
  assert.equal(r.valid, true)
  assert.equal(r.status, 200)
  assert.equal(r.payload.entry[0].changes[0].value.text, 'Olá José')
})

await test('assinatura de outro secret → 401', async () => {
  const bad = 'sha256=' + createHmac('sha256', 'outro').update(raw).digest('hex')
  const r = await verify(raw, bad)
  assert.equal(r.valid, false)
  assert.equal(r.status, 401)
  assert.equal(r.reason, 'signature_mismatch')
})

await test('re-serializar com JSON.stringify quebraria o hash (prova do raw body)', async () => {
  const reserialized = Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))), 'utf8')
  assert.notEqual(sign(reserialized), sign(raw))
  const r = await verify(raw, sign(reserialized))
  assert.equal(r.valid, false)
})

await test('corpo adulterado → 401', async () => {
  const tampered = Buffer.from(raw.toString('utf8').replace('123', '999'), 'utf8')
  const r = await verify(tampered, sign(raw))
  assert.equal(r.valid, false)
})

await test('sem header → 401', async () => {
  const r = await verify(raw, undefined)
  assert.equal(r.valid, false)
  assert.equal(r.reason, 'signature_header_missing')
})

await test('assinatura com tamanho diferente não estoura timingSafeEqual', async () => {
  const r = await verify(raw, 'sha256=abc')
  assert.equal(r.valid, false)
})

// ---- GET verify
const getCode = nodeCode('monuv-meta-webhook.json', 'Verificar token')
await test('GET com verify_token correto devolve challenge', async () => {
  const [o] = await run(getCode, { items: [{ json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verifica-123', 'hub.challenge': '42' } } }], env })
  assert.deepEqual(o.json, { status: 200, body: '42' })
})
await test('GET com verify_token errado → 403', async () => {
  const [o] = await run(getCode, { items: [{ json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '42' } } }], env })
  assert.equal(o.json.status, 403)
})

// ---- envio: monta payload correto e exige JWT
const sendCode = nodeCode('monuv-messages-send.json', 'Processar')
await test('messages-send sem Authorization → 401', async () => {
  const [o] = await run(sendCode, { items: [{ json: { headers: {}, body: {} } }], env, helpers: { httpRequest: async () => ({}) } })
  assert.equal(o.json.status, 401)
  assert.equal(o.json.body.ok, false)
})

await test('messages-send monta payload de template e grava mensagem', async () => {
  const calls = []
  const httpRequest = async (opts) => {
    calls.push(opts)
    const u = opts.url
    if (u.endsWith('/auth/v1/user')) return { statusCode: 200, body: { id: 'user-1' } }
    if (u.includes('/rpc/n8n_user_context'))
      return { statusCode: 200, body: { ok: true, can_use_app: true, daily_send_limit: 50, sends_today: 0, token: 'TKN', account: { id: 'acc-1', phone_number_id: 'PN1', display_phone_number: '+55 11 4000-0000' } } }
    if (u.endsWith('/rest/v1/messages') && opts.method === 'POST') return { statusCode: 201, body: [{ id: 'msg-1' }] }
    if (u.includes('graph.facebook.com')) return { statusCode: 200, body: { messaging_product: 'whatsapp', contacts: [{ input: '5511999998888', wa_id: '5511999998888' }], messages: [{ id: 'wamid.ABC', message_status: 'accepted' }] } }
    return { statusCode: 200, body: null }
  }
  const body = {
    wa_account_id: 'acc-1', to: '+55 (11) 99999-8888', template_name: 'pedido_confirmado', language: 'pt_BR',
    params: { parameter_format: 'POSITIONAL', body: [{ key: '1', value: 'Maria' }, { key: '2', value: '#123' }], buttons: [{ index: 0, value: 'abc' }] },
  }
  const [o] = await run(sendCode, { items: [{ json: { headers: { authorization: 'Bearer jwt' }, body } }], env: { ...env, MONUV_GRAPH_VERSION: 'v24.0' }, helpers: { httpRequest } })
  assert.equal(o.json.status, 200, JSON.stringify(o.json.body))
  const g = calls.find((c) => c.url.includes('graph.facebook.com'))
  assert.equal(g.url, 'https://graph.facebook.com/v24.0/PN1/messages')
  assert.equal(g.headers.Authorization, 'Bearer TKN')
  assert.deepEqual(g.body, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: '5511999998888', type: 'template',
    template: {
      name: 'pedido_confirmado', language: { code: 'pt_BR' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: 'Maria' }, { type: 'text', text: '#123' }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'abc' }] },
      ],
    },
  })
  assert.equal(o.json.body.data.wa_message_id, 'wamid.ABC')
  assert.ok(!JSON.stringify(o.json.body).includes('TKN'), 'token não pode vazar na resposta')
  assert.ok(calls.some((c) => c.url.includes('/rpc/attach_message_events')))
})

await test('messages-send respeita limite diário do demo → 429', async () => {
  const httpRequest = async (opts) => {
    if (opts.url.endsWith('/auth/v1/user')) return { statusCode: 200, body: { id: 'u' } }
    return { statusCode: 200, body: { ok: true, can_use_app: true, daily_send_limit: 5, sends_today: 5, token: 't', account: { id: 'a' } } }
  }
  const [o] = await run(sendCode, { items: [{ json: { headers: { authorization: 'Bearer j' }, body: { to: '5511999998888', template_name: 'x', language: 'pt_BR' } } }], env, helpers: { httpRequest } })
  assert.equal(o.json.status, 429)
})

console.log(`\n${passed} testes OK`)

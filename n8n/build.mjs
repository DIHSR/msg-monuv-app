#!/usr/bin/env node
// Gera os workflows importáveis do n8n (n8n/workflows/*.json) a partir de n8n/src/*.js.
// Uso: node n8n/build.mjs
//   MONUV_ALLOWED_ORIGINS="https://msg.monuv.com.br,http://localhost:5173" node n8n/build.mjs
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = (f) => readFileSync(join(here, 'src', f), 'utf8')
const LIB = src('_lib.js')
// Produção por padrão. Para desenvolvimento: MONUV_ALLOWED_ORIGINS="https://msg.monuv.com.br,http://localhost:5173"
const ORIGINS = process.env.MONUV_ALLOWED_ORIGINS || 'https://msg.monuv.com.br'
const PREFIX = 'monuv'

// UUID determinístico (rebuild não muda ids → diffs limpos)
function uuid(seed) {
  const h = createHash('sha1').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
function checkSyntax(name, code) {
  try {
    // Code node roda o código dentro de uma função async (permite await/return no topo)
    new AsyncFunction('$input', '$env', '$', 'require', code)
  } catch (e) {
    console.error(`✖ Erro de sintaxe em "${name}": ${e.message}`)
    process.exit(1)
  }
}

function makeBuilder(wf) {
  const nodes = []
  const connections = {}
  const add = (n) => {
    nodes.push(n)
    return n.name
  }
  return {
    nodes,
    connections,
    webhook(name, method, path, position, options = {}) {
      return add({
        parameters: { httpMethod: method, path: `${PREFIX}/${path}`, responseMode: 'responseNode', options },
        id: uuid(`${wf}:${name}`),
        name,
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position,
        webhookId: uuid(`${wf}:${name}:webhook`),
      })
    },
    code(name, file, position, { lib = true } = {}) {
      const jsCode = (lib ? LIB + '\n' : '') + src(file)
      checkSyntax(name, jsCode)
      return add({
        parameters: { jsCode },
        id: uuid(`${wf}:${name}`),
        name,
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position,
      })
    },
    respond(name, position, kind = 'json') {
      return add({
        parameters: {
          respondWith: kind,
          responseBody: kind === 'json' ? '={{ JSON.stringify($json.body) }}' : '={{ $json.body }}',
          options: { responseCode: '={{ $json.status }}' },
        },
        id: uuid(`${wf}:${name}`),
        name,
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1.1,
        position,
      })
    },
    raw(node) {
      return add({ id: uuid(`${wf}:${node.name}`), ...node })
    },
    link(from, to, output = 0) {
      connections[from] ??= { main: [] }
      while (connections[from].main.length <= output) connections[from].main.push([])
      connections[from].main[output].push({ node: to, type: 'main', index: 0 })
    },
    chain(...names) {
      for (let i = 0; i < names.length - 1; i++) this.link(names[i], names[i + 1])
    },
  }
}

const workflows = []

function workflow(name, build, settings = {}) {
  const b = makeBuilder(name)
  build(b)
  workflows.push({
    file: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json',
    json: {
      name,
      nodes: b.nodes,
      connections: b.connections,
      active: false,
      settings: { executionOrder: 'v1', ...settings },
      pinData: {},
      tags: [],
    },
  })
}

// Endpoints chamados pelo front (CORS liberado só para as origens do app)
const cors = { allowedOrigins: ORIGINS }
// Execuções com sucesso não são salvas: evita guardar no n8n payloads com dados pessoais
// e corpos assinados da Meta que poderiam ser reenviados.
const NO_SUCCESS_DATA = { saveDataSuccessExecution: 'none', saveManualExecutions: true }

const simpleEndpoints = [
  ['Monuv - ES Exchange', 'es-exchange', 'es-exchange.js'],
  ['Monuv - Connection Refresh', 'connection-refresh', 'connection-refresh.js'],
  ['Monuv - Templates Sync', 'templates-sync', 'templates-sync.js'],
  ['Monuv - Templates Create', 'templates-create', 'templates-create.js'],
  ['Monuv - Messages Send', 'messages-send', 'messages-send.js'],
]
for (const [name, path, file] of simpleEndpoints) {
  workflow(
    name,
    (b) => {
      const w = b.webhook('Webhook', 'POST', path, [0, 0], cors)
      const c = b.code('Processar', file, [240, 0])
      const r = b.respond('Responder', [480, 0])
      b.chain(w, c, r)
    },
    NO_SUCCESS_DATA,
  )
}

workflow(
  'Monuv - Campaigns Start',
  (b) => {
    const w = b.webhook('Webhook', 'POST', 'campaigns-start', [0, 0], cors)
    const prep = b.code('Preparar campanha', 'campaigns-prepare.js', [220, 0])
    const resp = b.respond('Responder', [440, 0])
    const load = b.code('Carregar destinatários', 'campaigns-load.js', [660, 0])
    const loop = b.raw({
      parameters: { batchSize: 20, options: {} },
      name: 'Loop',
      type: 'n8n-nodes-base.splitInBatches',
      typeVersion: 3,
      position: [880, 0],
    })
    const send = b.code('Enviar lote', 'campaigns-send-batch.js', [1100, 120])
    const wait = b.raw({
      parameters: { amount: 1, unit: 'seconds' },
      name: 'Aguardar 1s',
      type: 'n8n-nodes-base.wait',
      typeVersion: 1.1,
      position: [1320, 120],
      webhookId: uuid('campaigns:wait'),
    })
    const fin = b.code('Finalizar', 'campaigns-finish.js', [1100, -120])
    b.chain(w, prep, resp, load, loop)
    b.link(loop, fin, 0) // done
    b.link(loop, send, 1) // loop
    b.chain(send, wait, loop)
  },
  NO_SUCCESS_DATA,
)

workflow('Monuv - Meta Webhook', (b) => {
  // GET: verificação
  const wg = b.webhook('Webhook GET (verificação)', 'GET', 'meta-webhook', [0, -160])
  const cg = b.code('Verificar token', 'webhook-verify-get.js', [240, -160])
  const rg = b.respond('Responder challenge', [480, -160], 'text')
  b.chain(wg, cg, rg)

  // POST: eventos (rawBody obrigatório para validar a assinatura)
  const wp = b.webhook('Webhook POST (eventos)', 'POST', 'meta-webhook', [0, 80], { rawBody: true })
  const sig = b.code('Validar assinatura', 'webhook-verify-signature.js', [240, 80])
  const rp = b.respond('Responder 200/401', [480, 80], 'text')
  const proc = b.code('Processar eventos', 'webhook-process.js', [720, 80])
  b.chain(wp, sig, rp, proc)
}, NO_SUCCESS_DATA)

workflow('Monuv - Keepalive e Monitor Demo', (b) => {
  const t = b.raw({
    parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 12 }] } },
    name: 'A cada 12h',
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position: [0, 0],
  })
  const c = b.code('Ping Supabase + login demo', 'keepalive.js', [240, 0])
  b.chain(t, c)
})

mkdirSync(join(here, 'workflows'), { recursive: true })
for (const w of workflows) {
  writeFileSync(join(here, 'workflows', w.file), JSON.stringify(w.json, null, 2) + '\n')
  console.log(`✔ n8n/workflows/${w.file}`)
}
console.log(`CORS: ${ORIGINS}`)

#!/usr/bin/env node
// Gera o workflow único do n8n (n8n/workflows/monuv.json) a partir de n8n/src/**.js.
// Uso: node n8n/build.mjs
//   MONUV_ALLOWED_ORIGINS="https://msg.monuv.com.br,http://localhost:5173" node n8n/build.mjs   (n8n de desenvolvimento)
//
// Estrutura (3 faixas num só workflow):
//   API        POST monuv/api → Roteador (auth) → Switch "Ação" → handler → Responder API
//   Meta       GET/POST monuv/meta-webhook → verificação / assinatura → processamento
//   Agendador  1 min: fila de campanhas · 12 h: monitor do usuário demo
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = (f) => readFileSync(join(here, 'src', f), 'utf8')
const LIB = src('_lib.js')
// Produção por padrão. Para desenvolvimento, inclua localhost via MONUV_ALLOWED_ORIGINS.
const ORIGINS = process.env.MONUV_ALLOWED_ORIGINS || 'https://msg.monuv.com.br'
const WORKFLOW = 'Monuv'

/** Tabela de ações da API: a ordem define a saída do Switch "Ação". Uma decisão, um lugar. */
export const API_ACTIONS = [
  ['es.exchange', 'api/es-exchange.js'],
  ['connection.refresh', 'api/connection-refresh.js'],
  ['templates.sync', 'api/templates-sync.js'],
  ['templates.create', 'api/templates-create.js'],
  ['messages.send', 'api/messages-send.js'],
  ['campaigns.start', 'api/campaigns-start.js'],
]

// UUID determinístico (rebuild não muda ids → diffs limpos)
function uuid(seed) {
  const h = createHash('sha1').update(`${WORKFLOW}:${seed}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
function checkSyntax(name, code) {
  try {
    // o Code node roda o código dentro de uma função async (permite await/return no topo)
    new AsyncFunction('$input', '$env', '$', '$execution', 'require', code)
  } catch (e) {
    console.error(`✖ Erro de sintaxe em "${name}": ${e.message}`)
    process.exit(1)
  }
}

const nodes = []
const connections = {}

function add(node) {
  nodes.push({ id: uuid(node.name), ...node })
  return node.name
}

function link(from, to, output = 0) {
  connections[from] ??= { main: [] }
  while (connections[from].main.length <= output) connections[from].main.push([])
  connections[from].main[output].push({ node: to, type: 'main', index: 0 })
}

function chain(...names) {
  for (let i = 0; i < names.length - 1; i++) link(names[i], names[i + 1])
}

function webhook(name, method, path, position, options = {}) {
  return add({
    parameters: { httpMethod: method, path: `monuv/${path}`, responseMode: 'responseNode', options },
    name,
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position,
    webhookId: uuid(`${name}:webhook`),
  })
}

function code(name, file, position, prelude = '') {
  const jsCode = `${LIB}\n${prelude}${src(file)}`
  checkSyntax(name, jsCode)
  return add({ parameters: { jsCode }, name, type: 'n8n-nodes-base.code', typeVersion: 2, position })
}

function respond(name, position, kind = 'json') {
  return add({
    parameters: {
      respondWith: kind,
      responseBody: kind === 'json' ? '={{ JSON.stringify($json.body) }}' : '={{ $json.body }}',
      options: { responseCode: '={{ $json.status }}' },
    },
    name,
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position,
  })
}

function schedule(name, interval, position) {
  return add({
    parameters: { rule: { interval: [interval] } },
    name,
    type: 'n8n-nodes-base.scheduleTrigger',
    typeVersion: 1.2,
    position,
  })
}

function note(name, content, position, width, height, color) {
  return add({ parameters: { content, width, height, color }, name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position })
}

// ------------------------------------------------------------------ Faixa 1: API do front
const ROW = 160
const apiHeight = (API_ACTIONS.length + 1) * ROW
note(
  'Nota API',
  `## API do front\n\`POST /webhook/monuv/api\` com \`{ action, ... }\` e \`Authorization: Bearer <JWT do Supabase>\`.\nO **Roteador** autentica uma vez; o **Switch** escolhe o handler pela ação. CORS: ${ORIGINS}`,
  [-60, -200],
  1460,
  apiHeight + 260,
  4,
)
const apiHook = webhook('Webhook API', 'POST', 'api', [0, apiHeight / 2 - ROW], { allowedOrigins: ORIGINS })
const router = code('Roteador', 'api/router.js', [240, apiHeight / 2 - ROW], `const ROUTES = ${JSON.stringify(API_ACTIONS.map(([a]) => a))};\n`)
const sw = add({
  parameters: { mode: 'expression', numberOutputs: API_ACTIONS.length + 1, output: '={{ $json.route }}' },
  name: 'Ação',
  type: 'n8n-nodes-base.switch',
  typeVersion: 3.2,
  position: [480, apiHeight / 2 - ROW],
})
const apiRespond = respond('Responder API', [1100, apiHeight / 2 - ROW])
chain(apiHook, router, sw)
API_ACTIONS.forEach(([action, file], i) => {
  const handler = code(action, file, [780, i * ROW - 80])
  link(sw, handler, i)
  link(handler, apiRespond)
})
link(sw, apiRespond, API_ACTIONS.length) // erro de autenticação / ação desconhecida

// ------------------------------------------------------------------ Faixa 2: webhook da Meta
const metaY = apiHeight + 200
note(
  'Nota Meta',
  '## Webhook da Meta\n`GET /webhook/monuv/meta-webhook` (verificação) e `POST` (eventos).\nAssinatura **X-Hub-Signature-256** validada sobre o corpo bruto antes de qualquer processamento; o 200 sai antes do processamento.',
  [-60, metaY - 60],
  1460,
  440,
  6,
)
chain(
  webhook('Meta GET (verificação)', 'GET', 'meta-webhook', [0, metaY + 60]),
  code('Verificar token', 'meta/verify-get.js', [240, metaY + 60]),
  respond('Responder challenge', [480, metaY + 60], 'text'),
)
chain(
  webhook('Meta POST (eventos)', 'POST', 'meta-webhook', [0, metaY + 240], { rawBody: true }),
  code('Validar assinatura', 'meta/verify-signature.js', [240, metaY + 240]),
  respond('Responder 200/401', [480, metaY + 240], 'text'),
  code('Processar eventos', 'meta/process.js', [720, metaY + 240]),
)

// ------------------------------------------------------------------ Faixa 3: agendador
const schedY = metaY + 520
note(
  'Nota Agendador',
  '## Agendador\n**1 min:** envia campanhas em lotes (fila no banco com SKIP LOCKED) — também mantém o Supabase Free ativo.\n**12 h:** testa o login do usuário demo do revisor da Meta.',
  [-60, schedY - 60],
  1460,
  400,
  5,
)
chain(
  schedule('A cada minuto', { field: 'minutes', minutesInterval: 1 }, [0, schedY + 60]),
  code('Fila de campanhas', 'scheduler/campaigns-worker.js', [240, schedY + 60]),
)
chain(
  schedule('A cada 12h', { field: 'hours', hoursInterval: 12 }, [0, schedY + 220]),
  code('Monitor do demo', 'scheduler/demo-monitor.js', [240, schedY + 220]),
)

// ------------------------------------------------------------------ saída
const workflow = {
  name: WORKFLOW,
  nodes,
  connections,
  active: false,
  settings: {
    executionOrder: 'v1',
    timezone: 'America/Sao_Paulo',
    // execuções com sucesso não são salvas: evita guardar dados pessoais e corpos assinados da Meta
    saveDataSuccessExecution: 'none',
    saveManualExecutions: true,
  },
  pinData: {},
  tags: [],
}

mkdirSync(join(here, 'workflows'), { recursive: true })
writeFileSync(join(here, 'workflows', 'monuv.json'), JSON.stringify(workflow, null, 2) + '\n')
console.log(`✔ n8n/workflows/monuv.json (${nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length} nodes)`)
console.log(`CORS: ${ORIGINS}`)

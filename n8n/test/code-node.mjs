// Executa o código real dos Code nodes gerados em n8n/workflows com mocks do runtime do n8n.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

export const APP_SECRET = 'app-secret-de-teste'
export const ENV = {
  MONUV_META_APP_ID: 'APPID',
  MONUV_META_APP_SECRET: APP_SECRET,
  MONUV_META_VERIFY_TOKEN: 'verifica-123',
  MONUV_SUPABASE_URL: 'http://sb',
  MONUV_SUPABASE_SERVICE_ROLE_KEY: 'k',
  MONUV_GRAPH_VERSION: 'v24.0',
}

export function workflow(file) {
  return JSON.parse(readFileSync(join(here, '..', 'workflows', file), 'utf8'))
}

export function nodeCode(workflowFile, nodeName) {
  return workflow(workflowFile).nodes.find((n) => n.name === nodeName).parameters.jsCode
}

export async function runNode(code, { items, env = ENV, helpers = {}, nodes = {}, execution = { id: 'exec-1' } }) {
  const $input = { first: () => items[0], all: () => items }
  const $ = (name) => ({ first: () => nodes[name] })
  const fn = new AsyncFunction('$input', '$env', '$', '$execution', 'require', code)
  return fn.call({ helpers }, $input, env, $, execution, require)
}

export const sign = (buf) => 'sha256=' + createHmac('sha256', APP_SECRET).update(buf).digest('hex')

/**
 * Mock de helpers.httpRequest roteado por (método, URL).
 * `routes` é uma lista de [predicado(opts) → boolean, resposta | (opts) => resposta].
 * Toda chamada fica registrada em `calls`.
 */
export function httpMock(routes) {
  const calls = []
  const httpRequest = async (opts) => {
    calls.push(opts)
    for (const [match, res] of routes) {
      if (match(opts)) return typeof res === 'function' ? res(opts) : res
    }
    return { statusCode: 200, body: null }
  }
  return { calls, helpers: { httpRequest } }
}

export const is = (method, fragment) => (o) => o.method === method && o.url.includes(fragment)
export const ok = (body) => ({ statusCode: 200, body })

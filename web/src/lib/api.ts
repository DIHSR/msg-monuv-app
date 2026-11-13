import { config } from '../config'
import { supabase } from './supabase'

/** Ações da API do n8n (endpoint único `POST .../webhook/monuv/api` com `{ action, ... }`). */
export type N8nAction =
  | 'es.exchange'
  | 'connection.refresh'
  | 'connection.disconnect'
  | 'templates.sync'
  | 'templates.create'
  | 'messages.send'
  | 'campaigns.start'

/**
 * Formato de toda resposta do n8n (spec v2, 2.7). `request` e `response` são o que foi enviado à Meta
 * e o que ela respondeu: o front exibe como vieram, sem remontar nada.
 */
export interface ApiResult<T = unknown> {
  ok: boolean
  data?: T
  error?: { code: string; message: string; ref?: string | null }
  request?: unknown
  response?: unknown
  http_status?: number | null
}

export class ApiError extends Error {
  status: number
  code: string | null
  /** execution_id do n8n em erros internos (5xx) — o usuário cita no suporte. */
  ref: string | null
  body: ApiResult | null

  constructor(message: string, status: number, body: ApiResult | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.code = body?.error?.code ?? null
    this.ref = body?.error?.ref ?? null
  }
}

/**
 * Chama uma ação do n8n com o JWT do Supabase. Lança ApiError quando HTTP não-2xx ou `ok: false`;
 * o corpo completo (com request/response da Meta) fica em `error.body`.
 */
export async function callN8n<T extends ApiResult = ApiResult>(action: N8nAction, params: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ApiError('Sessão expirada. Entre novamente.', 401, null)

  let res: Response
  try {
    res = await fetch(config.n8nApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...params, action }),
    })
  } catch {
    throw new ApiError('Não foi possível falar com o servidor (n8n). Verifique a conexão e o VITE_N8N_API_URL.', 0, null)
  }

  const text = await res.text()
  let json: ApiResult | null = null
  try {
    json = text ? (JSON.parse(text) as ApiResult) : null
  } catch {
    json = { ok: false, response: { raw: text } }
  }

  if (!res.ok || json?.ok === false) {
    throw new ApiError(json?.error?.message ?? `Erro HTTP ${res.status} em ${action}`, res.status, json)
  }
  return json as T
}

/** Mensagem para toast/alerta. Erros internos levam a referência (execution_id) junto. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.ref ? `${err.message} (ref. ${err.ref})` : err.message
  if (err instanceof Error) return err.message
  return 'Erro inesperado'
}

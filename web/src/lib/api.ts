import { config } from '../config'
import { supabase } from './supabase'

export class ApiError extends Error {
  status: number
  body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/** Ações da API do n8n (endpoint único `POST monuv/api` com `{ action, ... }`). */
export type N8nAction =
  | 'es.exchange'
  | 'connection.refresh'
  | 'templates.sync'
  | 'templates.create'
  | 'messages.send'
  | 'campaigns.start'

/**
 * Chama uma ação da API do n8n autenticando com o JWT do Supabase.
 * Lança ApiError quando HTTP não-2xx ou `ok: false` — o corpo fica em `error.body`
 * para que telas como a de envio mostrem o JSON mesmo em caso de erro.
 */
export async function callN8n<T = unknown>(action: N8nAction, params: Record<string, unknown> = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ApiError('Sessão expirada. Entre novamente.', 401, null)

  let res: Response
  try {
    res = await fetch(`${config.n8nBaseUrl}/api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...params, action }),
    })
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor de automação (n8n).', 0, null)
  }

  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }

  const okFlag = (json as { ok?: boolean } | null)?.ok
  if (!res.ok || okFlag === false) {
    const msg =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      `Erro ${res.status} em ${action}`
    throw new ApiError(msg, res.status, json)
  }
  return json as T
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Erro inesperado'
}

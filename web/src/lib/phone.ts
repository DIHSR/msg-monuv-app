import { onlyDigits } from './utils'

/** Máscara (00) 00000-0000 para o número digitado SEM o +55 (DDD + 8 ou 9 dígitos). */
export function maskBrPhone(raw: string): string {
  const d = onlyDigits(raw).slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  const ddd = d.slice(0, 2)
  const rest = d.slice(2)
  if (rest.length <= 4) return `(${ddd}) ${rest}`
  const split = rest.length > 8 ? 5 : 4
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`
}

/** DDD + 8 (fixo) ou 9 (celular) dígitos. */
export function isValidBrLocal(raw: string): boolean {
  const d = onlyDigits(raw)
  return /^[1-9][0-9]\d{8,9}$/.test(d)
}

/** Número local (DDD + número) → só dígitos com DDI 55, como o backend espera em `to`. */
export function brToE164Digits(raw: string): string {
  return `55${onlyDigits(raw)}`
}

/**
 * Número vindo de lista (CSV/colado): aceita com ou sem 55 e com máscara.
 * Devolve só dígitos com DDI, ou null se não parecer um telefone válido.
 */
export function normalizeListPhone(raw: string): string | null {
  const d = onlyDigits(raw)
  // "+" explícito: número internacional já com DDI
  if (String(raw).trim().startsWith('+')) return d.length >= 10 && d.length <= 15 ? d : null
  if (/^55[1-9][0-9]\d{8,9}$/.test(d)) return d
  if (isValidBrLocal(d)) return `55${d}` // sem DDI = Brasil
  return null
}

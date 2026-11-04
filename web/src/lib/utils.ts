import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function onlyDigits(v: string) {
  return v.replace(/\D/g, '')
}

/** Formata número E.164 (só dígitos) para exibição. Ex.: 5511999998888 → +55 11 99999-8888 */
export function formatPhone(raw: string | null | undefined) {
  if (!raw) return '—'
  const d = onlyDigits(raw)
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4)
    const rest = d.slice(4)
    const split = rest.length === 9 ? 5 : 4
    return `+55 ${ddd} ${rest.slice(0, split)}-${rest.slice(split)}`
  }
  return raw.startsWith('+') ? raw : `+${d}`
}

export function isValidE164Digits(v: string) {
  const d = onlyDigits(v)
  return d.length >= 10 && d.length <= 15
}

const dtf = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })
const tf = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' })

export function formatDateTime(v: string | null | undefined) {
  if (!v) return '—'
  return dtf.format(new Date(v))
}

export function formatTime(v: string | null | undefined) {
  if (!v) return '—'
  return tf.format(new Date(v))
}

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage indisponível — ignora */
  }
}

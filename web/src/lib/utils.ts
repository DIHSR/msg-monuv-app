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

const TIER_LABEL: Record<string, string> = {
  TIER_50: '50 conversas/dia',
  TIER_250: '250 conversas/dia',
  TIER_1K: '1.000 conversas/dia',
  TIER_2K: '2.000 conversas/dia',
  TIER_10K: '10.000 conversas/dia',
  TIER_100K: '100.000 conversas/dia',
  TIER_UNLIMITED: 'Ilimitado',
  TIER_NOT_SET: 'Ainda não definido',
}

/** Limite de envio da Meta (TIER_* ou número) em texto legível. */
export function formatMessagingLimit(v: string | null | undefined) {
  if (!v) return '—'
  if (TIER_LABEL[v]) return TIER_LABEL[v]
  if (/^\d+$/.test(v)) return `${Number(v).toLocaleString('pt-BR')} conversas/dia`
  return v
}

/** Dias inteiros desde a data (null se não houver data). */
export function daysSince(v: string | null | undefined, now = Date.now()) {
  if (!v) return null
  return Math.floor((now - new Date(v).getTime()) / 86_400_000)
}

/** "agora", "há 5 min", "há 3 h", "há 2 dias" — ou a data, se for antiga. */
export function formatRelative(v: string | null | undefined) {
  if (!v) return '—'
  const diff = Date.now() - new Date(v).getTime()
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  if (d <= 30) return `há ${d} dia${d > 1 ? 's' : ''}`
  return formatDateTime(v)
}

/** Hora, se for de hoje; data e hora, se for de outro dia (balões de conversa). */
export function formatMessageTime(v: string) {
  return new Date(v).toDateString() === new Date().toDateString() ? formatTime(v) : formatDateTime(v)
}

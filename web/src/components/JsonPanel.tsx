import { Check, Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '../lib/utils'

const TOKEN_RE =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],])/g

function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of json.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(json.slice(last, idx))
    const tok = m[0]
    let cls = 'text-json-number'
    if (tok.startsWith('"')) cls = tok.trimEnd().endsWith(':') ? 'text-json-key' : 'text-json-string'
    else if (/^(true|false|null)$/.test(tok)) cls = 'text-json-literal'
    else if (/^[{}[\],]$/.test(tok)) cls = 'text-json-punct'
    out.push(
      <span key={i++} className={cls}>
        {tok}
      </span>,
    )
    last = idx + tok.length
  }
  if (last < json.length) out.push(json.slice(last))
  return out
}

function JsonBlock({
  title,
  subtitle,
  value,
  placeholder,
  badge,
  className,
}: {
  title: string
  subtitle?: ReactNode
  value: unknown
  placeholder: string
  badge?: ReactNode
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const has = value !== undefined && value !== null
  const text = has ? JSON.stringify(value, null, 2) : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* sem clipboard */
    }
  }

  return (
    <div className={cn('flex min-w-0 flex-col overflow-hidden rounded-xl bg-json-bg ring-1 ring-slate-800', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">{title}</span>
            {badge}
          </div>
          {subtitle && <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={copy}
          disabled={!has}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-white/10 hover:text-slate-200 disabled:opacity-30"
          aria-label={`Copiar ${title}`}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre className="max-h-[28rem] min-h-40 flex-1 overflow-auto p-4 font-mono text-[12.5px] leading-relaxed text-slate-200">
        {has ? highlight(text) : <span className="text-slate-500">{placeholder}</span>}
      </pre>
    </div>
  )
}

function HttpBadge({ status }: { status?: number | null }) {
  if (!status) return null
  const ok = status >= 200 && status < 300
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold',
        ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300',
      )}
    >
      HTTP {status}
    </span>
  )
}

/**
 * Painel lado a lado: payload enviado à Meta × resposta da Meta.
 */
export function JsonPanel({
  request,
  response,
  httpStatus,
  requestLabel = 'Payload enviado',
  responseLabel = 'Resposta da Meta',
  requestSubtitle,
  responseSubtitle,
  requestPlaceholder = '// O payload aparecerá aqui',
  responsePlaceholder = '// Aguardando envio…',
  className,
}: {
  request?: unknown
  response?: unknown
  httpStatus?: number | null
  requestLabel?: string
  responseLabel?: string
  requestSubtitle?: ReactNode
  responseSubtitle?: ReactNode
  requestPlaceholder?: string
  responsePlaceholder?: string
  className?: string
}) {
  return (
    <div className={cn('grid gap-4 lg:grid-cols-2', className)}>
      <JsonBlock title={requestLabel} subtitle={requestSubtitle} value={request} placeholder={requestPlaceholder} />
      <JsonBlock
        title={responseLabel}
        subtitle={responseSubtitle}
        value={response}
        placeholder={responsePlaceholder}
        badge={<HttpBadge status={httpStatus} />}
      />
    </div>
  )
}

export { JsonBlock }

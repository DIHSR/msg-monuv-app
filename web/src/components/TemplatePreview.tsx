import { ExternalLink, FileText, Image, Phone, Reply, Video } from 'lucide-react'
import type { ReactNode } from 'react'
import { getSlots, renderVars } from '../lib/templates'
import type { TemplateComponent } from '../lib/types'
import { cn } from '../lib/utils'

/** Destaca variáveis não preenchidas e aplica *negrito* / _itálico_ do WhatsApp. */
function richText(text: string): ReactNode[] {
  const parts = text.split(/(\{\{\s*[A-Za-z0-9_]+\s*\}\}|\*[^*\n]+\*|_[^_\n]+_)/g)
  return parts.map((p, i) => {
    if (/^\{\{.*\}\}$/.test(p))
      return (
        <span key={i} className="rounded bg-brand-100 px-1 font-mono text-[12px] text-brand-800">
          {p}
        </span>
      )
    if (/^\*[^*]+\*$/.test(p)) return <strong key={i}>{p.slice(1, -1)}</strong>
    if (/^_[^_]+_$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>
    return p
  })
}

export function TemplatePreview({
  components,
  values = {},
  className,
}: {
  components: TemplateComponent[]
  /** valores por placeholder, separados por seção */
  values?: { header?: Record<string, string>; body?: Record<string, string>; mediaLink?: string }
  className?: string
}) {
  const s = getSlots(components)
  const headerText = s.header?.format === 'TEXT' ? renderVars(s.header.text ?? '', values.header ?? {}) : null
  const bodyText = renderVars(s.body?.text ?? '', values.body ?? {})
  const buttons = s.buttons?.buttons ?? []
  const mediaIcon =
    s.headerFormat === 'IMAGE' ? <Image className="size-8" /> : s.headerFormat === 'VIDEO' ? <Video className="size-8" /> : <FileText className="size-8" />

  return (
    <div className={cn('rounded-xl bg-wa-bg p-4', className)}>
      <div className="max-w-[340px] overflow-hidden rounded-lg rounded-tl-none bg-wa-bubble shadow-sm">
        {s.headerFormat && s.headerFormat !== 'TEXT' && (
          <div className="p-1">
            {values.mediaLink && s.headerFormat === 'IMAGE' ? (
              <img src={values.mediaLink} alt="" className="h-40 w-full rounded-md object-cover" />
            ) : (
              <div className="flex h-32 items-center justify-center rounded-md bg-slate-200 text-slate-500">{mediaIcon}</div>
            )}
          </div>
        )}
        <div className="px-3 pb-1.5 pt-2">
          {headerText && <p className="mb-1 font-semibold text-slate-900">{richText(headerText)}</p>}
          {bodyText ? (
            <p className="whitespace-pre-wrap text-[14px] leading-snug text-slate-800">{richText(bodyText)}</p>
          ) : (
            <p className="text-[14px] italic text-slate-400">Corpo da mensagem…</p>
          )}
          {s.footer?.text && <p className="mt-1.5 text-[12px] text-slate-500">{s.footer.text}</p>}
          <p className="mt-1 text-right text-[11px] text-slate-400">12:00</p>
        </div>
        {buttons.length > 0 && (
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            {buttons.map((b, i) => (
              <div key={i} className="flex items-center justify-center gap-1.5 py-2 text-[14px] font-medium text-wa-link">
                {b.type === 'URL' ? (
                  <ExternalLink className="size-4" />
                ) : b.type === 'PHONE_NUMBER' ? (
                  <Phone className="size-4" />
                ) : (
                  <Reply className="size-4" />
                )}
                {b.text || 'Botão'}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

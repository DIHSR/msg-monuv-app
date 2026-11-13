import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Check, CheckCheck, Clock, History, MessagesSquare, Search, Server, Smartphone, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ConnectionBar, NoConnection } from '../components/ConnectionSelect'
import { Card, EmptyState, Input, PageHeader, Spinner } from '../components/ui'
import { useAccounts } from '../hooks/useAccounts'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { supabase } from '../lib/supabase'
import type { Conversation, Message, MessageOrigin } from '../lib/types'
import { cn, formatDateTime, formatMessageTime, formatPhone, formatRelative } from '../lib/utils'

const THREAD_LIMIT = 300

/** Origem da mensagem enviada: pelo sistema (API), pelo celular (smb_message_echoes) ou histórico do app. */
const ORIGIN: Record<MessageOrigin, { label: string; icon: typeof Server; className: string }> = {
  api: { label: 'Sistema', icon: Server, className: 'bg-brand-50 text-brand-800 ring-brand-600/20' },
  business_app: { label: 'Celular', icon: Smartphone, className: 'bg-violet-50 text-violet-800 ring-violet-600/20' },
  history: { label: 'Histórico do app', icon: History, className: 'bg-slate-100 text-slate-700 ring-slate-500/20' },
}

function OriginBadge({ origin }: { origin: MessageOrigin }) {
  const o = ORIGIN[origin] ?? ORIGIN.api
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset', o.className)}>
      <o.icon className="size-3" />
      {o.label}
    </span>
  )
}

function DeliveryIcon({ status }: { status: string }) {
  if (status === 'read') return <CheckCheck className="size-3.5 text-sky-500" aria-label="Lida" />
  if (status === 'delivered') return <CheckCheck className="size-3.5 text-slate-400" aria-label="Entregue" />
  if (status === 'sent' || status === 'accepted') return <Check className="size-3.5 text-slate-400" aria-label="Enviada" />
  if (status === 'failed') return <X className="size-3.5 text-red-600" aria-label="Falhou" />
  return <Clock className="size-3.5 text-slate-400" aria-label="Pendente" />
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'pendente',
  accepted: 'aceita',
  sent: 'enviada',
  delivered: 'entregue',
  read: 'lida',
  failed: 'falhou',
}

function Bubble({ m }: { m: Message }) {
  const out = m.direction === 'outbound'
  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-3 py-2 text-[14px] shadow-sm',
          out ? 'rounded-tr-none bg-[#d9fdd3]' : 'rounded-tl-none bg-white',
          m.status === 'failed' && 'ring-1 ring-red-300',
        )}
      >
        {out && (
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <OriginBadge origin={m.origin} />
            {m.template_name && <span className="font-mono text-[11px] text-slate-500">{m.template_name}</span>}
          </div>
        )}
        {!out && m.origin === 'history' && (
          <div className="mb-1">
            <OriginBadge origin="history" />
          </div>
        )}
        <p className="whitespace-pre-wrap break-words leading-snug text-slate-800">{m.body_preview || `[${m.type}]`}</p>
        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-500" title={formatDateTime(m.created_at)}>
          {formatMessageTime(m.created_at)}
          {out && (
            <>
              <DeliveryIcon status={m.status} />
              <span>{STATUS_LABEL[m.status] ?? m.status}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Thread({ accountId, conversation, onBack }: { accountId: string; conversation: Conversation; onBack: () => void }) {
  const key = conversation.contact_key
  const q = useQuery({
    queryKey: ['thread', accountId, key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('wa_account_id', accountId)
        .eq('contact_key', key)
        .order('created_at', { ascending: false })
        .limit(THREAD_LIMIT)
      if (error) throw error
      return (data as Message[]).reverse()
    },
  })
  const endRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => q.data ?? [], [q.data])
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [rows.length])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
        <button onClick={onBack} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Voltar">
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{conversation.contact_name ?? formatPhone(conversation.contact_number)}</p>
          {conversation.contact_name && <p className="font-mono text-xs text-slate-500">{formatPhone(conversation.contact_number)}</p>}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-wa-bg p-4">
        {q.isLoading ? (
          <Spinner />
        ) : (
          <>
            {rows.length >= THREAD_LIMIT && <p className="text-center text-xs text-slate-500">Mostrando as últimas {THREAD_LIMIT} mensagens.</p>}
            {rows.map((m) => (
              <Bubble key={m.id} m={m} />
            ))}
          </>
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}

export function ConversationsPage() {
  const { accounts, active } = useAccounts()
  const [search, setSearch] = useState('')
  const accountId = active?.id
  // a conversa aberta pertence à conexão em que foi escolhida: trocar de conexão fecha a conversa
  const [selection, setSelection] = useState<{ accountId: string; key: string } | null>(null)
  const selectedKey = selection && selection.accountId === accountId ? selection.key : null
  const setSelectedKey = (key: string | null) => setSelection(key && accountId ? { accountId, key } : null)

  const q = useQuery({
    queryKey: ['conversations', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('wa_account_id', accountId!)
        .order('last_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data as Conversation[]
    },
  })
  // qualquer mensagem nova (recebida, eco do celular, status) atualiza a lista e a conversa aberta
  useRealtimeInvalidate('messages', accountId ? `wa_account_id=eq.${accountId}` : null, [
    ['conversations', accountId],
    ['thread', accountId],
  ])

  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    const digits = s.replace(/\D/g, '')
    const rows = q.data ?? []
    if (!s) return rows
    return rows.filter((c) => (c.contact_name ?? '').toLowerCase().includes(s) || (digits && (c.contact_number ?? '').includes(digits)))
  }, [q.data, search])

  const selected = (q.data ?? []).find((c) => c.contact_key === selectedKey) ?? null

  if (!accounts.length) {
    return (
      <div>
        <PageHeader title="Conversas" />
        <NoConnection />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Conversas"
        description="Mensagens recebidas e enviadas, por contato. Inclui as enviadas pelo celular no app WhatsApp Business (coexistência)."
      />
      <ConnectionBar />

      <Card className="flex h-[70vh] min-h-[28rem] overflow-hidden">
        <div className={cn('flex w-full min-w-0 flex-col border-r border-slate-200 lg:w-80 lg:shrink-0', selected && 'hidden lg:flex')}>
          <div className="border-b border-slate-200 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome ou número" className="pl-9" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {q.isLoading ? (
              <Spinner className="m-4" />
            ) : list.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">{search ? 'Nenhum contato encontrado.' : 'Nenhuma conversa nesta conexão ainda.'}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {list.map((c) => (
                  <li key={c.contact_key}>
                    <button
                      onClick={() => setSelectedKey(c.contact_key)}
                      className={cn('w-full px-4 py-3 text-left hover:bg-slate-50', c.contact_key === selectedKey && 'bg-brand-50/70')}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-medium text-slate-900">{c.contact_name ?? formatPhone(c.contact_number)}</p>
                        <span className="shrink-0 text-[11px] text-slate-500">{formatRelative(c.last_at)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                        {c.last_direction === 'outbound' && <DeliveryIcon status={c.last_status} />}
                        {c.last_direction === 'outbound' && c.last_origin === 'business_app' && <Smartphone className="size-3 text-violet-600" />}
                        <span className="truncate">{c.last_preview || `[${c.last_type}]`}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className={cn('min-w-0 flex-1', !selected && 'hidden lg:block')}>
          {selected && accountId ? (
            <Thread accountId={accountId} conversation={selected} onBack={() => setSelectedKey(null)} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState icon={<MessagesSquare className="size-6" />} title="Selecione uma conversa" description="As mensagens chegam em tempo real pelo webhook." />
            </div>
          )}
        </div>
      </Card>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <OriginBadge origin="api" /> enviada pelo Monuv (API)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <OriginBadge origin="business_app" /> enviada pelo celular no app WhatsApp Business
        </span>
        <span className="inline-flex items-center gap-1.5">
          <OriginBadge origin="history" /> importada do histórico do app
        </span>
      </div>
    </div>
  )
}

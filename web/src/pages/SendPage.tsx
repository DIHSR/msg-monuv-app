import { useQuery } from '@tanstack/react-query'
import { Check, CheckCheck, CircleAlert, Clock, MessageSquare, Send } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { JsonPanel } from '../components/JsonPanel'
import { StatusBadge } from '../components/StatusBadge'
import { TemplatePreview } from '../components/TemplatePreview'
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select } from '../components/ui'
import { useAccounts } from '../hooks/useAccounts'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { ApiError, callN8n, errorMessage } from '../lib/api'
import { supabase } from '../lib/supabase'
import {
  buildSendParams,
  fieldKey,
  getSlots,
  renderBodyPreview,
  requiredFieldKeys,
} from '../lib/templates'
import type { Message, MessageStatusEvent, MetaCallResult, Template } from '../lib/types'
import { cn, formatDateTime, formatPhone, formatTime, isValidE164Digits, onlyDigits } from '../lib/utils'
import { useTemplates } from '../hooks/useTemplates'

interface SendResult extends MetaCallResult<{ message_id: string; wa_message_id: string | null }> {}

interface PanelState {
  request: unknown
  response: unknown
  http_status: number | null
  message_id: string | null
  label: string
}

const TIMELINE = [
  { status: 'accepted', label: 'Aceita pela API', icon: Clock },
  { status: 'sent', label: 'Enviada', icon: Check },
  { status: 'delivered', label: 'Entregue', icon: CheckCheck },
  { status: 'read', label: 'Lida', icon: CheckCheck },
] as const

const RANK: Record<string, number> = { pending: 0, accepted: 1, sent: 2, delivered: 3, read: 4 }

function StatusTimeline({ messageId }: { messageId: string }) {
  const msgQ = useQuery({
    queryKey: ['message', messageId],
    queryFn: async () => {
      const { data, error } = await supabase.from('messages').select('*').eq('id', messageId).single()
      if (error) throw error
      return data as Message
    },
  })
  const evQ = useQuery({
    queryKey: ['message_events', messageId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('message_status_events')
        .select('*')
        .eq('message_id', messageId)
        .order('occurred_at', { ascending: true })
      if (error) throw error
      return data as MessageStatusEvent[]
    },
  })
  useRealtimeInvalidate('messages', `id=eq.${messageId}`, [['message', messageId]])
  useRealtimeInvalidate('message_status_events', `message_id=eq.${messageId}`, [['message_events', messageId]])

  const msg = msgQ.data
  const events = evQ.data ?? []
  const at = (s: string) => events.find((e) => e.status === s)?.occurred_at ?? null
  const failed = msg?.status === 'failed'
  const rank = RANK[msg?.status ?? 'pending'] ?? 0
  const failEvent = events.find((e) => e.status === 'failed')

  return (
    <div>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TIMELINE.map((t) => {
          const reached = t.status === 'accepted' ? rank >= 1 || !!msg?.wa_message_id : rank >= RANK[t.status]
          const time = t.status === 'accepted' ? at('accepted') ?? msg?.created_at : at(t.status)
          return (
            <li
              key={t.status}
              className={cn(
                'rounded-lg border px-3 py-2.5 transition-colors',
                reached ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white',
              )}
            >
              <div className={cn('flex items-center gap-1.5 text-sm font-medium', reached ? 'text-emerald-800' : 'text-slate-400')}>
                <t.icon className={cn('size-4', t.status === 'read' && reached && 'text-sky-500')} />
                {t.label}
              </div>
              <p className="mt-0.5 font-mono text-xs text-slate-500">{reached ? formatTime(time) : 'aguardando…'}</p>
            </li>
          )
        })}
      </ol>
      {failed && (
        <Alert tone="error" title="A Meta reportou falha na entrega" className="mt-3">
          <pre className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(msg?.error ?? failEvent?.payload, null, 2)}</pre>
        </Alert>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Status recebidos em tempo real pelo webhook <code>messages</code> (assinatura <code>X-Hub-Signature-256</code> validada).
      </p>
    </div>
  )
}

export function SendPage() {
  const { active } = useAccounts()
  const { data: templates = [] } = useTemplates(active?.id)
  const [searchParams] = useSearchParams()
  const approved = useMemo(() => templates.filter((t) => t.status === 'APPROVED'), [templates])

  const [templateId, setTemplateId] = useState<string>(searchParams.get('template') ?? '')
  const [to, setTo] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [panel, setPanel] = useState<PanelState | null>(null)
  const [touched, setTouched] = useState(false)

  const template: Template | undefined = approved.find((t) => t.id === templateId) ?? approved[0]
  const slots = template ? getSlots(template.components) : null
  const missing = template ? requiredFieldKeys(template).filter((k) => !values[k]?.trim()) : []
  const phoneOk = isValidE164Digits(to)

  const recentQ = useQuery({
    queryKey: ['messages_recent', active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('wa_account_id', active!.id)
        .eq('direction', 'outbound')
        .is('campaign_id', null)
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return data as Message[]
    },
  })
  useRealtimeInvalidate('messages', active ? `wa_account_id=eq.${active.id}` : null, [['messages_recent', active?.id]])

  const previewValues = useMemo(() => {
    const header: Record<string, string> = {}
    const body: Record<string, string> = {}
    for (const k of slots?.headerVars ?? []) header[k] = values[fieldKey.header(k)] ?? ''
    for (const k of slots?.bodyVars ?? []) body[k] = values[fieldKey.body(k)] ?? ''
    return { header, body, mediaLink: values[fieldKey.media] }
  }, [slots, values])

  const setVal = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!active || !template || !phoneOk || missing.length) return
    setSending(true)
    const body = {
      wa_account_id: active.id,
      to: onlyDigits(to),
      template_name: template.name,
      language: template.language,
      params: buildSendParams(template, values),
      body_preview: renderBodyPreview(template, values),
    }
    try {
      const r = await callN8n<SendResult>('messages.send', body)
      setPanel({
        request: r.request,
        response: r.response,
        http_status: r.http_status ?? null,
        message_id: r.data?.message_id ?? null,
        label: `Envio para ${formatPhone(body.to)}`,
      })
      toast.success('Mensagem aceita pela Meta.')
    } catch (err) {
      const b = err instanceof ApiError ? (err.body as SendResult | null) : null
      setPanel({
        request: b?.request ?? null,
        response: b?.response ?? b ?? null,
        http_status: b?.http_status ?? (err instanceof ApiError ? err.status : null),
        message_id: b?.data?.message_id ?? null,
        label: `Envio para ${formatPhone(body.to)} (erro)`,
      })
      toast.error(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  if (!active) {
    return (
      <div>
        <PageHeader title="Enviar mensagem" />
        <Card>
          <EmptyState
            icon={<MessageSquare className="size-6" />}
            title="Conecte um número primeiro"
            action={
              <Link to="/conexao">
                <Button>Ir para Conexão</Button>
              </Link>
            }
          />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Enviar mensagem"
        description={
          <>
            Envio individual de template pelo número <strong className="text-slate-700">{formatPhone(active.display_phone_number)}</strong>. O
            painel abaixo mostra exatamente o que foi enviado à Meta e o que ela respondeu.
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="min-w-0">
          <CardHeader title="Mensagem" />
          {approved.length === 0 ? (
            <EmptyState
              title="Nenhum template aprovado"
              description="Mensagens iniciadas pela empresa precisam usar um template aprovado."
              action={
                <Link to="/templates">
                  <Button variant="secondary">Ver templates</Button>
                </Link>
              }
            />
          ) : (
            <form onSubmit={submit} className="space-y-5 p-5">
              <Field
                label="Número de destino"
                htmlFor="to"
                hint="Com DDI e DDD, só números. Ex.: 5511999998888"
                error={touched && !phoneOk ? 'Número inválido.' : undefined}
              >
                <Input
                  id="to"
                  inputMode="tel"
                  value={to}
                  onChange={(e) => setTo(onlyDigits(e.target.value))}
                  placeholder="5511999998888"
                  className="font-mono"
                />
              </Field>

              <Field label="Template" htmlFor="tpl">
                <Select
                  id="tpl"
                  value={template?.id ?? ''}
                  onChange={(e) => {
                    setTemplateId(e.target.value)
                    setValues({})
                  }}
                >
                  {approved.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.language} · {t.category}
                    </option>
                  ))}
                </Select>
              </Field>

              {slots && (slots.headerVars.length > 0 || slots.bodyVars.length > 0 || slots.urlButtonVars.length > 0 || (slots.headerFormat && slots.headerFormat !== 'TEXT')) && (
                <div className="space-y-4 rounded-lg bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Variáveis</p>
                  {slots.headerFormat && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(slots.headerFormat) && (
                    <Field label={`URL da mídia do cabeçalho (${slots.headerFormat.toLowerCase()})`}>
                      <Input value={values[fieldKey.media] ?? ''} onChange={(e) => setVal(fieldKey.media, e.target.value)} placeholder="https://…" />
                    </Field>
                  )}
                  {slots.headerVars.map((k) => (
                    <Field key={`h${k}`} label={<>Cabeçalho <code className="text-xs">{`{{${k}}}`}</code></>}>
                      <Input value={values[fieldKey.header(k)] ?? ''} onChange={(e) => setVal(fieldKey.header(k), e.target.value)} />
                    </Field>
                  ))}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {slots.bodyVars.map((k) => (
                      <Field key={`b${k}`} label={<>Corpo <code className="text-xs">{`{{${k}}}`}</code></>}>
                        <Input value={values[fieldKey.body(k)] ?? ''} onChange={(e) => setVal(fieldKey.body(k), e.target.value)} />
                      </Field>
                    ))}
                  </div>
                  {slots.urlButtonVars.map((b) => (
                    <Field key={`u${b.index}`} label={<>Botão “{b.text}” — sufixo da URL</>} hint={b.url}>
                      <Input value={values[fieldKey.button(b.index)] ?? ''} onChange={(e) => setVal(fieldKey.button(b.index), e.target.value)} />
                    </Field>
                  ))}
                </div>
              )}

              {touched && missing.length > 0 && <Alert tone="warning">Preencha todas as variáveis do template.</Alert>}

              <Button type="submit" loading={sending} className="w-full sm:w-auto">
                {!sending && <Send className="size-4" />} Enviar mensagem
              </Button>
            </form>
          )}
        </Card>

        <div className="min-w-0">
          <Card className="lg:sticky lg:top-8">
            <CardHeader title="Prévia" description={to ? `Para ${formatPhone(to)}` : undefined} />
            <div className="p-4">
              {template ? (
                <TemplatePreview components={template.components} values={previewValues} />
              ) : (
                <p className="text-sm text-slate-500">Selecione um template.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div id="json-panel" className="scroll-mt-6" />
      <Card className="mt-6">
        <CardHeader
          title="Payload × Resposta da Meta"
          description={
            panel ? panel.label : <>Chamada <code>POST /{'{phone_number_id}'}/messages</code> feita pelo n8n</>
          }
        />
        <div className="space-y-5 p-5">
          <JsonPanel request={panel?.request} response={panel?.response} httpStatus={panel?.http_status} />
          {panel?.message_id && <StatusTimeline messageId={panel.message_id} />}
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Últimos envios" description="Clique para carregar o JSON no painel acima." />
        {(recentQ.data ?? []).length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">Nenhum envio ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Quando</th>
                  <th className="px-4 py-3">Para</th>
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentQ.data!.map((m) => (
                  <tr
                    key={m.id}
                    className={cn('cursor-pointer hover:bg-slate-50', panel?.message_id === m.id && 'bg-brand-50/60')}
                    onClick={() => {
                      setPanel({
                        request: m.request_payload,
                        response: m.response_payload,
                        http_status: m.http_status,
                        message_id: m.id,
                        label: `Envio para ${formatPhone(m.to_number)} em ${formatDateTime(m.created_at)}`,
                      })
                      document.getElementById('json-panel')?.scrollIntoView({ behavior: 'smooth' })
                    }}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(m.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px]">{formatPhone(m.to_number)}</td>
                    <td className="px-4 py-3 font-mono text-[13px] text-slate-700">{m.template_name}</td>
                    <td className="px-4 py-3">
                      {m.status === 'failed' ? (
                        <span className="inline-flex items-center gap-1">
                          <CircleAlert className="size-4 text-red-600" /> <StatusBadge status={m.status} />
                        </span>
                      ) : (
                        <StatusBadge status={m.status} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

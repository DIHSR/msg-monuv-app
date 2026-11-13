import { useQuery } from '@tanstack/react-query'
import { Check, CheckCheck, CircleAlert, Clock, Send, ShieldAlert } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ConnectionSelect, NoConnection } from '../components/ConnectionSelect'
import { JsonPanel } from '../components/JsonPanel'
import { StatusBadge } from '../components/StatusBadge'
import { TemplatePreview } from '../components/TemplatePreview'
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Select } from '../components/ui'
import { useAccounts } from '../hooks/useAccounts'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { useTemplates } from '../hooks/useTemplates'
import { ApiError, callN8n, type ApiResult } from '../lib/api'
import { brToE164Digits, isValidBrLocal, maskBrPhone } from '../lib/phone'
import { supabase } from '../lib/supabase'
import { buildSendParams, fieldKey, getSlots, renderBodyPreview, requiredFieldKeys } from '../lib/templates'
import type { Message, MessageStatusEvent, Template } from '../lib/types'
import { cn, formatDateTime, formatPhone, formatTime, onlyDigits } from '../lib/utils'

type SendResult = ApiResult<{ message_id: string | null; wa_message_id: string | null }>

/** O que o painel "Detalhes do envio" mostra: a resposta do backend como veio. */
interface Details {
  result: SendResult | null
  /** status HTTP do n8n (para erros sem corpo, ex.: rede) */
  status: number | null
  fallbackError: string | null
  to: string
  at: string
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
  const rank = RANK[msg?.status ?? 'pending'] ?? 0
  const failEvent = events.find((e) => e.status === 'failed')

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Status de entrega (webhook)</p>
      <ol className="grid grid-cols-2 gap-2">
        {TIMELINE.map((t) => {
          const reached = t.status === 'accepted' ? rank >= 1 || !!msg?.wa_message_id : rank >= RANK[t.status]
          const time = t.status === 'accepted' ? (at('accepted') ?? msg?.created_at) : at(t.status)
          return (
            <li
              key={t.status}
              className={cn('rounded-lg border px-3 py-2 transition-colors', reached ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white')}
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
      {msg?.status === 'failed' && (
        <Alert tone="error" title="A Meta reportou falha na entrega" className="mt-3">
          <pre className="whitespace-pre-wrap font-mono text-xs">{JSON.stringify(msg?.error ?? failEvent?.payload, null, 2)}</pre>
        </Alert>
      )}
    </div>
  )
}

/** Coluna direita: alerta + PAYLOAD ENVIADO + RESPOSTA DA META, exatamente como o n8n devolveu. */
function SendDetails({ details }: { details: Details | null }) {
  const r = details?.result ?? null
  const ok = r?.ok === true
  const waId = r?.data?.wa_message_id ?? null
  const messageId = r?.data?.message_id ?? null
  const err = r?.error

  return (
    <Card className="min-w-0">
      <CardHeader
        title="Detalhes do envio"
        description={
          details ? (
            <>
              Para <span className="font-mono">{formatPhone(details.to)}</span> · {formatDateTime(details.at)}
            </>
          ) : (
            <>
              Chamada <code>POST /{'{phone_number_id}'}/messages</code> feita pelo servidor
            </>
          )
        }
      />
      <div className="space-y-4 p-5">
        {ok && (
          <Alert tone="success" title="Mensagem aceita pela Meta">
            ID da mensagem (wamid): <code className="break-all font-mono text-xs">{waId}</code>
          </Alert>
        )}
        {details && !ok && (
          <Alert tone="error" title={err?.code === 'internal' ? 'Erro interno' : 'Erro no envio'}>
            <p className="break-words">{err?.message ?? details.fallbackError}</p>
            {err?.ref && (
              <p className="mt-1 text-xs">
                Referência para o suporte: <code className="font-mono">{err.ref}</code>
              </p>
            )}
          </Alert>
        )}
        <JsonPanel
          stacked
          requestLabel="Payload enviado"
          responseLabel="Resposta da Meta"
          request={r?.request}
          response={r?.response}
          httpStatus={r?.http_status ?? null}
          requestPlaceholder="// O payload enviado à Meta aparecerá aqui"
          responsePlaceholder="// A resposta da Meta aparecerá aqui"
        />
        {messageId && ok && <StatusTimeline messageId={messageId} />}
      </div>
    </Card>
  )
}

export function SendPage() {
  const { accounts, active } = useAccounts()
  const { data: templates = [] } = useTemplates(active?.id)
  const [searchParams] = useSearchParams()
  const approved = useMemo(() => templates.filter((t) => t.status === 'APPROVED'), [templates])

  const [templateId, setTemplateId] = useState<string>(searchParams.get('template') ?? '')
  const [phone, setPhone] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [details, setDetails] = useState<Details | null>(null)
  const [touched, setTouched] = useState(false)

  const template: Template | undefined = approved.find((t) => t.id === templateId) ?? approved[0]
  const slots = template ? getSlots(template.components) : null
  const missing = template ? requiredFieldKeys(template).filter((k) => !values[k]?.trim()) : []
  const phoneOk = isValidBrLocal(phone)

  const recentQ = useQuery({
    queryKey: ['messages_recent', active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('wa_account_id', active!.id)
        .eq('direction', 'outbound')
        .eq('origin', 'api')
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
    const to = brToE164Digits(phone)
    const at = new Date().toISOString()
    try {
      const r = await callN8n<SendResult>('messages.send', {
        wa_account_id: active.id,
        to,
        template_name: template.name,
        language: template.language,
        params: buildSendParams(template, values),
        body_preview: renderBodyPreview(template, values),
      })
      setDetails({ result: r, status: 200, fallbackError: null, to, at })
      toast.success('Mensagem aceita pela Meta.')
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as SendResult | null) : null
      setDetails({
        result: body ?? { ok: false },
        status: err instanceof ApiError ? err.status : null,
        fallbackError: err instanceof Error ? err.message : 'Erro inesperado',
        to,
        at,
      })
    } finally {
      setSending(false)
    }
  }

  if (!accounts.length) {
    return (
      <div>
        <PageHeader title="Enviar mensagem" />
        <NoConnection />
      </div>
    )
  }

  const hasVars =
    !!slots &&
    (slots.headerVars.length > 0 || slots.bodyVars.length > 0 || slots.urlButtonVars.length > 0 || (!!slots.headerFormat && slots.headerFormat !== 'TEXT'))

  return (
    <div>
      <PageHeader
        title="Enviar mensagem"
        description="Envio individual de um template aprovado pela API oficial do WhatsApp. Em “Detalhes do envio”, o payload enviado à Meta e a resposta dela."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="min-w-0 self-start">
          <CardHeader title="Mensagem" />
          <form onSubmit={submit} className="space-y-5 p-5">
            <ConnectionSelect
              label="Conexão de origem"
              id="origin"
              hint="Número do WhatsApp pelo qual a mensagem sai."
            />

            {approved.length === 0 ? (
              <Alert tone="warning" title="Nenhum template aprovado nesta conexão">
                Mensagens iniciadas pela empresa precisam de um template aprovado.{' '}
                <Link to="/templates" className="underline">
                  Ver templates
                </Link>
              </Alert>
            ) : (
              <Field label="Template aprovado" htmlFor="tpl">
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
            )}

            {hasVars && slots && (
              <div className="space-y-4 rounded-lg bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Variáveis do template</p>
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
                  <Field key={`u${b.index}`} label={<>Botão “{b.text}” — complemento da URL</>} hint={b.url}>
                    <Input value={values[fieldKey.button(b.index)] ?? ''} onChange={(e) => setVal(fieldKey.button(b.index), e.target.value)} />
                  </Field>
                ))}
              </div>
            )}

            <Field
              label="Telefone do destinatário"
              htmlFor="to"
              hint="DDD + número. O +55 é adicionado automaticamente."
              error={touched && !phoneOk ? 'Informe DDD e número, ex.: (86) 99521-1166.' : undefined}
            >
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-100 px-3 font-mono text-sm text-slate-600">
                  +55
                </span>
                <Input
                  id="to"
                  inputMode="tel"
                  autoComplete="off"
                  value={maskBrPhone(phone)}
                  onChange={(e) => setPhone(onlyDigits(e.target.value).slice(0, 11))}
                  placeholder="(00) 00000-0000"
                  className="rounded-l-none font-mono"
                />
              </div>
            </Field>

            {touched && missing.length > 0 && <Alert tone="warning">Preencha todas as variáveis do template.</Alert>}

            <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <p>
                Envie apenas para contatos que <strong>autorizaram receber</strong> mensagens da sua empresa. Quem pedir para sair deve ser
                removido imediatamente.
              </p>
            </div>

            <Button type="submit" loading={sending} disabled={!template} className="w-full">
              {!sending && <Send className="size-4" />} Enviar mensagem
            </Button>

            {template && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Prévia</p>
                <TemplatePreview components={template.components} values={previewValues} />
              </div>
            )}
          </form>
        </Card>

        <div className="min-w-0">
          <div className="lg:sticky lg:top-8">
            <SendDetails details={details} />
          </div>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title="Últimos envios individuais" description="Clique em um envio para ver o JSON em Detalhes do envio." />
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
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => {
                      const ok = !!m.wa_message_id
                      const err = m.error as { message?: string } | null
                      setDetails({
                        result: {
                          ok,
                          request: m.request_payload,
                          response: m.response_payload,
                          http_status: m.http_status,
                          data: { message_id: m.id, wa_message_id: m.wa_message_id },
                          ...(ok ? {} : { error: { code: 'meta_error', message: err?.message ?? 'A Meta recusou a mensagem.' } }),
                        },
                        status: m.http_status,
                        fallbackError: null,
                        to: m.to_number ?? '',
                        at: m.created_at,
                      })
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(m.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px]">{formatPhone(m.to_number)}</td>
                    <td className="px-4 py-3 font-mono text-[13px] text-slate-700">{m.template_name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1">
                        {m.status === 'failed' && <CircleAlert className="size-4 text-red-600" />}
                        <StatusBadge status={m.status} />
                      </span>
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

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Unplug,
  Webhook,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { JsonPanel } from '../components/JsonPanel'
import { StatusBadge } from '../components/StatusBadge'
import { Alert, Button, Card, CardHeader, EmptyState, Modal, PageHeader, Spinner } from '../components/ui'
import { embeddedSignupConfigured } from '../config'
import { useAccounts } from '../hooks/useAccounts'
import { inactivityDays } from '../lib/accounts'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { ApiError, callN8n, errorMessage, type ApiResult } from '../lib/api'
import { EmbeddedSignupCancelled, launchEmbeddedSignup } from '../lib/facebook'
import { supabase } from '../lib/supabase'
import type { AccountIssue, WaAccount, WaAccountEvent } from '../lib/types'
import { cn, formatDateTime, formatMessagingLimit, formatPhone, formatRelative } from '../lib/utils'

interface Step {
  name: string
  ok: boolean
  request?: unknown
  response?: unknown
  http_status?: number
}

interface AccountResult extends ApiResult<{ account?: WaAccount; coexistence?: boolean }> {
  steps?: Step[]
}

const STEP_LABELS: Record<string, string> = {
  exchange_code: 'Troca do code por token de acesso',
  debug_token: 'Validação das permissões concedidas',
  list_phone_numbers: 'Números da conta do WhatsApp Business',
  subscribe_app: 'Inscrição do app na WABA (webhooks)',
  subscribed_apps: 'Conferência da inscrição (subscribed_apps)',
  register_phone: 'Registro do número na Cloud API',
  sync_smb_app_state_sync: 'Sincronização dos contatos do app WhatsApp Business',
  sync_history: 'Sincronização do histórico de conversas do app',
  phone_details: 'Dados do número',
  messaging_limit: 'Limite de envio',
  waba_details: 'Dados da WABA',
  save_account: 'Gravação da conexão',
}

/** Fases mostradas enquanto o es.exchange (uma chamada só) trabalha no n8n. */
const EXCHANGE_PHASES = [
  'Trocando o código de autorização por um token',
  'Validando as permissões concedidas',
  'Inscrevendo o app nos webhooks da WABA',
  'Lendo os dados do número',
  'Gravando a conexão',
]

const EVENT_LABELS: Record<string, string> = {
  PARTNER_ADDED: 'Conta compartilhada com a Monuv',
  PARTNER_REMOVED: 'Conta deixou de ser compartilhada',
  ACCOUNT_OFFBOARDED: 'Número saiu da coexistência',
  ACCOUNT_RECONNECTED: 'Número reconectado',
  PARTNER_APP_UNINSTALLED: 'Permissões do app removidas',
  ACCOUNT_DELETED: 'Conta excluída na Meta',
  ACCOUNT_VIOLATION: 'Violação de política',
  ACCOUNT_RESTRICTION: 'Conta restringida',
  DISABLED_UPDATE: 'Atualização de bloqueio',
  INACTIVITY_WARNING: 'Alerta: celular sem atividade',
  DISCONNECTED_BY_USER: 'Desconectada pela tela',
  FLAGGED: 'Qualidade baixa',
  UNFLAGGED: 'Qualidade normalizada',
  UPGRADE: 'Limite de envio aumentou',
  DOWNGRADE: 'Limite de envio diminuiu',
  THROUGHPUT_UPGRADE: 'Vazão do número aumentou',
  ONBOARDING: 'Número em registro',
}

function issueOf(a: WaAccount): AccountIssue | null {
  return a.last_error && typeof a.last_error === 'object' ? (a.last_error as AccountIssue) : null
}

// ---------------------------------------------------------------------------
// Componentes
// ---------------------------------------------------------------------------

function StepsLog({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <ol className="divide-y divide-slate-100">
      {steps.map((s, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50"
          >
            {s.ok ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" /> : <CircleAlert className="size-5 shrink-0 text-red-600" />}
            <span className="flex-1 text-sm text-slate-800">{STEP_LABELS[s.name] ?? s.name}</span>
            {s.http_status ? <span className="font-mono text-xs text-slate-500">HTTP {s.http_status}</span> : null}
            <ChevronDown className={cn('size-4 text-slate-400 transition-transform', open === i && 'rotate-180')} />
          </button>
          {open === i && (
            <div className="px-5 pb-5">
              <JsonPanel request={s.request} response={s.response} httpStatus={s.http_status} requestLabel="Requisição" />
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={cn('mt-0.5 truncate text-sm text-slate-900', mono && 'font-mono text-[13px]')}>{value ?? '—'}</dd>
    </div>
  )
}

function ModeBadge({ coexistence }: { coexistence: boolean }) {
  return coexistence ? (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-600/20"
      title="O número continua funcionando no app WhatsApp Business do celular e também pela API oficial."
    >
      <Smartphone className="size-3" /> Coexistência
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-500/20">
      Cloud API
    </span>
  )
}

/** Lacuna 3: aviso ANTES de a Meta desconectar a coexistência por inatividade do celular. */
function InactivityAlert({ account }: { account: WaAccount }) {
  const days = inactivityDays(account)
  if (days === null) return null
  return (
    <Alert tone="warning" title={`Abra o WhatsApp Business no celular — ${days} dias sem atividade`}>
      A Meta desconecta a coexistência quando o app fica cerca de 14 dias sem ser aberto no celular principal. Abra o
      WhatsApp Business no aparelho deste número para manter a conexão. Última atividade: {formatDateTime(account.last_seen_at ?? account.connected_at)}.
    </Alert>
  )
}

function IssueAlert({ account }: { account: WaAccount }) {
  const issue = issueOf(account)
  if (!issue) return null
  const disconnected = account.status === 'disconnected'
  const title = disconnected
    ? 'Conexão encerrada'
    : account.status === 'error'
      ? 'Erro na conexão'
      : account.status === 'pending'
        ? 'Conexão incompleta'
        : 'Aviso da Meta'
  const detail =
    issue.message ??
    (issue.steps?.length
      ? `Etapas que falharam: ${issue.steps.map((s) => STEP_LABELS[s] ?? s).join(', ')}. Clique em "Atualizar" para tentar de novo.`
      : null)
  return (
    <Alert tone={disconnected || account.status === 'error' ? 'error' : 'warning'} title={title}>
      {detail && <p>{detail}</p>}
      {(issue.event || issue.reason) && (
        <p className="mt-1 font-mono text-xs opacity-80">
          {[issue.event, issue.reason && issue.reason !== issue.event ? issue.reason : null].filter(Boolean).join(' · ')}
        </p>
      )}
      {!detail && !issue.event && <pre className="mt-1 whitespace-pre-wrap font-mono text-xs">{JSON.stringify(issue, null, 2)}</pre>}
    </Alert>
  )
}

function AccountEvents({ accountId }: { accountId: string }) {
  const q = useQuery({
    queryKey: ['wa_account_events', accountId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wa_account_events')
        .select('*')
        .eq('wa_account_id', accountId)
        .order('occurred_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return data as WaAccountEvent[]
    },
  })
  useRealtimeInvalidate('wa_account_events', `wa_account_id=eq.${accountId}`, [['wa_account_events', accountId]])
  const rows = q.data ?? []
  if (q.isLoading) return <Spinner className="m-5" />
  if (!rows.length) return <p className="px-5 py-4 text-sm text-slate-500">Nenhum evento da Meta registrado ainda.</p>
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-sm">
          <span className="w-36 shrink-0 text-xs text-slate-500">{formatDateTime(e.occurred_at)}</span>
          <span className="font-medium text-slate-800">{EVENT_LABELS[e.event ?? ''] ?? e.event ?? e.field}</span>
          <span className="font-mono text-xs text-slate-400">{e.field}</span>
        </li>
      ))}
    </ul>
  )
}

function AccountCard({ account, onReconnect }: { account: WaAccount; onReconnect: () => void }) {
  const qc = useQueryClient()
  const { profile } = useAuth()
  const [busy, setBusy] = useState<null | 'refresh' | 'disconnect'>(null)
  const [result, setResult] = useState<AccountResult | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [showEvents, setShowEvents] = useState(false)
  const disconnected = account.status === 'disconnected'

  const run = async (action: 'connection.refresh' | 'connection.disconnect') => {
    setBusy(action === 'connection.refresh' ? 'refresh' : 'disconnect')
    try {
      const r = await callN8n<AccountResult>(action, { wa_account_id: account.id })
      setResult(r)
      toast.success(action === 'connection.refresh' ? 'Dados atualizados com a Meta.' : 'Número desconectado.')
    } catch (err) {
      if (err instanceof ApiError && err.body) setResult(err.body as AccountResult)
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
      setConfirm(false)
      qc.invalidateQueries({ queryKey: ['wa_accounts'] })
    }
  }

  const resultSteps: Step[] =
    result?.steps ??
    (result?.request ? [{ name: 'Chamada à Meta', ok: !!result.ok, request: result.request, response: result.response, http_status: result.http_status ?? undefined }] : [])

  return (
    <Card className={cn(disconnected && 'opacity-80')}>
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="flex min-w-0 items-center gap-4">
          <div
            className={cn(
              'flex size-12 shrink-0 items-center justify-center rounded-full',
              disconnected ? 'bg-slate-100 text-slate-400' : 'bg-brand-50 text-brand-700',
            )}
          >
            <Smartphone className="size-6" />
          </div>
          <div className="min-w-0">
            <p className="font-mono text-lg font-semibold text-slate-900">{formatPhone(account.display_phone_number)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="truncate text-sm text-slate-600">{account.verified_name ?? 'Nome não verificado'}</span>
              <StatusBadge status={account.status} />
              <ModeBadge coexistence={account.is_on_biz_app} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {disconnected ? (
            <Button size="sm" onClick={onReconnect}>
              <Plug className="size-4" /> Reconectar
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={() => run('connection.refresh')} loading={busy === 'refresh'} disabled={!!busy}>
                {busy !== 'refresh' && <RefreshCw className="size-4" />} Atualizar
              </Button>
              {!profile?.is_demo && (
                <Button variant="secondary" size="sm" onClick={() => setConfirm(true)} disabled={!!busy}>
                  <Unplug className="size-4" /> Desconectar
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="space-y-3 px-5 empty:hidden">
        <InactivityAlert account={account} />
        <IssueAlert account={account} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-100 px-5 py-4 sm:grid-cols-3 lg:grid-cols-4">
        <InfoRow label="Modo" value={account.is_on_biz_app ? 'Coexistência (app + API)' : 'Cloud API'} />
        <InfoRow
          label="Webhooks"
          value={
            <span className={cn('inline-flex items-center gap-1', account.webhook_subscribed ? 'text-emerald-700' : 'text-amber-700')}>
              <Webhook className="size-3.5" /> {account.webhook_subscribed ? 'Inscrito' : 'Não inscrito'}
            </span>
          }
        />
        <InfoRow label="Qualidade do número" value={<StatusBadge status={account.quality_rating ?? 'UNKNOWN'} />} />
        <InfoRow label="Limite de envio" value={formatMessagingLimit(account.messaging_limit)} />
        <InfoRow
          label={account.is_on_biz_app ? 'Última atividade no celular' : 'Última atualização'}
          value={
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5 text-slate-400" />
              {formatRelative(account.is_on_biz_app ? (account.last_seen_at ?? account.connected_at) : account.updated_at)}
            </span>
          }
        />
        <InfoRow label="Conectada em" value={formatDateTime(account.connected_at)} />
        <InfoRow label="WABA" value={account.waba_name ?? account.waba_id} />
        <InfoRow label="WABA ID" value={account.waba_id} mono />
        <InfoRow label="Phone number ID" value={account.phone_number_id} mono />
        {disconnected && <InfoRow label="Desconectada em" value={formatDateTime(account.disconnected_at)} />}
      </dl>

      <div className="border-t border-slate-100">
        <button
          type="button"
          onClick={() => setShowEvents((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Eventos da Meta (qualidade, limite, desconexões)
          <ChevronDown className={cn('size-4 text-slate-400 transition-transform', showEvents && 'rotate-180')} />
        </button>
        {showEvents && <AccountEvents accountId={account.id} />}
      </div>

      {resultSteps.length > 0 && (
        <div className="border-t border-slate-100">
          <p className="px-5 pt-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Chamadas à Graph API</p>
          <StepsLog steps={resultSteps} />
        </div>
      )}

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Desconectar este número?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => run('connection.disconnect')} loading={busy === 'disconnect'}>
              Desconectar
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            <strong className="font-mono">{formatPhone(account.display_phone_number)}</strong> deixa de enviar e receber mensagens pelo Monuv
            Mensagens e o token de acesso é apagado.
          </p>
          {account.is_on_biz_app && <p>O número continua funcionando normalmente no app WhatsApp Business do celular.</p>}
          <p>Para usar de novo, será preciso conectar pelo cadastro da Meta outra vez.</p>
        </div>
      </Modal>
    </Card>
  )
}

/** Avisos obrigatórios antes de abrir o Embedded Signup (spec v2, 4.2). */
function ConnectWarnings({ open, onClose, onContinue }: { open: boolean; onClose: () => void; onContinue: () => void }) {
  const [ack, setAck] = useState(false)
  const close = () => {
    setAck(false)
    onClose()
  }
  const items = [
    {
      t: 'WhatsApp Business 2.24.17 ou mais recente',
      d: 'Atualize o app WhatsApp Business no celular antes de continuar. Versões antigas não aparecem na opção de manter o app.',
    },
    {
      t: 'Aparelhos vinculados serão desconectados',
      d: 'O WhatsApp Web e outros dispositivos vinculados saem durante a conexão e precisam ser vinculados de novo depois.',
    },
    {
      t: 'Abra o app no celular pelo menos a cada 2 semanas',
      d: 'Se o WhatsApp Business ficar cerca de 14 dias sem ser aberto no celular, a Meta desconecta o número da plataforma.',
    },
  ]
  return (
    <Modal
      open={open}
      onClose={close}
      title="Antes de conectar"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button
            disabled={!ack}
            onClick={() => {
              setAck(false)
              onContinue()
            }}
          >
            <Plug className="size-4" /> Continuar com o Facebook
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600">
        Você vai abrir a janela oficial da Meta. Se o número já usa o app WhatsApp Business, ele continua funcionando no celular, com
        conversas e contatos preservados.
      </p>
      <ul className="mt-4 space-y-3">
        {items.map((i) => (
          <li key={i.t} className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-900">{i.t}</p>
              <p className="text-sm text-amber-900/80">{i.d}</p>
            </div>
          </li>
        ))}
      </ul>
      <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-brand-700" />
        Li e entendi os três avisos acima.
      </label>
    </Modal>
  )
}

function ExchangeProgress({ phase }: { phase: 'popup' | 'exchange' }) {
  const [tick, setTick] = useState(0)
  // avança as fases a cada ~1,5 s enquanto o n8n trabalha (é uma chamada só, sem progresso real)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1500)
    return () => clearInterval(t)
  }, [])
  const current = phase === 'exchange' ? Math.min(tick, EXCHANGE_PHASES.length - 1) : -1
  return (
    <Card className="mb-6">
      <CardHeader
        title={phase === 'popup' ? 'Aguardando a janela da Meta…' : 'Finalizando a conexão…'}
        description={
          phase === 'popup'
            ? 'Conclua o cadastro na janela do Facebook. Se ela não abriu, verifique o bloqueador de pop-ups.'
            : 'O servidor está fazendo várias chamadas à Meta. Isso pode levar alguns segundos.'
        }
      />
      {phase === 'exchange' && (
        <ol className="space-y-2 p-5">
          {EXCHANGE_PHASES.map((p, i) => (
            <li key={p} className={cn('flex items-center gap-2 text-sm', i <= current ? 'text-slate-800' : 'text-slate-400')}>
              {i < current ? (
                <CheckCircle2 className="size-4 text-emerald-600" />
              ) : i === current ? (
                <Loader2 className="size-4 animate-spin text-brand-700" />
              ) : (
                <span className="size-4 rounded-full border border-slate-300" />
              )}
              {p}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function ConnectionPage() {
  const { all, isLoading, setActiveId } = useAccounts()
  const qc = useQueryClient()
  const [warnOpen, setWarnOpen] = useState(false)
  const [busy, setBusy] = useState<null | 'popup' | 'exchange'>(null)
  const [result, setResult] = useState<AccountResult | null>(null)
  const [error, setError] = useState<{ title: string; message: string } | null>(null)

  const esReady = embeddedSignupConfigured()
  const active = all.filter((a) => a.status !== 'disconnected')
  const disconnected = all.filter((a) => a.status === 'disconnected')

  const connect = async () => {
    setWarnOpen(false)
    setError(null)
    setResult(null)
    setBusy('popup')
    try {
      const es = await launchEmbeddedSignup()
      setBusy('exchange')
      const r = await callN8n<AccountResult>('es.exchange', {
        code: es.code,
        waba_id: es.waba_id,
        phone_number_id: es.phone_number_id,
        business_id: es.business_id,
        event: es.event,
        is_on_biz_app: es.is_on_biz_app,
      })
      setResult(r)
      const acc = r.data?.account
      if (acc) setActiveId(acc.id)
      if (acc?.status === 'connected') {
        toast.success(r.data?.coexistence ? 'Número conectado! Ele continua funcionando no app WhatsApp Business.' : 'Número conectado!')
      } else {
        toast.warning('Número vinculado, mas a conexão ficou incompleta. Veja as etapas abaixo.')
      }
    } catch (err) {
      if (err instanceof EmbeddedSignupCancelled) {
        setError({ title: 'Cadastro cancelado', message: `${err.message} Nenhuma alteração foi feita. Você pode tentar de novo quando quiser.` })
      } else {
        if (err instanceof ApiError && err.body) setResult(err.body as AccountResult)
        setError({ title: 'Não foi possível concluir a conexão', message: errorMessage(err) })
      }
    } finally {
      setBusy(null)
      qc.invalidateQueries({ queryKey: ['wa_accounts'] })
    }
  }

  const connectButton = (
    <Button onClick={() => setWarnOpen(true)} loading={!!busy} disabled={!esReady}>
      {!busy && <Plug className="size-4" />}
      {busy === 'popup' ? 'Aguardando a Meta…' : busy === 'exchange' ? 'Finalizando…' : 'Conectar WhatsApp'}
    </Button>
  )

  return (
    <div>
      <PageHeader
        title="Conexões"
        description="Números do WhatsApp conectados pela API oficial da Meta. Cada conexão envia e recebe pelo próprio número."
        actions={connectButton}
      />

      {!esReady && (
        <Alert tone="warning" title="Embedded Signup não configurado" className="mb-6">
          Defina <code>VITE_META_APP_ID</code> e <code>VITE_META_CONFIG_ID</code> no ambiente do front.
        </Alert>
      )}
      {error && (
        <Alert tone="error" title={error.title} className="mb-6">
          {error.message}
        </Alert>
      )}
      {busy && <ExchangeProgress key={busy} phase={busy} />}

      {result?.steps && result.steps.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Etapas da conexão" description="Chamadas feitas à Graph API pelo servidor. Clique para ver o JSON." />
          <StepsLog steps={result.steps} />
        </Card>
      )}

      {isLoading ? (
        <Spinner />
      ) : active.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Plug className="size-6" />}
            title="Nenhum número conectado"
            description="Você será levado à janela oficial da Meta. Se o número já está no app WhatsApp Business, ele continua funcionando no celular."
            action={connectButton}
          />
          <div className="grid gap-4 border-t border-slate-100 p-5 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, t: '1. Entre com o Facebook', d: 'Autorize o app Monuv na sua conta empresarial da Meta.' },
              { icon: Smartphone, t: '2. Escolha o número', d: 'Usa o WhatsApp Business? Escaneie o QR code e continue usando o app.' },
              { icon: Webhook, t: '3. Pronto', d: 'Inscrevemos os webhooks e conferimos a inscrição automaticamente.' },
            ].map((s) => (
              <div key={s.t} className="flex gap-3">
                <s.icon className="mt-0.5 size-5 shrink-0 text-brand-700" />
                <div>
                  <p className="text-sm font-medium text-slate-800">{s.t}</p>
                  <p className="text-sm text-slate-500">{s.d}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {active.map((a) => (
            <AccountCard key={a.id} account={a} onReconnect={() => setWarnOpen(true)} />
          ))}
        </div>
      )}

      {disconnected.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">Desconectadas</h2>
          <div className="space-y-4">
            {disconnected.map((a) => (
              <AccountCard key={a.id} account={a} onReconnect={() => setWarnOpen(true)} />
            ))}
          </div>
        </div>
      )}

      <ConnectWarnings open={warnOpen} onClose={() => setWarnOpen(false)} onContinue={connect} />
    </div>
  )
}

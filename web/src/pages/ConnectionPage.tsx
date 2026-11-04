import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, CircleAlert, Plug, RefreshCw, ShieldCheck, Smartphone, Webhook } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { JsonPanel } from '../components/JsonPanel'
import { StatusBadge } from '../components/StatusBadge'
import { Alert, Button, Card, CardHeader, EmptyState, PageHeader, Spinner } from '../components/ui'
import { config } from '../config'
import { useAccounts } from '../hooks/useAccounts'
import { ApiError, callN8n, errorMessage } from '../lib/api'
import { EmbeddedSignupCancelled, launchEmbeddedSignup } from '../lib/facebook'
import type { WaAccount } from '../lib/types'
import { cn, formatDateTime, formatPhone } from '../lib/utils'

interface Step {
  name: string
  ok: boolean
  request?: unknown
  response?: unknown
  http_status?: number
}

interface ExchangeResult {
  ok: boolean
  account?: WaAccount
  coexistence?: boolean
  steps?: Step[]
  error?: { message: string }
}

const STEP_LABELS: Record<string, string> = {
  exchange_code: 'Troca do code por token de acesso',
  debug_token: 'Validação das permissões concedidas',
  subscribe_app: 'Assinatura do app na WABA (webhooks)',
  register_phone: 'Registro do número na Cloud API',
  sync_smb_app_state_sync: 'Sincronização dos contatos do app WhatsApp Business',
  sync_history: 'Sincronização do histórico de conversas do app',
  phone_details: 'Dados do número',
  waba_details: 'Dados da WABA',
  save_account: 'Gravação da conexão',
  subscribed_apps: 'Verificação de assinatura de webhooks',
}

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
            {s.ok ? (
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
            ) : (
              <CircleAlert className="size-5 shrink-0 text-red-600" />
            )}
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

function AccountCard({ account }: { account: WaAccount }) {
  const qc = useQueryClient()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ExchangeResult | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const r = await callN8n<ExchangeResult>('connection.refresh', { wa_account_id: account.id })
      setResult(r)
      toast.success('Status atualizado com a Meta.')
    } catch (err) {
      if (err instanceof ApiError) setResult(err.body as ExchangeResult)
      toast.error(errorMessage(err))
    } finally {
      setLoading(false)
      qc.invalidateQueries({ queryKey: ['wa_accounts'] })
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <Smartphone className="size-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-semibold text-slate-900">{account.verified_name ?? 'Nome não verificado'}</p>
              <StatusBadge status={account.status} />
              {account.is_on_biz_app && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-600/20"
                  title="O número continua funcionando no app WhatsApp Business do celular e também pela API oficial."
                >
                  <Smartphone className="size-3" /> App + API (coexistência)
                </span>
              )}
            </div>
            <p className="font-mono text-sm text-slate-600">{formatPhone(account.display_phone_number)}</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={refresh} loading={loading}>
          {!loading && <RefreshCw className="size-4" />} Atualizar status
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-100 px-5 py-4 sm:grid-cols-3 lg:grid-cols-4">
        <InfoRow label="WABA" value={account.waba_name ?? account.waba_id} />
        <InfoRow label="WABA ID" value={account.waba_id} mono />
        <InfoRow label="Phone number ID" value={account.phone_number_id} mono />
        <InfoRow label="Qualidade" value={<StatusBadge status={account.quality_rating ?? 'UNKNOWN'} />} />
        <InfoRow label="Status do nome" value={account.name_status} />
        <InfoRow label="Verificação do código" value={account.code_verification_status} />
        <InfoRow
          label="Webhooks"
          value={
            <span className={cn('inline-flex items-center gap-1', account.webhook_subscribed ? 'text-emerald-700' : 'text-amber-700')}>
              <Webhook className="size-3.5" /> {account.webhook_subscribed ? 'Assinado' : 'Não assinado'}
            </span>
          }
        />
        <InfoRow label="Modo" value={account.is_on_biz_app ? 'Coexistência (app + API)' : 'Somente API'} />
        <InfoRow label="Conectado em" value={formatDateTime(account.connected_at)} />
      </dl>
      {result?.steps && result.steps.length > 0 && (
        <div className="border-t border-slate-100">
          <StepsLog steps={result.steps} />
        </div>
      )}
    </Card>
  )
}

export function ConnectionPage() {
  const { accounts, isLoading, setActiveId } = useAccounts()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<null | 'popup' | 'exchange'>(null)
  const [result, setResult] = useState<ExchangeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const esConfigured = !!config.fbAppId && !!config.fbEsConfigId

  const connect = async () => {
    setError(null)
    setResult(null)
    setBusy('popup')
    try {
      const es = await launchEmbeddedSignup()
      setBusy('exchange')
      const r = await callN8n<ExchangeResult>('es.exchange', {
        code: es.code,
        waba_id: es.waba_id,
        phone_number_id: es.phone_number_id,
        business_id: es.business_id,
        is_on_biz_app: es.is_on_biz_app,
        event: es.event,
      })
      setResult(r)
      if (r.account) setActiveId(r.account.id)
      toast.success(
        r.coexistence
          ? 'Número conectado! Ele continua funcionando no app WhatsApp Business do celular.'
          : 'Número conectado com sucesso!',
      )
      qc.invalidateQueries({ queryKey: ['wa_accounts'] })
    } catch (err) {
      if (err instanceof EmbeddedSignupCancelled) {
        setError(err.message)
      } else {
        if (err instanceof ApiError) setResult(err.body as ExchangeResult)
        setError(errorMessage(err))
      }
    } finally {
      setBusy(null)
    }
  }

  const connectButton = (
    <Button onClick={connect} loading={!!busy} disabled={!esConfigured}>
      {!busy && <Plug className="size-4" />}
      {busy === 'popup' ? 'Aguardando a Meta…' : busy === 'exchange' ? 'Finalizando conexão…' : 'Conectar com o Facebook'}
    </Button>
  )

  return (
    <div>
      <PageHeader
        title="Conexão com o WhatsApp"
        description="Conecte o número da sua empresa pelo cadastro oficial da Meta (Embedded Signup). Nós nunca vemos sua senha do Facebook."
        actions={accounts.length > 0 ? connectButton : undefined}
      />

      {!esConfigured && (
        <Alert tone="warning" title="Embedded Signup não configurado" className="mb-6">
          Defina <code>VITE_FB_APP_ID</code> e <code>VITE_FB_ES_CONFIG_ID</code> no ambiente do front.
        </Alert>
      )}
      {error && (
        <Alert tone="error" title="Não foi possível concluir a conexão" className="mb-6">
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Spinner />
      ) : accounts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Plug className="size-6" />}
            title="Nenhum número conectado"
            description="Você será levado a uma janela da Meta. Se o número já está no app WhatsApp Business, ele continua funcionando no celular (coexistência)."
            action={connectButton}
          />
          <div className="grid gap-4 border-t border-slate-100 p-5 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, t: '1. Entre com o Facebook', d: 'Autorize o acesso do app Monuv à sua conta empresarial.' },
              {
                icon: Smartphone,
                t: '2. Escolha o número',
                d: 'Usa o app WhatsApp Business? Escaneie o QR code no celular e continue usando o app. Número novo? Confirme por SMS.',
              },
              { icon: Webhook, t: '3. Pronto', d: 'Ativamos o número na API oficial e assinamos os webhooks automaticamente.' },
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
          {accounts.map((a) => (
            <AccountCard key={a.id} account={a} />
          ))}
        </div>
      )}

      {result?.steps && result.steps.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Etapas da conexão" description="Chamadas feitas à Graph API durante o cadastro. Clique para ver o JSON." />
          <StepsLog steps={result.steps} />
        </Card>
      )}
    </div>
  )
}

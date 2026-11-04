import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Layers, Play, Upload } from 'lucide-react'
import Papa from 'papaparse'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { StatusBadge } from '../components/StatusBadge'
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select } from '../components/ui'
import { useAccounts } from '../hooks/useAccounts'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { callN8n, errorMessage } from '../lib/api'
import { supabase } from '../lib/supabase'
import { buildSendParams, fieldKey, getSlots, requiredFieldKeys } from '../lib/templates'
import type { Campaign, CampaignRecipient, Template } from '../lib/types'
import { formatDateTime, formatPhone, isValidE164Digits, onlyDigits } from '../lib/utils'
import { useTemplates } from '../hooks/useTemplates'

const MAX_ROWS = 5000
const CHUNK = 500

type Row = Record<string, string>

function fieldLabel(template: Template, key: string) {
  const s = getSlots(template.components)
  if (key === fieldKey.media) return 'Mídia do cabeçalho (URL)'
  const [section, k] = key.split('.')
  if (section === 'header') return `Cabeçalho {{${k}}}`
  if (section === 'body') return `Corpo {{${k}}}`
  const btn = s.urlButtonVars.find((b) => String(b.index) === k)
  return `Botão “${btn?.text ?? k}” (sufixo URL)`
}

function CampaignRow({ c, onOpen, open }: { c: Campaign; onOpen: () => void; open: boolean }) {
  const done = c.sent_count + c.failed_count
  const pct = c.total ? Math.round((done / c.total) * 100) : 0
  return (
    <div>
      <button onClick={onOpen} className="w-full px-5 py-4 text-left hover:bg-slate-50">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{c.name}</p>
            <p className="font-mono text-xs text-slate-500">
              {c.template_name} · {formatDateTime(c.created_at)}
            </p>
          </div>
          <StatusBadge status={c.status} />
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {c.sent_count} enviadas · {c.failed_count} falhas · {c.total} no total ({pct}%)
        </p>
      </button>
      {open && <CampaignFailures campaignId={c.id} />}
    </div>
  )
}

function CampaignFailures({ campaignId }: { campaignId: string }) {
  const q = useQuery({
    queryKey: ['campaign_failures', campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaign_recipients')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('status', 'failed')
        .limit(100)
      if (error) throw error
      return data as CampaignRecipient[]
    },
  })
  const rows = q.data ?? []
  return (
    <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma falha registrada.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="rounded-md bg-white p-2 ring-1 ring-slate-200">
              <span className="font-mono">{formatPhone(r.to_number)}</span>
              <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-red-700">{JSON.stringify(r.error)}</pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function BulkPage() {
  const { profile } = useAuth()
  const { active } = useAccounts()
  const qc = useQueryClient()
  const { data: templates = [] } = useTemplates(active?.id)
  const approved = templates.filter((t) => t.status === 'APPROVED')

  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [phoneCol, setPhoneCol] = useState('')
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const campaignsQ = useQuery({
    queryKey: ['campaigns', active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('wa_account_id', active!.id)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data as Campaign[]
    },
  })
  useRealtimeInvalidate('campaigns', active ? `wa_account_id=eq.${active.id}` : null, [['campaigns', active?.id]])

  const template = approved.find((t) => t.id === templateId)
  const needed = template ? requiredFieldKeys(template) : []

  const stats = useMemo(() => {
    if (!phoneCol) return { valid: 0, invalid: rows.length }
    let valid = 0
    for (const r of rows) if (isValidE164Digits(r[phoneCol] ?? '')) valid++
    return { valid, invalid: rows.length - valid }
  }, [rows, phoneCol])

  const onFile = (file: File) => {
    setFileName(file.name)
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data.slice(0, MAX_ROWS)
        setRows(data)
        const cols = res.meta.fields ?? []
        setColumns(cols)
        setPhoneCol(cols.find((c) => /telefone|phone|celular|whats|numero|número/i.test(c)) ?? '')
        if (res.data.length > MAX_ROWS) toast.warning(`Apenas as primeiras ${MAX_ROWS} linhas foram carregadas.`)
      },
      error: (err) => toast.error(`Erro ao ler CSV: ${err.message}`),
    })
  }

  const canCreate = !!active && !!template && !!name.trim() && !!phoneCol && stats.valid > 0 && needed.every((k) => mapping[k])

  const create = async () => {
    if (!canCreate || !template || !active) return
    setCreating(true)
    try {
      const recipients = rows
        .filter((r) => isValidE164Digits(r[phoneCol] ?? ''))
        .map((r) => {
          const values: Record<string, string> = {}
          for (const k of needed) values[k] = r[mapping[k]] ?? ''
          return { to_number: onlyDigits(r[phoneCol]), params: buildSendParams(template, values) }
        })

      const { data: camp, error } = await supabase
        .from('campaigns')
        .insert({
          wa_account_id: active.id,
          name: name.trim(),
          template_name: template.name,
          template_language: template.language,
        })
        .select()
        .single()
      if (error) throw error

      for (let i = 0; i < recipients.length; i += CHUNK) {
        const chunk = recipients.slice(i, i + CHUNK).map((r) => ({ ...r, campaign_id: camp.id }))
        const { error: e2 } = await supabase.from('campaign_recipients').insert(chunk)
        if (e2) throw e2
      }

      await callN8n('campaigns.start', { campaign_id: camp.id })
      toast.success(`Campanha com ${recipients.length} destinatários na fila. O envio começa em até 1 minuto.`)
      setRows([])
      setColumns([])
      setFileName('')
      setName('')
      setMapping({})
      setOpenId(camp.id)
      qc.invalidateQueries({ queryKey: ['campaigns', active.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  if (profile?.is_demo) {
    return (
      <div>
        <PageHeader title="Envio em lote" />
        <Alert tone="info">O envio em lote não está disponível na conta de demonstração.</Alert>
      </div>
    )
  }

  if (!active) {
    return (
      <div>
        <PageHeader title="Envio em lote" />
        <Card>
          <EmptyState
            icon={<Layers className="size-6" />}
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
        title="Envio em lote"
        description="Envie um template para uma lista de contatos (CSV). Os envios são feitos pelo n8n respeitando o limite de taxa da Meta."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card className="min-w-0">
          <CardHeader title="Nova campanha" />
          <div className="space-y-5 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome da campanha">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Lembrete de novembro" />
              </Field>
              <Field label="Template aprovado">
                <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">Selecione…</option>
                  {approved.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.language}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:border-brand-500 hover:bg-brand-50/40">
              <Upload className="size-6 text-slate-400" />
              <span className="text-sm font-medium text-slate-700">{fileName || 'Selecionar arquivo CSV'}</span>
              <span className="text-xs text-slate-500">Primeira linha com cabeçalhos. Até {MAX_ROWS} linhas.</span>
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>

            {columns.length > 0 && (
              <div className="space-y-4 rounded-lg bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Mapeamento de colunas</p>
                <Field label="Coluna do telefone" hint={phoneCol ? `${stats.valid} válidos · ${stats.invalid} inválidos (serão ignorados)` : undefined}>
                  <Select value={phoneCol} onChange={(e) => setPhoneCol(e.target.value)}>
                    <option value="">Selecione…</option>
                    {columns.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
                {template &&
                  needed.map((k) => (
                    <Field key={k} label={fieldLabel(template, k)}>
                      <Select value={mapping[k] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [k]: e.target.value }))}>
                        <option value="">Selecione…</option>
                        {columns.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </Select>
                    </Field>
                  ))}

                <div className="overflow-x-auto rounded-md bg-white ring-1 ring-slate-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-slate-500">
                        {columns.map((c) => (
                          <th key={c} className="px-3 py-2 font-medium">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 5).map((r, i) => (
                        <tr key={i} className="border-b border-slate-50 last:border-0">
                          {columns.map((c) => (
                            <td key={c} className="whitespace-nowrap px-3 py-1.5 text-slate-700">
                              {r[c]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <Button onClick={create} disabled={!canCreate} loading={creating}>
              {!creating && <Play className="size-4" />} Criar e iniciar envio ({stats.valid})
            </Button>
          </div>
        </Card>

        <Card className="min-w-0 self-start">
          <CardHeader title="Campanhas" />
          {(campaignsQ.data ?? []).length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">Nenhuma campanha ainda.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {campaignsQ.data!.map((c) => (
                <CampaignRow key={c.id} c={c} open={openId === c.id} onOpen={() => setOpenId(openId === c.id ? null : c.id)} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

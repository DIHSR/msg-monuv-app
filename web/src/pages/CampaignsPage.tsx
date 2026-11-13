import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardPaste, Layers, Play, ShieldAlert, Upload } from 'lucide-react'
import Papa from 'papaparse'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthProvider'
import { ConnectionBar, NoConnection } from '../components/ConnectionSelect'
import { StatusBadge } from '../components/StatusBadge'
import { TemplatePreview } from '../components/TemplatePreview'
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Select, Textarea } from '../components/ui'
import { useAccounts } from '../hooks/useAccounts'
import { useRealtimeInvalidate } from '../hooks/useRealtime'
import { useTemplates } from '../hooks/useTemplates'
import { callN8n, errorMessage } from '../lib/api'
import { normalizeListPhone } from '../lib/phone'
import { supabase } from '../lib/supabase'
import { buildSendParams, fieldKey, getSlots, requiredFieldKeys } from '../lib/templates'
import type { Campaign, CampaignRecipient, Template } from '../lib/types'
import { cn, formatDateTime, formatPhone } from '../lib/utils'

const MAX_ROWS = 5000
const CHUNK = 500
const PASTE_EXAMPLE = 'telefone,nome,pedido\n(86) 99521-1166,Maria,12345\n11988887777,João,12346'

type Row = Record<string, string>
type Source = 'file' | 'paste'

function fieldLabel(template: Template, key: string) {
  const s = getSlots(template.components)
  if (key === fieldKey.media) return 'Mídia do cabeçalho (URL)'
  const [section, k] = key.split('.')
  if (section === 'header') return `Cabeçalho {{${k}}}`
  if (section === 'body') return `Corpo {{${k}}}`
  const btn = s.urlButtonVars.find((b) => String(b.index) === k)
  return `Botão “${btn?.text ?? k}” (complemento da URL)`
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="min-w-0">
      <p className={cn('text-lg font-semibold tabular-nums text-slate-900', className)}>{value.toLocaleString('pt-BR')}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  )
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
        <div className="mt-3 grid grid-cols-4 gap-2">
          <Stat label="Total" value={c.total} />
          <Stat label="Enviados" value={c.sent_count} />
          <Stat label="Entregues" value={c.delivered_count ?? 0} className="text-emerald-700" />
          <Stat label="Falhas" value={c.failed_count} className={c.failed_count ? 'text-red-700' : undefined} />
        </div>
        {c.list_source && <p className="mt-2 truncate text-xs text-slate-500">Origem da lista: {c.list_source}</p>}
      </button>
      {open && <CampaignFailures campaignId={c.id} />}
    </div>
  )
}

function CampaignFailures({ campaignId }: { campaignId: string }) {
  const q = useQuery({
    queryKey: ['campaign_failures', campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.from('campaign_recipients').select('*').eq('campaign_id', campaignId).eq('status', 'failed').limit(100)
      if (error) throw error
      return data as CampaignRecipient[]
    },
  })
  const rows = q.data ?? []
  return (
    <div className="border-t border-slate-100 bg-slate-50 px-5 py-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Falhas (mensagem original da Meta)</p>
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

export function CampaignsPage() {
  const { profile } = useAuth()
  const { accounts, active } = useAccounts()
  const qc = useQueryClient()
  const { data: templates = [] } = useTemplates(active?.id)
  const approved = useMemo(() => templates.filter((t) => t.status === 'APPROVED'), [templates])

  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [source, setSource] = useState<Source>('paste')
  const [pasted, setPasted] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [phoneCol, setPhoneCol] = useState('')
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [listSource, setListSource] = useState('')
  const [consent, setConsent] = useState(false)
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

  const valid = useMemo(
    () => (phoneCol ? rows.map((r) => ({ row: r, to: normalizeListPhone(r[phoneCol] ?? '') })).filter((x): x is { row: Row; to: string } => !!x.to) : []),
    [rows, phoneCol],
  )
  const invalidCount = rows.length - valid.length

  /** Prévia: primeira linha válida com as variáveis já mapeadas. */
  const preview = (() => {
    if (!template || !valid.length) return null
    const r = valid[0].row
    const slots = getSlots(template.components)
    const header: Record<string, string> = {}
    const body: Record<string, string> = {}
    for (const k of slots.headerVars) header[k] = mapping[fieldKey.header(k)] ? (r[mapping[fieldKey.header(k)]] ?? '') : ''
    for (const k of slots.bodyVars) body[k] = mapping[fieldKey.body(k)] ? (r[mapping[fieldKey.body(k)]] ?? '') : ''
    return { to: valid[0].to, values: { header, body, mediaLink: mapping[fieldKey.media] ? r[mapping[fieldKey.media]] : undefined } }
  })()

  const loadParsed = (data: Row[], cols: string[], total: number) => {
    setRows(data.slice(0, MAX_ROWS))
    setColumns(cols)
    setPhoneCol(cols.find((c) => /telefone|phone|celular|whats|numero|número/i.test(c)) ?? cols[0] ?? '')
    setMapping({})
    if (total > MAX_ROWS) toast.warning(`Apenas as primeiras ${MAX_ROWS} linhas foram carregadas.`)
  }

  const onFile = (file: File) => {
    setFileName(file.name)
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => loadParsed(res.data, res.meta.fields ?? [], res.data.length),
      error: (err) => toast.error(`Erro ao ler o CSV: ${err.message}`),
    })
  }

  const onPaste = (text: string) => {
    setPasted(text)
    if (!text.trim()) {
      loadParsed([], [], 0)
      return
    }
    const res = Papa.parse<Row>(text.trim(), { header: true, skipEmptyLines: true })
    loadParsed(res.data, res.meta.fields ?? [], res.data.length)
  }

  const listSourceOk = listSource.trim().length >= 3
  const canCreate =
    !!active && !!template && !!name.trim() && valid.length > 0 && needed.every((k) => mapping[k]) && listSourceOk && consent

  const reset = () => {
    setRows([])
    setColumns([])
    setFileName('')
    setPasted('')
    setName('')
    setMapping({})
    setListSource('')
    setConsent(false)
  }

  const create = async () => {
    if (!canCreate || !template || !active) return
    setCreating(true)
    try {
      const recipients = valid.map(({ row, to }) => {
        const values: Record<string, string> = {}
        for (const k of needed) values[k] = row[mapping[k]] ?? ''
        return { to_number: to, params: buildSendParams(template, values) }
      })

      const { data: camp, error } = await supabase
        .from('campaigns')
        .insert({
          wa_account_id: active.id,
          name: name.trim(),
          template_name: template.name,
          template_language: template.language,
          list_source: listSource.trim(),
          consent_confirmed: consent,
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
      toast.success(`Campanha com ${recipients.length} destinatários na fila. Os envios começam em até 1 minuto, em lotes.`)
      reset()
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
        <PageHeader title="Campanhas" />
        <Alert tone="info">Campanhas não estão disponíveis na conta de demonstração.</Alert>
      </div>
    )
  }

  if (!accounts.length) {
    return (
      <div>
        <PageHeader title="Campanhas" />
        <NoConnection />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Campanhas"
        description="Envio em lote de um template aprovado para uma lista de contatos. Os envios entram numa fila e saem aos poucos, respeitando o limite da Meta."
      />
      <ConnectionBar label="Conexão de origem" />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Nova campanha" />
            <div className="space-y-5 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nome da campanha" htmlFor="c-name">
                  <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Aviso de entrega — novembro" />
                </Field>
                <Field label="Template aprovado" htmlFor="c-tpl">
                  <Select
                    id="c-tpl"
                    value={templateId}
                    onChange={(e) => {
                      setTemplateId(e.target.value)
                      setMapping({})
                    }}
                  >
                    <option value="">Selecione…</option>
                    {approved.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.language}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {approved.length === 0 && (
                <Alert tone="warning">
                  Esta conexão não tem template aprovado.{' '}
                  <Link to="/templates" className="underline">
                    Ver templates
                  </Link>
                </Alert>
              )}

              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-700">Destinatários</p>
                <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-1 text-sm">
                  {(
                    [
                      ['paste', 'Colar lista', ClipboardPaste],
                      ['file', 'Arquivo CSV', Upload],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSource(key)
                        loadParsed([], [], 0)
                        setPasted('')
                        setFileName('')
                      }}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium',
                        source === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600',
                      )}
                    >
                      <Icon className="size-4" /> {label}
                    </button>
                  ))}
                </div>

                {source === 'paste' ? (
                  <Field label="" hint="Primeira linha com os nomes das colunas, separadas por vírgula. Números sem +55 são tratados como brasileiros.">
                    <Textarea rows={6} value={pasted} onChange={(e) => onPaste(e.target.value)} placeholder={PASTE_EXAMPLE} className="font-mono text-[13px]" />
                  </Field>
                ) : (
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-center hover:border-brand-500 hover:bg-brand-50/40">
                    <Upload className="size-6 text-slate-400" />
                    <span className="text-sm font-medium text-slate-700">{fileName || 'Selecionar arquivo CSV'}</span>
                    <span className="text-xs text-slate-500">Primeira linha com cabeçalhos. Até {MAX_ROWS} linhas.</span>
                    <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
                  </label>
                )}
              </div>

              {columns.length > 0 && (
                <div className="space-y-4 rounded-lg bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Colunas da lista</p>
                  <Field
                    label="Coluna do telefone"
                    hint={phoneCol ? `${valid.length} válidos · ${invalidCount} inválidos (serão ignorados)` : undefined}
                  >
                    <Select value={phoneCol} onChange={(e) => setPhoneCol(e.target.value)}>
                      {columns.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>
                  {template &&
                    needed.map((k) => (
                      <Field key={k} label={fieldLabel(template, k)}>
                        <Select value={mapping[k] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [k]: e.target.value }))}>
                          <option value="">Selecione a coluna…</option>
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

              <Field
                label="Origem da lista (obrigatório)"
                htmlFor="c-source"
                hint="Como esses contatos autorizaram receber mensagens. Ex.: clientes que pediram aviso de entrega no checkout do site."
                error={listSource && !listSourceOk ? 'Descreva a origem da lista.' : undefined}
              >
                <Input id="c-source" value={listSource} onChange={(e) => setListSource(e.target.value)} />
              </Field>

              <label className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-brand-700" />
                <span>
                  <ShieldAlert className="mr-1 inline size-4 text-amber-600" />
                  Confirmo que <strong>todos os contatos desta lista autorizaram</strong> receber mensagens da empresa pelo WhatsApp, e que quem
                  pedir para sair será removido imediatamente.
                </span>
              </label>

              <Button onClick={create} disabled={!canCreate} loading={creating}>
                {!creating && <Play className="size-4" />} Criar e iniciar campanha ({valid.length})
              </Button>
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Pré-visualização" description={preview ? `Primeiro destinatário: ${formatPhone(preview.to)}` : undefined} />
            <div className="p-4">
              {template ? (
                <TemplatePreview components={template.components} values={preview?.values} />
              ) : (
                <p className="text-sm text-slate-500">Escolha um template e carregue a lista.</p>
              )}
            </div>
          </Card>

          <Card className="self-start">
            <CardHeader title="Acompanhamento" description="Atualiza em tempo real." />
            {(campaignsQ.data ?? []).length === 0 ? (
              <div className="flex flex-col items-center px-5 py-8 text-center text-sm text-slate-500">
                <Layers className="mb-2 size-6 text-slate-400" />
                Nenhuma campanha nesta conexão ainda.
              </div>
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
    </div>
  )
}

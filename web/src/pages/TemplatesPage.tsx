import { FileText, Plus, RefreshCw, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { JsonPanel } from '../components/JsonPanel'
import { StatusBadge } from '../components/StatusBadge'
import { TemplatePreview } from '../components/TemplatePreview'
import { Alert, Button, Card, CardHeader, EmptyState, Input, PageHeader, Spinner } from '../components/ui'
import { useAccounts } from '../hooks/useAccounts'
import { useTemplates } from '../hooks/useTemplates'
import { ApiError, callN8n, errorMessage } from '../lib/api'
import type { MetaCallResult, Template } from '../lib/types'
import { cn, formatDateTime } from '../lib/utils'

const FILTERS = [
  { key: 'ALL', label: 'Todos' },
  { key: 'APPROVED', label: 'Aprovados' },
  { key: 'PENDING', label: 'Em análise' },
  { key: 'REJECTED', label: 'Rejeitados' },
  { key: 'OTHER', label: 'Outros' },
] as const

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidade',
  AUTHENTICATION: 'Autenticação',
}

export function TemplatesPage() {
  const { active } = useAccounts()
  const { data: templates = [], isLoading } = useTemplates(active?.id)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('ALL')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Template | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<MetaCallResult | null>(null)

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return templates.filter((t) => {
      if (s && !t.name.toLowerCase().includes(s)) return false
      if (filter === 'ALL') return true
      if (filter === 'OTHER') return !['APPROVED', 'PENDING', 'REJECTED'].includes(t.status ?? '')
      return t.status === filter
    })
  }, [templates, filter, search])

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: templates.length, APPROVED: 0, PENDING: 0, REJECTED: 0, OTHER: 0 }
    for (const t of templates) {
      if (t.status && t.status in c) c[t.status]++
      else c.OTHER++
    }
    return c
  }, [templates])

  const sync = async () => {
    if (!active) return
    setSyncing(true)
    try {
      const r = await callN8n<MetaCallResult<{ count: number }>>('templates-sync', { wa_account_id: active.id })
      setLastSync(r)
      toast.success(`${r.data?.count ?? 0} templates sincronizados com a Meta.`)
    } catch (err) {
      if (err instanceof ApiError) setLastSync(err.body as MetaCallResult)
      toast.error(errorMessage(err))
    } finally {
      setSyncing(false)
    }
  }

  // mantém o detalhe atualizado quando o realtime muda o template selecionado
  const selectedLive = selected ? templates.find((t) => t.id === selected.id) ?? selected : null

  if (!active) {
    return (
      <div>
        <PageHeader title="Templates" />
        <Card>
          <EmptyState
            icon={<FileText className="size-6" />}
            title="Conecte um número primeiro"
            description="Os templates pertencem à sua conta do WhatsApp Business (WABA)."
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
        title="Templates de mensagem"
        description="Modelos aprovados pela Meta para iniciar conversas. O status é atualizado automaticamente quando a Meta conclui a análise."
        actions={
          <>
            <Button variant="secondary" onClick={sync} loading={syncing}>
              {!syncing && <RefreshCw className="size-4" />} Sincronizar com a Meta
            </Button>
            <Link to="/templates/novo">
              <Button>
                <Plus className="size-4" /> Novo template
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card className="min-w-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome" className="pl-9" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    filter === f.key ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                  )}
                >
                  {f.label} <span className="opacity-70">{counts[f.key] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="p-6">
              <Spinner />
            </div>
          ) : templates.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-6" />}
              title="Nenhum template ainda"
              description="Sincronize para trazer os templates existentes na sua WABA ou crie um novo."
              action={
                <Button variant="secondary" onClick={sync} loading={syncing}>
                  Sincronizar agora
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Nome</th>
                    <th className="px-4 py-3">Categoria</th>
                    <th className="px-4 py-3">Idioma</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="hidden px-4 py-3 md:table-cell">Atualizado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => setSelected(t)}
                      className={cn('cursor-pointer hover:bg-slate-50', selectedLive?.id === t.id && 'bg-brand-50/60')}
                    >
                      <td className="px-4 py-3 font-mono text-[13px] text-slate-900">{t.name}</td>
                      <td className="px-4 py-3 text-slate-600">{CATEGORY_LABEL[t.category ?? ''] ?? t.category ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{t.language}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="hidden px-4 py-3 text-slate-500 md:table-cell">{formatDateTime(t.updated_at)}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                        Nenhum template neste filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="min-w-0">
          {selectedLive ? (
            <Card className="xl:sticky xl:top-8">
              <CardHeader
                title={<span className="font-mono text-[15px]">{selectedLive.name}</span>}
                description={`${CATEGORY_LABEL[selectedLive.category ?? ''] ?? selectedLive.category} · ${selectedLive.language}`}
                actions={
                  <button onClick={() => setSelected(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Fechar">
                    <X className="size-4" />
                  </button>
                }
              />
              <div className="space-y-4 p-5">
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedLive.status} />
                  {selectedLive.quality_score && <span className="text-xs text-slate-500">Qualidade: {selectedLive.quality_score}</span>}
                </div>
                {selectedLive.status === 'REJECTED' && (
                  <Alert tone="error" title="Motivo da rejeição">
                    {selectedLive.rejected_reason || 'Não informado pela Meta.'}
                  </Alert>
                )}
                <TemplatePreview components={selectedLive.components} />
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-slate-500">ID na Meta</dt>
                    <dd className="font-mono text-slate-800">{selectedLive.meta_template_id ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Sincronizado</dt>
                    <dd className="text-slate-800">{formatDateTime(selectedLive.synced_at)}</dd>
                  </div>
                </dl>
                {selectedLive.status === 'APPROVED' && (
                  <Link to={`/enviar?template=${encodeURIComponent(selectedLive.id)}`}>
                    <Button className="w-full">Usar no envio</Button>
                  </Link>
                )}
              </div>
            </Card>
          ) : (
            <Card className="hidden xl:block">
              <EmptyState title="Selecione um template" description="Clique em uma linha para ver a prévia e os detalhes." />
            </Card>
          )}
        </div>
      </div>

      {lastSync && (
        <Card className="mt-6">
          <CardHeader title="Última sincronização" description="Chamada GET /{waba_id}/message_templates feita pelo n8n." />
          <div className="p-5">
            <JsonPanel request={lastSync.request} response={lastSync.response} httpStatus={lastSync.http_status} requestLabel="Requisição" />
          </div>
        </Card>
      )}
    </div>
  )
}

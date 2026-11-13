import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Send, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ConnectionSelect, NoConnection } from '../components/ConnectionSelect'
import { JsonPanel } from '../components/JsonPanel'
import { StatusBadge } from '../components/StatusBadge'
import { TemplatePreview } from '../components/TemplatePreview'
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Select, Textarea } from '../components/ui'
import { useAccounts } from '../hooks/useAccounts'
import { useTemplates } from '../hooks/useTemplates'
import { ApiError, callN8n, errorMessage, type ApiResult } from '../lib/api'
import {
  buildCreatePayload,
  CATEGORIES,
  draftToComponents,
  emptyDraft,
  extractVars,
  LANGUAGES,
  validateDraft,
  type ButtonDraft,
  type TemplateDraft,
} from '../lib/templates'
import { cn, formatDateTime } from '../lib/utils'

type CreateResult = ApiResult<{ id?: string; status?: string; category?: string }>

/** Lista da conexão depois de criar: o novo template aparece como PENDING (fim do vídeo 2). */
function ConnectionTemplates({ accountId, highlight }: { accountId: string; highlight: string | null }) {
  const { data: templates = [], isLoading } = useTemplates(accountId)
  return (
    <Card className="mt-6">
      <CardHeader
        title="Templates desta conexão"
        description="Atualiza sozinho quando a Meta conclui a análise."
        actions={
          <Link to="/templates">
            <Button variant="secondary" size="sm">
              Abrir lista completa
            </Button>
          </Link>
        }
      />
      {isLoading ? (
        <p className="px-5 py-6 text-sm text-slate-500">Carregando…</p>
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
              {templates.slice(0, 8).map((t) => (
                <tr key={t.id} className={cn(t.name === highlight && 'bg-amber-50')}>
                  <td className="px-4 py-3 font-mono text-[13px] text-slate-900">{t.name}</td>
                  <td className="px-4 py-3 text-slate-600">{t.category}</td>
                  <td className="px-4 py-3 text-slate-600">{t.language}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="hidden px-4 py-3 text-slate-500 md:table-cell">{formatDateTime(t.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export function TemplateCreatePage() {
  const { accounts, active } = useAccounts()
  const qc = useQueryClient()
  const [d, setD] = useState<TemplateDraft>(emptyDraft)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<CreateResult | null>(null)
  const [createdName, setCreatedName] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const isAuth = d.category === 'AUTHENTICATION'

  const set = <K extends keyof TemplateDraft>(k: K, v: TemplateDraft[K]) => setD((p) => ({ ...p, [k]: v }))

  const payload = useMemo(() => buildCreatePayload(d), [d])
  const components = useMemo(() => draftToComponents(d), [d])
  const errors = useMemo(() => validateDraft(d), [d])
  const bodyVars = extractVars(d.body)
  const headerVars = d.headerType === 'TEXT' ? extractVars(d.headerText) : []

  const addVar = () => {
    const nums = bodyVars.filter((v) => /^\d+$/.test(v)).map(Number)
    const next = (nums.length ? Math.max(...nums) : 0) + 1
    set('body', `${d.body}{{${next}}}`)
  }

  const updateButton = (i: number, b: ButtonDraft) => set('buttons', d.buttons.map((x, j) => (j === i ? b : x)))

  const addButton = (type: ButtonDraft['type']) => {
    const b: ButtonDraft =
      type === 'URL'
        ? { type, text: '', url: 'https://', example: '' }
        : type === 'PHONE_NUMBER'
          ? { type, text: '', phone_number: '' }
          : { type, text: '' }
    set('buttons', [...d.buttons, b])
  }

  const submit = async () => {
    setShowErrors(true)
    if (!active || errors.length) return
    setSubmitting(true)
    setResult(null)
    try {
      const r = await callN8n<CreateResult>('templates.create', { wa_account_id: active.id, template: payload })
      setResult(r)
      setCreatedName(payload.name)
      toast.success('Template enviado para análise da Meta.')
      qc.invalidateQueries({ queryKey: ['templates', active.id] })
    } catch (err) {
      setResult(err instanceof ApiError && err.body ? (err.body as CreateResult) : { ok: false, error: { code: 'network', message: errorMessage(err) } })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <Link to="/templates" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Templates
      </Link>
      <PageHeader
        title="Novo template"
        description="O template é enviado para análise da Meta. A aprovação costuma levar de alguns minutos a 24 horas."
      />

      {!accounts.length && <NoConnection description="O template é criado na WABA de uma conexão. Conecte um número primeiro." />}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Informações básicas" />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <ConnectionSelect label="Conexão (WABA onde o template será criado)" id="tpl-conn" className="sm:col-span-3" />
              <Field label="Nome" hint="minúsculas, números e _" className="sm:col-span-3" htmlFor="tpl-name">
                <Input
                  id="tpl-name"
                  value={d.name}
                  onChange={(e) => set('name', e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''))}
                  placeholder="confirmacao_pedido"
                  className="font-mono"
                />
              </Field>
              <Field label="Categoria" htmlFor="tpl-cat">
                <Select id="tpl-cat" value={d.category} onChange={(e) => set('category', e.target.value as TemplateDraft['category'])}>
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value} title={c.hint}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Idioma" htmlFor="tpl-lang" className="sm:col-span-2">
                <Select id="tpl-lang" value={d.language} onChange={(e) => set('language', e.target.value)}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label} ({l.code})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          {isAuth && (
            <Card>
              <CardHeader
                title="Código de verificação"
                description="Em templates de autenticação o texto é padrão da Meta: “{{1}} é seu código de verificação.”"
              />
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={d.authSecurity}
                    onChange={(e) => set('authSecurity', e.target.checked)}
                    className="mt-0.5 size-4 accent-brand-700"
                  />
                  Adicionar a recomendação de segurança (“Para sua segurança, não o compartilhe.”)
                </label>
                <Field label="Validade do código (minutos)" hint="Opcional, de 1 a 90. Aparece no rodapé." htmlFor="tpl-exp">
                  <Input id="tpl-exp" inputMode="numeric" value={d.authExpiryMinutes} onChange={(e) => set('authExpiryMinutes', e.target.value.replace(/\D/g, ''))} />
                </Field>
                <Field label="Texto do botão de copiar" hint={`${d.authButtonText.length}/25`} htmlFor="tpl-btn">
                  <Input id="tpl-btn" value={d.authButtonText} maxLength={25} onChange={(e) => set('authButtonText', e.target.value)} />
                </Field>
              </div>
            </Card>
          )}

          {!isAuth && (<>
          <Card>
            <CardHeader title="Conteúdo" description="Use {{1}}, {{2}}… para variáveis. *negrito* e _itálico_ são suportados." />
            <div className="space-y-5 p-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Cabeçalho" htmlFor="tpl-htype">
                  <Select id="tpl-htype" value={d.headerType} onChange={(e) => set('headerType', e.target.value as TemplateDraft['headerType'])}>
                    <option value="NONE">Nenhum</option>
                    <option value="TEXT">Texto</option>
                    <option value="IMAGE">Imagem</option>
                    <option value="DOCUMENT">Documento</option>
                    <option value="VIDEO">Vídeo</option>
                  </Select>
                </Field>
                {d.headerType === 'TEXT' && (
                  <Field label="Texto do cabeçalho" hint={`${d.headerText.length}/60`} className="sm:col-span-2" htmlFor="tpl-htext">
                    <Input id="tpl-htext" value={d.headerText} onChange={(e) => set('headerText', e.target.value)} maxLength={60} />
                  </Field>
                )}
                {['IMAGE', 'DOCUMENT', 'VIDEO'].includes(d.headerType) && (
                  <Field
                    label="header_handle de exemplo"
                    hint="Handle obtido via Resumable Upload API da Meta."
                    className="sm:col-span-2"
                    htmlFor="tpl-hhandle"
                  >
                    <Input id="tpl-hhandle" value={d.headerMediaHandle} onChange={(e) => set('headerMediaHandle', e.target.value)} className="font-mono" />
                  </Field>
                )}
              </div>
              {headerVars.map((v) => (
                <Field key={v} label={<>Exemplo para <code>{`{{${v}}}`}</code> (cabeçalho)</>}>
                  <Input value={d.headerExample[v] ?? ''} onChange={(e) => set('headerExample', { ...d.headerExample, [v]: e.target.value })} />
                </Field>
              ))}

              <Field label="Corpo" hint={`${d.body.length}/1024`} htmlFor="tpl-body">
                <Textarea
                  id="tpl-body"
                  rows={6}
                  value={d.body}
                  onChange={(e) => set('body', e.target.value)}
                  placeholder="Olá {{1}}, seu pedido {{2}} foi confirmado e será entregue em breve."
                />
              </Field>
              <Button variant="secondary" size="sm" onClick={addVar} type="button">
                <Plus className="size-4" /> Adicionar variável
              </Button>

              {bodyVars.length > 0 && (
                <div className="grid gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
                  <p className="text-xs font-medium text-slate-600 sm:col-span-2">Exemplos das variáveis (exigidos pela Meta)</p>
                  {bodyVars.map((v) => (
                    <Field key={v} label={<code className="text-xs">{`{{${v}}}`}</code>}>
                      <Input value={d.bodyExamples[v] ?? ''} onChange={(e) => set('bodyExamples', { ...d.bodyExamples, [v]: e.target.value })} />
                    </Field>
                  ))}
                </div>
              )}

              <Field label="Rodapé (opcional)" hint={`${d.footer.length}/60`} htmlFor="tpl-footer">
                <Input id="tpl-footer" value={d.footer} onChange={(e) => set('footer', e.target.value)} maxLength={60} placeholder="Monuv · Não responda esta mensagem" />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Botões (opcional)"
              actions={
                <>
                  <Button variant="secondary" size="sm" onClick={() => addButton('QUICK_REPLY')} disabled={d.buttons.length >= 10}>
                    Resposta rápida
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => addButton('URL')} disabled={d.buttons.filter((b) => b.type === 'URL').length >= 2}>
                    Link
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => addButton('PHONE_NUMBER')} disabled={d.buttons.some((b) => b.type === 'PHONE_NUMBER')}>
                    Telefone
                  </Button>
                </>
              }
            />
            {d.buttons.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">Nenhum botão.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {d.buttons.map((b, i) => (
                  <div key={i} className="grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <Field label={b.type === 'URL' ? 'Texto do link' : b.type === 'PHONE_NUMBER' ? 'Texto do botão de ligação' : 'Resposta rápida'}>
                      <Input value={b.text} maxLength={25} onChange={(e) => updateButton(i, { ...b, text: e.target.value })} />
                    </Field>
                    {b.type === 'URL' ? (
                      <Field label="URL" hint="Pode terminar com {{1}}">
                        <Input value={b.url} onChange={(e) => updateButton(i, { ...b, url: e.target.value })} className="font-mono text-[13px]" />
                      </Field>
                    ) : b.type === 'PHONE_NUMBER' ? (
                      <Field label="Telefone">
                        <Input value={b.phone_number} onChange={(e) => updateButton(i, { ...b, phone_number: e.target.value })} placeholder="+5511999998888" />
                      </Field>
                    ) : (
                      <div className="hidden sm:block" />
                    )}
                    <Button variant="ghost" size="sm" onClick={() => set('buttons', d.buttons.filter((_, j) => j !== i))} aria-label="Remover botão">
                      <Trash2 className="size-4" />
                    </Button>
                    {b.type === 'URL' && extractVars(b.url).length > 0 && (
                      <Field label="URL de exemplo" className="sm:col-span-3">
                        <Input value={b.example} onChange={(e) => updateButton(i, { ...b, example: e.target.value })} placeholder="https://monuv.com.br/pedido/123" />
                      </Field>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
          </>)}
        </div>

        <div className="min-w-0">
          <div className="space-y-4 lg:sticky lg:top-8">
            <Card>
              <CardHeader title="Prévia" />
              <div className="p-4">
                <TemplatePreview components={components} />
              </div>
            </Card>
            {showErrors && errors.length > 0 && (
              <Alert tone="error" title="Corrija antes de enviar">
                <ul className="list-disc space-y-0.5 pl-4">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <Button className="w-full" onClick={submit} loading={submitting} disabled={!active}>
              {!submitting && <Send className="size-4" />} Enviar para aprovação
            </Button>
            {result?.ok && result.data && (
              <Alert tone="success" title="Template criado na Meta">
                <p>
                  ID: <code className="font-mono text-xs">{result.data.id}</code>
                </p>
                <div className="mt-1 flex items-center gap-2">
                  Status inicial: <StatusBadge status={result.data.status ?? 'PENDING'} />
                </div>
              </Alert>
            )}
            {result && !result.ok && (
              <Alert tone="error" title={result.error?.code === 'internal' ? 'Erro interno' : 'A criação falhou'}>
                <p className="break-words">{result.error?.message}</p>
                {result.error?.ref && (
                  <p className="mt-1 text-xs">
                    Referência para o suporte: <code className="font-mono">{result.error.ref}</code>
                  </p>
                )}
              </Alert>
            )}
          </div>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="JSON da criação"
          description={
            <>
              <code>POST /{'{waba_id}'}/message_templates</code> — à esquerda o payload, à direita a resposta da Meta.
            </>
          }
        />
        <div className="p-5">
          <JsonPanel
            request={result?.request}
            response={result?.response}
            httpStatus={result?.http_status}
            requestPlaceholder="// O payload enviado à Meta aparecerá aqui depois do envio"
            responsePlaceholder="// A resposta da Meta aparecerá aqui"
          />
        </div>
      </Card>

      {active && createdName && <ConnectionTemplates accountId={active.id} highlight={createdName} />}
    </div>
  )
}

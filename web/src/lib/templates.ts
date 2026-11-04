import type { HeaderFormat, SendParams, Template, TemplateComponent } from './types'

const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

/** Placeholders únicos, na ordem em que aparecem. */
export function extractVars(text: string | undefined | null): string[] {
  if (!text) return []
  const seen = new Set<string>()
  for (const m of text.matchAll(VAR_RE)) seen.add(m[1])
  return [...seen]
}

export function renderVars(text: string, values: Record<string, string>) {
  return text.replace(VAR_RE, (_, k: string) => (values[k] ? values[k] : `{{${k}}}`))
}

export interface TemplateSlots {
  header?: TemplateComponent
  body?: TemplateComponent
  footer?: TemplateComponent
  buttons?: TemplateComponent
  headerFormat?: HeaderFormat
  headerVars: string[]
  bodyVars: string[]
  /** Botões de URL dinâmica (com {{1}} na URL) — precisam de parâmetro no envio. */
  urlButtonVars: { index: number; text: string; url: string }[]
}

export function getSlots(components: TemplateComponent[]): TemplateSlots {
  const find = (t: TemplateComponent['type']) => components.find((c) => c.type === t)
  const header = find('HEADER')
  const body = find('BODY')
  const footer = find('FOOTER')
  const buttons = find('BUTTONS')
  return {
    header,
    body,
    footer,
    buttons,
    headerFormat: header?.format,
    headerVars: header?.format === 'TEXT' ? extractVars(header.text) : [],
    bodyVars: extractVars(body?.text),
    urlButtonVars: (buttons?.buttons ?? [])
      .map((b, index) => ({ index, text: b.text, url: b.url ?? '' }))
      .filter((b) => extractVars(b.url).length > 0),
  }
}

/** Chaves dos campos do formulário de envio (prefixadas por seção). */
export const fieldKey = {
  header: (k: string) => `header.${k}`,
  body: (k: string) => `body.${k}`,
  button: (i: number) => `button.${i}`,
  media: 'header.media',
}

export function buildSendParams(template: Template, values: Record<string, string>): SendParams {
  const slots = getSlots(template.components)
  const params: SendParams = { parameter_format: template.parameter_format ?? 'POSITIONAL' }
  if (slots.headerVars.length) {
    params.header = slots.headerVars.map((k) => ({ key: k, value: values[fieldKey.header(k)] ?? '' }))
  }
  if (slots.headerFormat && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(slots.headerFormat)) {
    params.header_media = {
      type: slots.headerFormat.toLowerCase() as 'image' | 'video' | 'document',
      link: values[fieldKey.media] ?? '',
    }
  }
  if (slots.bodyVars.length) {
    params.body = slots.bodyVars.map((k) => ({ key: k, value: values[fieldKey.body(k)] ?? '' }))
  }
  if (slots.urlButtonVars.length) {
    params.buttons = slots.urlButtonVars.map((b) => ({ index: b.index, value: values[fieldKey.button(b.index)] ?? '' }))
  }
  return params
}

export function requiredFieldKeys(template: Template): string[] {
  const s = getSlots(template.components)
  const keys = [
    ...s.headerVars.map(fieldKey.header),
    ...s.bodyVars.map(fieldKey.body),
    ...s.urlButtonVars.map((b) => fieldKey.button(b.index)),
  ]
  if (s.headerFormat && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(s.headerFormat)) keys.push(fieldKey.media)
  return keys
}

/** Texto final do corpo com variáveis preenchidas (gravado como prévia da mensagem). */
export function renderBodyPreview(template: Template, values: Record<string, string>) {
  const slots = getSlots(template.components)
  const bodyValues: Record<string, string> = {}
  for (const k of slots.bodyVars) bodyValues[k] = values[fieldKey.body(k)] ?? ''
  return renderVars(slots.body?.text ?? '', bodyValues)
}

// ---------------------------------------------------------------------------
// Criação de template
// ---------------------------------------------------------------------------

export type ButtonDraft =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string; example: string }
  | { type: 'PHONE_NUMBER'; text: string; phone_number: string }

export interface TemplateDraft {
  name: string
  category: 'UTILITY' | 'MARKETING'
  language: string
  headerType: 'NONE' | 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'VIDEO'
  headerText: string
  headerExample: Record<string, string>
  headerMediaHandle: string
  body: string
  bodyExamples: Record<string, string>
  footer: string
  buttons: ButtonDraft[]
}

export const emptyDraft: TemplateDraft = {
  name: '',
  category: 'UTILITY',
  language: 'pt_BR',
  headerType: 'NONE',
  headerText: '',
  headerExample: {},
  headerMediaHandle: '',
  body: '',
  bodyExamples: {},
  footer: '',
  buttons: [],
}

export const LANGUAGES = [
  { code: 'pt_BR', label: 'Português (BR)' },
  { code: 'en_US', label: 'Inglês (EUA)' },
  { code: 'es', label: 'Espanhol' },
  { code: 'es_MX', label: 'Espanhol (MX)' },
  { code: 'pt_PT', label: 'Português (PT)' },
]

export const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/

export function isNamedFormat(vars: string[]) {
  return vars.some((v) => !/^\d+$/.test(v))
}

/** Converte o rascunho do formulário no payload de POST /{waba_id}/message_templates. */
export function buildCreatePayload(d: TemplateDraft) {
  const components: Record<string, unknown>[] = []
  const bodyVars = extractVars(d.body)
  const headerVars = d.headerType === 'TEXT' ? extractVars(d.headerText) : []
  const named = isNamedFormat([...bodyVars, ...headerVars])

  if (d.headerType === 'TEXT' && d.headerText.trim()) {
    const header: Record<string, unknown> = { type: 'HEADER', format: 'TEXT', text: d.headerText }
    if (headerVars.length) {
      header.example = named
        ? { header_text_named_params: headerVars.map((k) => ({ param_name: k, example: d.headerExample[k] ?? '' })) }
        : { header_text: headerVars.map((k) => d.headerExample[k] ?? '') }
    }
    components.push(header)
  } else if (d.headerType !== 'NONE' && d.headerType !== 'TEXT') {
    components.push({
      type: 'HEADER',
      format: d.headerType,
      example: { header_handle: [d.headerMediaHandle] },
    })
  }

  const body: Record<string, unknown> = { type: 'BODY', text: d.body }
  if (bodyVars.length) {
    body.example = named
      ? { body_text_named_params: bodyVars.map((k) => ({ param_name: k, example: d.bodyExamples[k] ?? '' })) }
      : { body_text: [bodyVars.map((k) => d.bodyExamples[k] ?? '')] }
  }
  components.push(body)

  if (d.footer.trim()) components.push({ type: 'FOOTER', text: d.footer })

  if (d.buttons.length) {
    components.push({
      type: 'BUTTONS',
      buttons: d.buttons.map((b) => {
        if (b.type === 'URL') {
          const hasVar = extractVars(b.url).length > 0
          return { type: 'URL', text: b.text, url: b.url, ...(hasVar ? { example: [b.example] } : {}) }
        }
        if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number }
        return { type: 'QUICK_REPLY', text: b.text }
      }),
    })
  }

  return {
    name: d.name,
    language: d.language,
    category: d.category,
    ...(named ? { parameter_format: 'NAMED' } : {}),
    components,
  }
}

/** Converte o rascunho em componentes para a prévia visual. */
export function draftToComponents(d: TemplateDraft): TemplateComponent[] {
  return buildCreatePayload(d).components as unknown as TemplateComponent[]
}

export function validateDraft(d: TemplateDraft): string[] {
  const errs: string[] = []
  if (!TEMPLATE_NAME_RE.test(d.name)) errs.push('Nome: use apenas letras minúsculas, números e "_".')
  if (!d.body.trim()) errs.push('O corpo da mensagem é obrigatório.')
  if (d.body.length > 1024) errs.push('O corpo pode ter no máximo 1024 caracteres.')
  const bodyVars = extractVars(d.body)
  for (const v of bodyVars) if (!d.bodyExamples[v]?.trim()) errs.push(`Informe um exemplo para {{${v}}} no corpo.`)
  if (/^\s*\{\{|\}\}\s*$/.test(d.body.trim())) errs.push('O corpo não pode começar nem terminar com uma variável.')
  if (d.headerType === 'TEXT') {
    if (!d.headerText.trim()) errs.push('Informe o texto do cabeçalho.')
    if (d.headerText.length > 60) errs.push('Cabeçalho de texto: máximo 60 caracteres.')
    const hv = extractVars(d.headerText)
    if (hv.length > 1) errs.push('O cabeçalho aceita no máximo 1 variável.')
    for (const v of hv) if (!d.headerExample[v]?.trim()) errs.push(`Informe um exemplo para {{${v}}} no cabeçalho.`)
  }
  if (['IMAGE', 'DOCUMENT', 'VIDEO'].includes(d.headerType) && !d.headerMediaHandle.trim()) {
    errs.push('Cabeçalho de mídia exige um "header_handle" de exemplo (upload via Resumable Upload API).')
  }
  if (d.footer.length > 60) errs.push('Rodapé: máximo 60 caracteres.')
  for (const [i, b] of d.buttons.entries()) {
    if (!b.text.trim()) errs.push(`Botão ${i + 1}: texto obrigatório.`)
    if (b.type === 'URL') {
      if (!/^https:\/\//.test(b.url)) errs.push(`Botão ${i + 1}: a URL deve começar com https://`)
      if (extractVars(b.url).length && !b.example.trim()) errs.push(`Botão ${i + 1}: informe uma URL de exemplo.`)
    }
    if (b.type === 'PHONE_NUMBER' && !/^\+?\d{10,15}$/.test(b.phone_number.replace(/\s/g, ''))) {
      errs.push(`Botão ${i + 1}: telefone inválido (use +5511999998888).`)
    }
  }
  return errs
}

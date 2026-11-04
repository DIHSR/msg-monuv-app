export type Plan = 'trial' | 'active' | 'permanent' | 'suspended'

export interface Profile {
  id: string
  email: string | null
  full_name: string | null
  company_name: string | null
  is_demo: boolean
  plan: Plan
  trial_ends_at: string | null
  daily_send_limit: number | null
  can_use_app: boolean
}

export type AccountStatus = 'pending' | 'connected' | 'error' | 'disconnected'

export interface WaAccount {
  id: string
  user_id: string
  business_id: string | null
  waba_id: string
  waba_name: string | null
  phone_number_id: string
  display_phone_number: string | null
  verified_name: string | null
  quality_rating: string | null
  name_status: string | null
  code_verification_status: string | null
  phone_status: string | null
  status: AccountStatus
  webhook_subscribed: boolean
  last_error: unknown
  connected_at: string
  updated_at: string
}

export type TemplateStatus =
  | 'APPROVED'
  | 'PENDING'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'IN_APPEAL'
  | 'PENDING_DELETION'
  | 'DELETED'
  | 'LIMIT_EXCEEDED'

export type HeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION'

export interface TemplateButton {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE' | 'OTP' | string
  text: string
  url?: string
  phone_number?: string
  example?: string[]
}

export interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  format?: HeaderFormat
  text?: string
  buttons?: TemplateButton[]
  example?: Record<string, unknown>
}

export interface Template {
  id: string
  wa_account_id: string
  meta_template_id: string | null
  name: string
  language: string
  category: string | null
  status: TemplateStatus | string | null
  parameter_format: 'POSITIONAL' | 'NAMED' | null
  components: TemplateComponent[]
  rejected_reason: string | null
  quality_score: string | null
  last_request: unknown
  last_response: unknown
  synced_at: string | null
  updated_at: string
}

export type MessageStatus = 'pending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' | 'received'

export interface Message {
  id: string
  wa_account_id: string
  campaign_id: string | null
  direction: 'outbound' | 'inbound'
  to_number: string | null
  from_number: string | null
  type: string
  template_name: string | null
  template_language: string | null
  body_preview: string | null
  request_payload: unknown
  response_payload: unknown
  http_status: number | null
  wa_message_id: string | null
  status: MessageStatus
  error: unknown
  created_at: string
  updated_at: string
}

export interface MessageStatusEvent {
  id: number
  message_id: string | null
  wa_message_id: string
  status: string
  occurred_at: string | null
  payload: unknown
  created_at: string
}

export type CampaignStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface Campaign {
  id: string
  wa_account_id: string
  name: string
  template_name: string
  template_language: string
  status: CampaignStatus
  total: number
  sent_count: number
  failed_count: number
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface CampaignRecipient {
  id: string
  campaign_id: string
  to_number: string
  params: SendParams
  status: 'pending' | 'sending' | 'sent' | 'failed'
  wa_message_id: string | null
  error: unknown
  processed_at: string | null
}

/** Parâmetros de um template para envio — o n8n monta o payload final da Meta. */
export interface TemplateParam {
  key: string
  value: string
}

export interface SendParams {
  parameter_format?: 'POSITIONAL' | 'NAMED'
  header?: TemplateParam[]
  header_media?: { type: 'image' | 'video' | 'document'; link: string; filename?: string }
  body?: TemplateParam[]
  buttons?: { index: number; value: string }[]
}

/** Resposta padrão dos endpoints do n8n que conversam com a Meta. */
export interface MetaCallResult<T = unknown> {
  ok: boolean
  request?: unknown
  response?: unknown
  http_status?: number
  data?: T
  error?: { code: string; message: string; meta_error?: unknown }
}

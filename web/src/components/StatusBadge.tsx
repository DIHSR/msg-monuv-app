import { cn } from '../lib/utils'

const tone = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  slate: 'bg-slate-100 text-slate-700 ring-slate-500/20',
}

type Tone = keyof typeof tone

const MAP: Record<string, { label: string; tone: Tone }> = {
  // Templates
  APPROVED: { label: 'Aprovado', tone: 'green' },
  PENDING: { label: 'Em análise', tone: 'amber' },
  REJECTED: { label: 'Rejeitado', tone: 'red' },
  PAUSED: { label: 'Pausado', tone: 'amber' },
  DISABLED: { label: 'Desativado', tone: 'red' },
  IN_APPEAL: { label: 'Em recurso', tone: 'blue' },
  PENDING_DELETION: { label: 'Excluindo', tone: 'slate' },
  DELETED: { label: 'Excluído', tone: 'slate' },
  LIMIT_EXCEEDED: { label: 'Limite excedido', tone: 'red' },
  // Mensagens
  pending: { label: 'Pendente', tone: 'slate' },
  accepted: { label: 'Aceita', tone: 'blue' },
  sent: { label: 'Enviada', tone: 'blue' },
  delivered: { label: 'Entregue', tone: 'green' },
  read: { label: 'Lida', tone: 'green' },
  failed: { label: 'Falhou', tone: 'red' },
  received: { label: 'Recebida', tone: 'blue' },
  // Conta
  connected: { label: 'Conectado', tone: 'green' },
  error: { label: 'Erro', tone: 'red' },
  disconnected: { label: 'Desconectado', tone: 'slate' },
  // Campanhas
  draft: { label: 'Rascunho', tone: 'slate' },
  queued: { label: 'Na fila', tone: 'amber' },
  running: { label: 'Enviando', tone: 'blue' },
  completed: { label: 'Concluída', tone: 'green' },
  cancelled: { label: 'Cancelada', tone: 'slate' },
  // Qualidade
  GREEN: { label: 'Alta', tone: 'green' },
  YELLOW: { label: 'Média', tone: 'amber' },
  RED: { label: 'Baixa', tone: 'red' },
  UNKNOWN: { label: 'Desconhecida', tone: 'slate' },
}

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const s = status ?? 'UNKNOWN'
  const m = MAP[s] ?? { label: s, tone: 'slate' as Tone }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap',
        tone[m.tone],
        className,
      )}
      title={s}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {m.label}
    </span>
  )
}

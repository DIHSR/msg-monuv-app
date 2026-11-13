import { Smartphone } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAccounts } from '../hooks/useAccounts'
import { formatPhone } from '../lib/utils'
import { StatusBadge } from './StatusBadge'
import { Card, Field, Select } from './ui'

/**
 * Seletor da conexão (número) de origem. A escolha é compartilhada entre as telas:
 * templates pertencem à WABA da conexão, e todo envio sai pelo número escolhido.
 */
export function ConnectionSelect({
  label = 'Conexão',
  hint,
  id = 'connection',
  className,
}: {
  label?: string
  hint?: string
  id?: string
  className?: string
}) {
  const { accounts, active, setActiveId } = useAccounts()
  if (!accounts.length) return null
  return (
    <Field label={label} hint={hint} htmlFor={id} className={className}>
      <div className="flex items-center gap-2">
        <Select id={id} value={active?.id ?? ''} onChange={(e) => setActiveId(e.target.value)} required className="min-w-0 flex-1">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {formatPhone(a.display_phone_number)} · {a.verified_name ?? 'Sem nome'}
              {a.is_on_biz_app ? ' · Coexistência' : ''}
            </option>
          ))}
        </Select>
        {active && active.status !== 'connected' && <StatusBadge status={active.status} />}
      </div>
    </Field>
  )
}

/** Barra com o seletor no topo da tela (Templates, Conversas, Campanhas). */
export function ConnectionBar({ label = 'Conexão' }: { label?: string }) {
  return (
    <Card className="mb-6 p-4">
      <ConnectionSelect label={label} className="max-w-xl" />
    </Card>
  )
}

/** Estado vazio comum: nenhuma conexão utilizável. */
export function NoConnection({ description }: { description?: string }) {
  return (
    <Card>
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500">
          <Smartphone className="size-6" />
        </div>
        <p className="font-medium text-slate-800">Conecte um número primeiro</p>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          {description ?? 'Esta tela trabalha sobre uma conexão do WhatsApp. Conecte um número na tela de Conexões.'}
        </p>
        <Link
          to="/conexoes"
          className="mt-5 inline-flex h-10 items-center rounded-lg bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800"
        >
          Ir para Conexões
        </Link>
      </div>
    </Card>
  )
}

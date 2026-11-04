import { FileText, Layers, LogOut, Menu, Plug, Send, X } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useAccounts } from '../hooks/useAccounts'
import { cn, formatPhone } from '../lib/utils'
import { Select } from './ui'

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-700 text-white">
        <svg viewBox="0 0 32 32" className="size-5" aria-hidden>
          <path d="M9 22V10l7 7 7-7v12" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="font-semibold tracking-tight text-slate-900">
        Monuv <span className="font-normal text-slate-500">Mensagens</span>
      </span>
    </Link>
  )
}

export function AppShell() {
  const { session, profile, signOut } = useAuth()
  const { accounts, active, setActiveId } = useAccounts()
  const [open, setOpen] = useState(false)

  const nav = [
    { to: '/conexao', label: 'Conexão', icon: Plug },
    { to: '/templates', label: 'Templates', icon: FileText },
    { to: '/enviar', label: 'Enviar mensagem', icon: Send },
    ...(profile?.is_demo ? [] : [{ to: '/lote', label: 'Envio em lote', icon: Layers }]),
  ]

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo />
        <button className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
          <X className="size-5" />
        </button>
      </div>

      {accounts.length > 0 && (
        <div className="px-4 pb-4">
          <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Número ativo</p>
          {accounts.length > 1 ? (
            <Select value={active?.id ?? ''} onChange={(e) => setActiveId(e.target.value)} className="h-9 text-[13px]">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.verified_name ?? 'Sem nome'} · {formatPhone(a.display_phone_number)}
                </option>
              ))}
            </Select>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="truncate text-[13px] font-medium text-slate-800">{active?.verified_name ?? 'Sem nome'}</p>
              <p className="font-mono text-[12px] text-slate-500">{formatPhone(active?.display_phone_number)}</p>
            </div>
          )}
        </div>
      )}

      <nav className="flex-1 space-y-0.5 px-3">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )
            }
          >
            <n.icon className="size-4.5" />
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-4">
        {profile?.is_demo && (
          <span className="mb-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            Conta de demonstração
          </span>
        )}
        <p className="truncate text-sm font-medium text-slate-800">{profile?.full_name ?? '—'}</p>
        <p className="truncate text-xs text-slate-500">{session?.user.email}</p>
        <button
          onClick={() => void signOut()}
          className="mt-3 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
        >
          <LogOut className="size-4" /> Sair
        </button>
        <div className="mt-4 flex gap-3 text-[11px] text-slate-400">
          <Link to="/privacidade" className="hover:text-slate-600">Privacidade</Link>
          <Link to="/termos" className="hover:text-slate-600">Termos</Link>
          <Link to="/exclusao-de-dados" className="hover:text-slate-600">Exclusão de dados</Link>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-full">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden">
          <button className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu className="size-5" />
          </button>
          <Logo />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

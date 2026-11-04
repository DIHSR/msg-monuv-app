import { CheckCircle2, Lock } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Field, Input } from '../components/ui'
import { supabase } from '../lib/supabase'

const YEAR = new Date().getFullYear()

function translateAuthError(msg: string) {
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.'
  if (/email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.'
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos.'
  return msg
}

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)
    if (error) {
      setError(translateAuthError(error.message))
      return
    }
    navigate(from, { replace: true })
  }

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-brand-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-white/10">
            <svg viewBox="0 0 32 32" className="size-5" aria-hidden>
              <path d="M9 22V10l7 7 7-7v12" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-lg font-semibold">Monuv Mensagens</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            Mensagens oficiais pelo WhatsApp Business Platform.
          </h1>
          <ul className="mt-8 space-y-3 text-brand-100">
            {[
              'Conecte o número da sua empresa com o cadastro oficial da Meta',
              'Crie templates e acompanhe a aprovação em tempo real',
              'Envie mensagens e veja o status de entrega e leitura',
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand-200" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-brand-200/70">© {YEAR} Monuv</p>
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-brand-700/40 blur-3xl" />
      </section>

      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="text-lg font-semibold text-slate-900">Monuv Mensagens</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Entrar</h2>
          <p className="mt-1 text-sm text-slate-500">Acesse com o e-mail e a senha da sua conta.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="E-mail" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com.br"
              />
            </Field>
            <Field label="Senha" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button type="submit" className="w-full" loading={loading}>
              <Lock className="size-4" /> Entrar
            </Button>
          </form>

          <p className="mt-10 text-center text-xs text-slate-400">
            Ao entrar você concorda com os <Link to="/termos" className="underline hover:text-slate-600">Termos de Uso</Link> e a{' '}
            <Link to="/privacidade" className="underline hover:text-slate-600">Política de Privacidade</Link>.
          </p>
        </div>
      </section>
    </div>
  )
}

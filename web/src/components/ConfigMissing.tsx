import { Settings } from 'lucide-react'

/** Mostrada no lugar do app quando faltam variáveis obrigatórias do .env (ver web/.env.example). */
export function ConfigMissing({ missing }: { missing: string[] }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-amber-100 p-2 text-amber-700">
            <Settings className="size-5" />
          </span>
          <h1 className="text-lg font-semibold text-slate-900">Configuração incompleta</h1>
        </div>
        <p className="mt-3 text-sm text-slate-600">Faltam estas variáveis de ambiente do front:</p>
        <ul className="mt-2 space-y-1">
          {missing.map((m) => (
            <li key={m} className="rounded bg-slate-100 px-2 py-1 font-mono text-sm text-slate-800">
              {m}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-slate-600">
          Em desenvolvimento: copie <code className="font-mono">web/.env.example</code> para <code className="font-mono">web/.env.local</code>,
          preencha e reinicie o <code className="font-mono">npm run dev</code>. Em produção: cadastre as variáveis no AWS Amplify e faça um novo
          deploy.
        </p>
      </div>
    </div>
  )
}

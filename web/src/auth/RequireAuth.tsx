import { Lock } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Button, EmptyState, Spinner } from '../components/ui'
import { useAuth } from './AuthProvider'

function FullScreenSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="size-7" />
    </div>
  )
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, profile, profileLoading, signOut } = useAuth()
  const location = useLocation()

  if (loading) return <FullScreenSpinner />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (profileLoading) return <FullScreenSpinner />

  // Falha fechado: login válido sem perfil Monuv (ex.: usuário de outro sistema no mesmo Supabase) não entra.
  if (!profile || !profile.can_use_app) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <EmptyState
          icon={<Lock className="size-6" />}
          title="Acesso indisponível"
          description={
            profile
              ? 'Seu acesso ao Monuv Mensagens está suspenso. Fale com a equipe Monuv para reativar.'
              : 'Este login não tem acesso ao Monuv Mensagens. Fale com a equipe Monuv.'
          }
          action={
            <Button variant="secondary" onClick={() => void signOut()}>
              Sair
            </Button>
          }
        />
      </div>
    )
  }

  return <>{children}</>
}

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <FullScreenSpinner />
  if (session) return <Navigate to="/" replace />
  return <>{children}</>
}

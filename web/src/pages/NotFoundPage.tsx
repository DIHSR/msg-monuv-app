import { Link } from 'react-router-dom'
import { Button, EmptyState } from '../components/ui'

export function NotFoundPage() {
  return (
    <div className="flex h-full items-center justify-center p-4">
      <EmptyState
        title="Página não encontrada"
        description="O endereço acessado não existe."
        action={
          <Link to="/">
            <Button>Voltar ao início</Button>
          </Link>
        }
      />
    </div>
  )
}

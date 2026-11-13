import { Navigate, Route, Routes } from 'react-router-dom'
import { RedirectIfAuthed, RequireAuth } from './auth/RequireAuth'
import { AppShell } from './components/AppShell'
import { AccountsProvider, useAccounts } from './hooks/useAccounts'
import { CampaignsPage } from './pages/CampaignsPage'
import { ConnectionPage } from './pages/ConnectionPage'
import { ConversationsPage } from './pages/ConversationsPage'
import { DataDeletionPage } from './pages/legal/DataDeletionPage'
import { PrivacyPage } from './pages/legal/PrivacyPage'
import { TermsPage } from './pages/legal/TermsPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SendPage } from './pages/SendPage'
import { TemplateCreatePage } from './pages/TemplateCreatePage'
import { TemplatesPage } from './pages/TemplatesPage'
import { Spinner } from './components/ui'

function Home() {
  const { accounts, isLoading } = useAccounts()
  if (isLoading) return <Spinner />
  return <Navigate to={accounts.length ? '/enviar' : '/conexoes'} replace />
}

export default function App() {
  return (
    <Routes>
      {/* Públicas — exigidas pela Meta no App Review */}
      <Route path="/privacidade" element={<PrivacyPage />} />
      <Route path="/termos" element={<TermsPage />} />
      <Route path="/exclusao-de-dados" element={<DataDeletionPage />} />

      <Route
        path="/login"
        element={
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        }
      />

      <Route
        element={
          <RequireAuth>
            <AccountsProvider>
              <AppShell />
            </AccountsProvider>
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="conexoes" element={<ConnectionPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="templates/novo" element={<TemplateCreatePage />} />
        <Route path="enviar" element={<SendPage />} />
        <Route path="conversas" element={<ConversationsPage />} />
        <Route path="campanhas" element={<CampaignsPage />} />
        {/* endereços antigos */}
        <Route path="conexao" element={<Navigate to="/conexoes" replace />} />
        <Route path="lote" element={<Navigate to="/campanhas" replace />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

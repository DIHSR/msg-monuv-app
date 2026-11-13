import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { WaAccount } from '../lib/types'
import { storageGet, storageSet } from '../lib/utils'
import { useRealtimeInvalidate } from './useRealtime'

interface AccountsContextValue {
  /** Todas as conexões do usuário, inclusive desconectadas (tela de Conexões). */
  all: WaAccount[]
  /** Conexões utilizáveis (não desconectadas): seletores das telas de envio, templates etc. */
  accounts: WaAccount[]
  isLoading: boolean
  /** Conexão escolhida no seletor, compartilhada entre as telas. */
  active: WaAccount | null
  setActiveId: (id: string) => void
  refetch: () => void
}

const AccountsContext = createContext<AccountsContextValue | null>(null)
const STORAGE_KEY = 'monuv.activeAccount'

export function AccountsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id
  const [activeId, setActiveIdState] = useState<string | null>(() => storageGet(STORAGE_KEY))

  const q = useQuery({
    queryKey: ['wa_accounts', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from('wa_accounts').select('*').order('connected_at', { ascending: false })
      if (error) throw error
      return data as WaAccount[]
    },
  })

  useRealtimeInvalidate('wa_accounts', userId ? `user_id=eq.${userId}` : null, [['wa_accounts', userId]])

  const value = useMemo<AccountsContextValue>(() => {
    const all = q.data ?? []
    const accounts = all.filter((a) => a.status !== 'disconnected')
    const active = accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null
    return {
      all,
      accounts,
      isLoading: q.isLoading,
      active,
      setActiveId: (id) => {
        setActiveIdState(id)
        storageSet(STORAGE_KEY, id)
      },
      refetch: () => void q.refetch(),
    }
  }, [q, activeId])

  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>
}

export function useAccounts() {
  const ctx = useContext(AccountsContext)
  if (!ctx) throw new Error('useAccounts fora do AccountsProvider')
  return ctx
}

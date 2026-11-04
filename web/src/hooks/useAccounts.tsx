import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { WaAccount } from '../lib/types'
import { storageGet, storageSet } from '../lib/utils'
import { useRealtimeInvalidate } from './useRealtime'

interface AccountsContextValue {
  accounts: WaAccount[]
  isLoading: boolean
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
      const { data, error } = await supabase
        .from('wa_accounts')
        .select('*')
        .neq('status', 'disconnected')
        .order('connected_at', { ascending: false })
      if (error) throw error
      return data as WaAccount[]
    },
  })

  useRealtimeInvalidate('wa_accounts', userId ? `user_id=eq.${userId}` : null, [['wa_accounts', userId]])

  const value = useMemo<AccountsContextValue>(() => {
    const accounts = q.data ?? []
    const active = accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null
    return {
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

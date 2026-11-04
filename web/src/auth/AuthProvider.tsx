import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'

interface AuthContextValue {
  session: Session | null
  loading: boolean
  profile: Profile | null
  profileLoading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const qc = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) qc.clear()
    })
    return () => data.subscription.unsubscribe()
  }, [qc])

  const userId = session?.user.id
  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, company_name, is_demo, plan, trial_ends_at, daily_send_limit, can_use_app')
        .eq('id', userId!)
        .single()
      if (error) throw error
      return data as unknown as Profile
    },
  })

  const value: AuthContextValue = {
    session,
    loading,
    profile: profileQuery.data ?? null,
    profileLoading: profileQuery.isLoading,
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}

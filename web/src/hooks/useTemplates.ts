import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Template } from '../lib/types'
import { useRealtimeInvalidate } from './useRealtime'

export function useTemplates(accountId: string | undefined) {
  const q = useQuery({
    queryKey: ['templates', accountId],
    enabled: !!accountId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('templates')
        .select('*')
        .eq('wa_account_id', accountId!)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data as Template[]
    },
  })
  useRealtimeInvalidate('templates', accountId ? `wa_account_id=eq.${accountId}` : null, [['templates', accountId]])
  return q
}

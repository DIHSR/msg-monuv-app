import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Assina mudanças de uma tabela (Supabase Realtime) e invalida as queries informadas.
 * `filter` segue a sintaxe do Realtime, ex.: `wa_account_id=eq.<uuid>`.
 */
export function useRealtimeInvalidate(
  table: string,
  filter: string | null,
  queryKeys: QueryKey[],
  onChange?: (payload: { eventType: string; new: unknown; old: unknown }) => void,
) {
  const qc = useQueryClient()
  const keysRef = useRef(queryKeys)
  const cbRef = useRef(onChange)
  useEffect(() => {
    keysRef.current = queryKeys
    cbRef.current = onChange
  })

  useEffect(() => {
    if (filter === null) return
    const channel = supabase
      .channel(`rt:${table}:${filter || 'all'}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        (payload) => {
          for (const k of keysRef.current) qc.invalidateQueries({ queryKey: k })
          cbRef.current?.({ eventType: payload.eventType, new: payload.new, old: payload.old })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, filter, qc])
}

import { createClient } from '@supabase/supabase-js'
import { config } from '../config'

// Sem configuração o app mostra a tela de variáveis ausentes (main.tsx); o endereço reservado
// abaixo só evita que createClient quebre o carregamento antes disso.
export const supabase = createClient(config.supabaseUrl || 'https://config-ausente.invalid', config.supabaseAnonKey || 'ausente', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

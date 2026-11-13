import type { WaAccount } from './types'
import { daysSince } from './utils'

/** A Meta desconecta a coexistência com ~14 dias sem o app aberto no celular; avisamos a partir de 10. */
export const INACTIVITY_WARNING_DAYS = 10

/**
 * Dias sem atividade do celular quando a conexão em coexistência está perto de cair (lacuna 3),
 * ou null quando não há o que avisar. Vale o alerta do agendador OU a conta local (sem esperar o próximo minuto).
 */
export function inactivityDays(a: WaAccount): number | null {
  if (!a.is_on_biz_app || a.status !== 'connected') return null
  const days = daysSince(a.last_seen_at ?? a.connected_at)
  if (a.inactivity_alert_at || (days !== null && days >= INACTIVITY_WARNING_DAYS)) return days ?? INACTIVITY_WARNING_DAYS
  return null
}

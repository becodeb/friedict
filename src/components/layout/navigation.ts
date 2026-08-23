import { ClockCounterClockwise, House, Trophy } from '@phosphor-icons/react'

export interface NavDestination {
  to: string
  label: string
  icon: typeof House
  end?: boolean
}

/**
 * Los tres destinos del grupo. Viven en su propio archivo para que
 * `BottomNav.tsx` exporte sólo componentes y no se rompa el fast refresh.
 *
 * La misma lista alimenta la barra inferior en mobile y la navegación superior
 * en desktop: una sola fuente para las dos.
 */
export function navDestinations(groupId: string): NavDestination[] {
  return [
    { to: `/g/${groupId}`, label: 'Inicio', icon: House, end: true },
    { to: `/g/${groupId}/historial`, label: 'Historial', icon: ClockCounterClockwise },
    { to: `/g/${groupId}/ranking`, label: 'Ranking', icon: Trophy },
  ]
}

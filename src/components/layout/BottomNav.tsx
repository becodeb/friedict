import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { navDestinations } from './navigation'

/**
 * Navegación inferior en mobile.
 *
 * Barra blanca con línea de tinta arriba. El ícono de la sección activa va
 * dentro de una píldora de chicle con contorno, como un sticker pegado.
 *
 * El badge de novedad usa
 * transitions-dev-react-css/notification-badge/notification-badge.txt: el punto
 * entra deslizándose y escalando desde 0, en vez de aparecer de golpe.
 */
export function BottomNav({
  groupId,
  historyBadge,
}: {
  groupId: string
  historyBadge?: boolean
}) {
  const destinations = navDestinations(groupId)

  return (
    <nav
      aria-label="Secciones del grupo"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t-2 border-[var(--line-strong)]',
        'bg-[var(--surface)] pb-[var(--safe-b)] sm:hidden',
      )}
    >
      <ul className="mx-auto flex max-w-md">
        {destinations.map((destination) => {
          const Icon = destination.icon
          const showBadge = destination.label === 'Historial' && historyBadge

          return (
            <li key={destination.to} className="flex-1">
              <NavLink
                to={destination.to}
                end={destination.end}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-[var(--bottom-nav-h)] flex-col items-center justify-center gap-1',
                    'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
                    isActive ? 'text-[var(--ink)]' : 'text-[var(--ink-3)]',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cn(
                        'relative grid h-8 w-12 place-items-center rounded-[var(--r-pill)] border-2',
                        'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
                        isActive
                          ? 'border-[var(--line-strong)] bg-[var(--accent)] text-[var(--on-candy)]'
                          : 'border-transparent',
                      )}
                    >
                      <Icon
                        size={20}
                        weight={isActive ? 'fill' : 'regular'}
                        aria-hidden="true"
                      />
                      <span className="t-badge" data-open={showBadge ? 'true' : 'false'}>
                        <span className="t-badge-dot block size-2.5 rounded-full border-2 border-[var(--line-strong)] bg-[var(--candy-sun)]" />
                      </span>
                    </span>
                    <span className="type-micro font-semibold">{destination.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

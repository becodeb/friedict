import { useRef, type ReactNode } from 'react'
import { cn, initials } from '@/lib/cn'

export interface AvatarPerson {
  id: string
  display_name: string
  avatar_seed?: string | null
  accent?: number | null
}

const SIZES = {
  xs: 'size-6 text-[0.5625rem]',
  sm: 'size-8 text-[0.6875rem]',
  md: 'size-10 text-xs',
  lg: 'size-14 text-base',
} as const

/**
 * Avatar por iniciales sobre una golosina, con contorno de tinta. Sin fotos:
 * cero subida de archivos, cero moderación de imágenes, y una identidad visual
 * consistente desde el primer segundo.
 *
 * Las dimensiones son fijas por clase para que nunca genere CLS.
 */
export function Avatar({
  person,
  size = 'md',
  className,
}: {
  person: AvatarPerson
  size?: keyof typeof SIZES
  className?: string
}) {
  const accent = ((person.accent ?? 0) % 8 + 8) % 8
  const label = person.avatar_seed?.trim() || initials(person.display_name)

  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-bold uppercase',
        'border-2 border-[var(--line-strong)] text-[var(--on-candy)] ring-2 ring-[var(--bg)] tracking-[0.02em]',
        SIZES[size],
        className,
      )}
      style={{ background: `var(--avatar-${accent})` }}
      aria-hidden="true"
    >
      {label.slice(0, 2)}
    </span>
  )
}

/**
 * transitions-dev-react-css/avatar-group-hover/avatar-group-hover.txt
 *
 * Lift con caída por distancia. El truco de la receta original es escribir
 * `transitionTimingFunction` inline ANTES de cambiar las variables CSS: el
 * navegador usa la curva vigente en el momento del cambio, así que se consigue
 * entrada suave y vuelta con rebote sin declarar dos transiciones.
 */
export function AvatarStack({
  people,
  max = 5,
  size = 'sm',
  children,
}: {
  people: AvatarPerson[]
  max?: number
  size?: keyof typeof SIZES
  children?: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const shown = people.slice(0, max)
  const rest = people.length - shown.length

  const setShifts = (activeIdx: number | null, phase: 'in' | 'out'): void => {
    const root = rootRef.current
    if (!root) return

    const styles = getComputedStyle(document.documentElement)
    const num = (name: string, fallback: number): number => {
      const value = Number.parseFloat(styles.getPropertyValue(name))
      return Number.isFinite(value) ? value : fallback
    }
    const ease = (name: string, fallback: string): string =>
      styles.getPropertyValue(name).trim() || fallback

    const lift = num('--avatar-lift', -4)
    const falloff = num('--avatar-falloff', 0.45)
    const scale = num('--avatar-scale', 1.05)
    const timing =
      phase === 'out'
        ? ease('--avatar-ease-out', 'cubic-bezier(0.34, 3.85, 0.64, 1)')
        : ease('--avatar-ease-in', 'cubic-bezier(0.22, 1, 0.36, 1)')

    root.querySelectorAll<HTMLElement>('.t-avatar').forEach((el, i) => {
      el.style.transitionTimingFunction = timing
      if (activeIdx === null) {
        el.style.setProperty('--shift', '0px')
        el.style.setProperty('--scale-active', '1')
        return
      }
      const distance = Math.abs(i - activeIdx)
      el.style.setProperty('--shift', `${(lift * falloff ** distance).toFixed(3)}px`)
      el.style.setProperty('--scale-active', i === activeIdx ? String(scale) : '1')
    })
  }

  return (
    <div
      ref={rootRef}
      className="flex items-center"
      onMouseLeave={() => setShifts(null, 'out')}
    >
      <ul className="flex items-center -space-x-2">
        {shown.map((person, i) => (
          <li
            key={person.id}
            className="t-avatar"
            onMouseEnter={() => setShifts(i, 'in')}
          >
            <Avatar person={person} size={size} />
          </li>
        ))}
        {rest > 0 && (
          <li className="t-avatar" onMouseEnter={() => setShifts(shown.length, 'in')}>
            <span
              className={cn(
                'inline-grid shrink-0 place-items-center rounded-full',
                'border-2 border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink)] font-bold',
                'ring-2 ring-[var(--bg)] tabular',
                SIZES[size],
              )}
              aria-hidden="true"
            >
              +{rest}
            </span>
          </li>
        )}
      </ul>
      {children}
      {/* El texto accesible reemplaza a la pila de avatares, que es decorativa. */}
      <span className="sr-only">
        {people.length === 1
          ? '1 integrante'
          : `${people.length} integrantes: ${people.map((p) => p.display_name).join(', ')}`}
      </span>
    </div>
  )
}

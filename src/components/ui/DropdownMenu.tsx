import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/cn'
import { cssMs } from '@/lib/css'

export interface MenuAction {
  label: string
  onSelect: () => void
  icon?: ReactNode
  tone?: 'default' | 'danger'
  disabled?: boolean
}

/**
 * transitions-dev-react-css/menu-dropdown/menu-dropdown.txt
 *
 * Abre escalando desde 0.97 con origen en la esquina de anclaje; al cerrar hace
 * un dip a 0.99 y recién después se desmonta, con el mismo patrón de
 * setTimeout de la receta para no cortar la animación de salida.
 */
export function DropdownMenu({
  trigger,
  actions,
  align = 'top-right',
  label,
}: {
  trigger: (props: {
    onClick: () => void
    'aria-expanded': boolean
    'aria-haspopup': 'menu'
  }) => ReactNode
  actions: MenuAction[]
  align?: 'top-right' | 'top-left' | 'bottom-right'
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<HTMLButtonElement[]>([])

  const close = useCallback(() => setOpen(false), [])

  // Ajuste durante el render en lugar de un efecto: el menú tiene que existir
  // en el DOM en el mismo commit en el que se abre, para que el foco pueda
  // entrar sin un frame de retraso.
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open) return
    // Se desmonta recién cuando terminó la animación de cierre.
    const timer = window.setTimeout(
      () => setMounted(false),
      cssMs('--dropdown-close-dur', 150),
    )
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

      event.preventDefault()
      const items = itemsRef.current.filter(Boolean)
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        event.key === 'ArrowDown'
          ? items[(index + 1) % items.length]
          : items[(index - 1 + items.length) % items.length]
      next?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => itemsRef.current[0]?.focus(), 40)
    return () => window.clearTimeout(timer)
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      {trigger({
        onClick: () => setOpen((value) => !value),
        'aria-expanded': open,
        'aria-haspopup': 'menu',
      })}

      {mounted && (
        <div
          role="menu"
          aria-label={label}
          data-origin={align}
          className={cn(
            't-dropdown absolute z-40 min-w-[13rem] overflow-hidden',
            'rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] p-1',
            'shadow-[var(--shadow-3)]',
            align === 'top-right' && 'right-0 top-[calc(100%+6px)]',
            align === 'top-left' && 'left-0 top-[calc(100%+6px)]',
            align === 'bottom-right' && 'bottom-[calc(100%+6px)] right-0',
            open ? 'is-open' : 'is-closing',
          )}
        >
          {actions.map((action, index) => (
            <button
              key={action.label}
              ref={(node) => {
                if (node) itemsRef.current[index] = node
              }}
              role="menuitem"
              type="button"
              disabled={action.disabled}
              onClick={() => {
                close()
                action.onSelect()
              }}
              className={cn(
                'flex min-h-[var(--tap)] w-full items-center gap-2.5 rounded-[var(--r-xs)]',
                'px-3 text-left text-[0.875rem]',
                'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
                'disabled:cursor-not-allowed disabled:text-[var(--ink-3)]',
                action.tone === 'danger'
                  ? 'text-[var(--danger)] hover:bg-[var(--danger-wash)]'
                  : 'text-[var(--ink)] hover:bg-[var(--surface-2)]',
              )}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

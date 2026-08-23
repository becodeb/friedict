import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { cssMs } from '@/lib/css'

/**
 * Diálogo modal.
 *
 * Motion: transitions-dev-react-css/modal/modal.txt para el panel en desktop
 * (escala desde 0.96 al abrir, dip al cerrar) y
 * transitions-dev-react-css/panel-reveal/panel-reveal.txt para el sheet que
 * sube desde abajo en mobile. El scrim usa la misma curva y duración que el
 * panel para que se lean como un solo movimiento.
 *
 * Accesibilidad: se monta como `role="dialog" aria-modal`, atrapa el foco en
 * ciclo, cierra con Escape y con click en el scrim, y devuelve el foco al
 * elemento que lo abrió.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  // Ajuste de estado durante el render: es el patrón que documenta React para
  // reaccionar a un cambio de props sin encadenar un efecto. Montar en un
  // efecto provocaría un render extra antes del primer pintado.
  if (open && !mounted) setMounted(true)
  if (!open && visible) setVisible(false)

  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null
      // El frame de espera es lo que hace posible la animación de entrada: el
      // panel tiene que pintarse una vez en su estado inicial antes de que
      // cambie `data-open`, si no el navegador no tiene desde dónde interpolar.
      const frame = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(frame)
    }

    // Desmontaje diferido para que la salida se llegue a ver.
    const timer = window.setTimeout(() => {
      setMounted(false)
      returnFocusRef.current?.focus?.()
    }, cssMs('--modal-close-dur', 150))
    return () => window.clearTimeout(timer)
  }, [open])

  // Bloquea el scroll del fondo sin que el layout salte por la barra.
  useEffect(() => {
    if (!mounted) return
    const { body, documentElement } = document
    const scrollbar = window.innerWidth - documentElement.clientWidth
    const previousOverflow = body.style.overflow
    const previousPadding = body.style.paddingRight
    body.style.overflow = 'hidden'
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`
    return () => {
      body.style.overflow = previousOverflow
      body.style.paddingRight = previousPadding
    }
  }, [mounted])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables || focusables.length === 0) return

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [onClose],
  )

  useEffect(() => {
    if (!visible) return
    const timer = window.setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return

      // Si el diálogo es un formulario, el foco va al primer campo, no al botón
      // de cerrar. `querySelectorAll` devuelve en orden de documento, y el botón
      // de cerrar está antes en el DOM, así que hay que buscarlo aparte.
      const field = panel.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
      )
      const fallback = panel.querySelector<HTMLElement>('button:not([disabled])')
      ;(field ?? fallback)?.focus()
    }, 50)
    return () => window.clearTimeout(timer)
  }, [visible])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        data-open={visible}
        className="t-scrim absolute inset-0 cursor-default bg-[oklch(0.22_0.01_60_/_0.45)]"
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-open={visible}
        className={cn(
          // `t-sheet` es panel-reveal en mobile y modal en desktop; el corte
          // está en motion.css.
          't-sheet relative flex w-full flex-col bg-[var(--surface)] shadow-[var(--shadow-3)]',
          'rounded-t-[var(--r-lg)] max-h-[92dvh] pb-[max(1.25rem,var(--safe-b))]',
          'sm:rounded-[var(--r-lg)] sm:max-h-[88dvh] sm:pb-0',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-2xl',
        )}
      >
        {/* Agarre visual del sheet en mobile. Decorativo. */}
        <span
          aria-hidden="true"
          className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-[var(--line-strong)] sm:hidden"
        />
        <header className="flex shrink-0 items-start justify-between gap-4 px-5 pt-4 sm:px-6 sm:pt-6">
          <div className="min-w-0">
            <h2 id={titleId} className="type-title text-[1.25rem]">
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="mt-1.5 text-[0.875rem] leading-snug text-[var(--ink-2)]"
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className={cn(
              'grid size-[var(--tap)] shrink-0 place-items-center rounded-[var(--r-sm)]',
              '-mr-2 -mt-2 text-[var(--ink-3)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]',
              'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
            )}
          >
            <X size={20} weight="bold" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>

        {footer && (
          <footer className="shrink-0 border-t border-[var(--line)] px-5 py-4 sm:px-6">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

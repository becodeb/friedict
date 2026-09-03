import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Disclosure accesible para explicar un campo no evidente.
 *
 * NO es `Tooltip.tsx` (ese es puro CSS `:hover`, sin estado: no se puede abrir
 * con toque ni con teclado) y NO usa `aria-describedby`: una descripción que
 * aparece y desaparece se anuncia de forma inconsistente entre lectores de
 * pantalla. `aria-expanded` + `aria-controls` es el patrón que funciona igual
 * en touch, teclado y AT.
 *
 * El disparador es un `<button type="button">` real, así que Enter y Space lo
 * activan solos — comportamiento nativo del elemento, nada que reimplementar.
 * El panel es un `role="note"`, hermano en el DOM (no lo mueve el foco): es
 * una revelación, no un diálogo, y nunca atrapa el Tab.
 */
export function HelpTip({
  label,
  children,
}: {
  label: string
  children: ReactNode
}): ReactElement {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Qué significa ${label}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'grid size-[var(--tap)] shrink-0 place-items-center rounded-full',
          'text-[0.75rem] font-bold text-[var(--ink-3)]',
          'hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)]',
          'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
        )}
      >
        <span aria-hidden="true">?</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="note"
          className={cn(
            'mt-1.5 w-full rounded-[var(--r-md)] border-2 border-[var(--line)]',
            'bg-[var(--bg-sunken)] px-3 py-2 text-[0.8125rem] leading-snug text-[var(--ink-2)]',
          )}
        >
          {children}
        </div>
      )}
    </>
  )
}

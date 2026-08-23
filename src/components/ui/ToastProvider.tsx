import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, Info, WarningCircle } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { cssMs } from '@/lib/css'
import {
  ToastContext,
  type ToastApi,
  type ToastInput,
  type ToastItem,
} from './toast-context'

/**
 * transitions-dev-react-css/toast/toast.txt
 *
 * Entra desde abajo con blur y escala; sale más rápido de lo que entra, que es
 * lo que hace que no moleste. La clase `.is-open` se pone en el frame siguiente
 * al montaje para que la transición tenga desde dónde arrancar.
 *
 * `aria-live="polite"` en la región: los avisos se anuncian sin interrumpir.
 */
const ICONS = {
  neutral: Info,
  success: CheckCircle,
  error: WarningCircle,
} as const

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [open, setOpen] = useState(false)
  const Icon = ICONS[item.tone]

  const ref = useCallback((node: HTMLLIElement | null) => {
    if (!node) return
    requestAnimationFrame(() => setOpen(true))
  }, [])

  return (
    <li
      ref={ref}
      className={cn(
        't-toast pointer-events-auto flex items-start gap-2.5',
        'rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)]',
        'px-3.5 py-3 shadow-[var(--shadow-3)]',
        open && 'is-open',
      )}
    >
      <Icon
        size={18}
        weight="fill"
        className={cn(
          'mt-px shrink-0',
          item.tone === 'success' && 'text-[var(--status-resolved)]',
          item.tone === 'error' && 'text-[var(--danger)]',
          item.tone === 'neutral' && 'text-[var(--ink-3)]',
        )}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 text-[0.875rem] leading-snug text-[var(--ink)]">
        {item.message}
      </p>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick()
            onDismiss()
          }}
          className="shrink-0 text-[0.8125rem] font-medium text-[var(--accent-ink)] underline underline-offset-2"
        >
          {item.action.label}
        </button>
      )}
    </li>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const show = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++
      const tone = input.tone ?? 'neutral'
      const duration = input.duration ?? (tone === 'error' ? 6000 : 3600)

      setItems((current) => [...current.slice(-2), { ...input, id, tone }])

      const timer = window.setTimeout(
        () => dismiss(id),
        duration + cssMs('--toast-open', 350),
      )
      timers.current.set(id, timer)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <ul
          aria-live="polite"
          aria-relevant="additions"
          className={cn(
            'pointer-events-none fixed inset-x-0 z-[60] mx-auto flex w-full max-w-[26rem]',
            'flex-col gap-2 px-4',
            // Por encima de la nav inferior en mobile.
            'bottom-[calc(var(--bottom-nav-h)+var(--safe-b)+0.75rem)]',
            'sm:bottom-5',
          )}
        >
          {items.map((item) => (
            <Toast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
          ))}
        </ul>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

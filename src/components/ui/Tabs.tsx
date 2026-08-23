import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

export interface TabItem<T extends string> {
  value: T
  label: string
  count?: number
}

/**
 * transitions-dev-react-css/tabs-sliding/tabs-sliding.txt
 *
 * La píldora es un elemento absoluto cuyo `transform` y `width` se escriben
 * inline; la transición interpola entre la posición medida anterior y la nueva.
 * En el primer layout se posiciona sin animar para que no salga volando desde
 * la izquierda.
 *
 * La receta original escuchaba `window.resize`; acá se usa un `ResizeObserver`
 * sobre la propia barra, que además reacciona a cambios de contenido (los
 * contadores cambian de ancho cuando llegan votos nuevos).
 *
 * Teclado: patrón `tablist` con flechas, Home y End.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (next: T) => void
  label: string
  className?: string
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  const isFirstLayout = useRef(true)

  const movePill = useCallback((animate: boolean) => {
    const bar = barRef.current
    const pill = pillRef.current
    if (!bar || !pill) return

    const active = bar.querySelector<HTMLButtonElement>('[aria-selected="true"]')
    if (!active) return

    if (!animate) {
      const previous = pill.style.transition
      pill.style.transition = 'none'
      pill.style.transform = `translateX(${active.offsetLeft - 3}px)`
      pill.style.width = `${active.offsetWidth}px`
      pill.style.height = `${active.offsetHeight}px`
      void pill.offsetWidth
      pill.style.transition = previous
      return
    }
    pill.style.transform = `translateX(${active.offsetLeft - 3}px)`
    pill.style.width = `${active.offsetWidth}px`
  }, [])

  useLayoutEffect(() => {
    movePill(!isFirstLayout.current)
    isFirstLayout.current = false
  }, [value, items, movePill])

  useEffect(() => {
    const bar = barRef.current
    if (!bar || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => movePill(false))
    observer.observe(bar)
    return () => observer.disconnect()
  }, [movePill])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const index = items.findIndex((item) => item.value === value)
    if (index < 0) return

    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % items.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + items.length) % items.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = items.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const next = items[nextIndex]
    if (!next) return
    onChange(next.value)

    const tabs = barRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    tabs?.[nextIndex]?.focus()
  }

  return (
    <div
      ref={barRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('t-tabs max-w-full overflow-x-auto', className)}
    >
      <span ref={pillRef} className="t-tabs-pill" aria-hidden="true" />
      {items.map((item) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            className="t-tab type-meta whitespace-nowrap"
          >
            {item.label}
            {typeof item.count === 'number' && (
              <span
                className={cn(
                  'ml-1.5 tabular',
                  selected ? 'text-[var(--accent-ink)]' : 'text-[var(--ink-3)]',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

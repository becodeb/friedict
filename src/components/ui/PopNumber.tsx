import { useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

/**
 * transitions-dev-react-css/number-pop-in/number-pop-in.txt
 *
 * Cada dígito entra desde abajo con blur; los dos últimos llevan 1× y 2× el
 * stagger, así que la unidad aterriza al final y el número "cae en su lugar".
 *
 * Para repetir la animación hay que sacar `.is-animating`, forzar un reflow y
 * volver a ponerla. Se hace en `useLayoutEffect` porque para ese momento React
 * ya escribió los dígitos nuevos en el DOM pero el navegador todavía no pintó.
 */
export function PopNumber({
  value,
  className,
  suffix,
}: {
  value: number
  className?: string
  suffix?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const previous = useRef<number | null>(null)

  const digits = String(value).split('')

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return

    // No se anima el primer render: la cifra ya está donde tiene que estar.
    if (previous.current === null) {
      previous.current = value
      return
    }
    if (previous.current === value) return
    previous.current = value

    node.classList.remove('is-animating')
    void node.offsetHeight // reflow
    node.classList.add('is-animating')
  }, [value])

  return (
    <span className={cn('inline-flex items-baseline', className)}>
      <span ref={ref} className="t-digit-group" aria-hidden="true">
        {digits.map((digit, i) => {
          const fromEnd = digits.length - 1 - i
          return (
            <span
              key={`${i}-${digit}`}
              className="t-digit"
              {...(fromEnd === 1
                ? { 'data-stagger': '1' }
                : fromEnd === 0
                  ? { 'data-stagger': '2' }
                  : {})}
            >
              {digit}
            </span>
          )
        })}
      </span>
      {suffix ? <span aria-hidden="true">{suffix}</span> : null}
      {/* El grupo animado está oculto para lectores: el valor se anuncia una vez. */}
      <span className="sr-only">
        {value}
        {suffix ?? ''}
      </span>
    </span>
  )
}

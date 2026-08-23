import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { cn } from '@/lib/cn'
import { cssMs } from '@/lib/css'

/**
 * transitions-dev-react-css/text-states-swap/text-states-swap.txt
 *
 * Intercambio en tres fases: el texto viejo sale hacia arriba con blur, se
 * reemplaza el contenido, se salta a "abajo, sin transición", y recién ahí se
 * suelta para que el nuevo entre.
 *
 * `flushSync` no es decorativo: la receta necesita que el texto nuevo ya esté
 * en el DOM antes de forzar el reflow. Con el batching normal de React, el
 * reflow ocurriría con el texto viejo todavía en pantalla y la fase de entrada
 * se perdería.
 *
 * Se usa para "En prueba" → "Abierta" y para el contador de participantes.
 */
export function TextSwap({
  value,
  className,
}: {
  value: string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [display, setDisplay] = useState(value)

  useEffect(() => {
    if (value === display) return

    const node = ref.current
    if (!node) {
      setDisplay(value)
      return
    }

    node.classList.add('is-exit')
    const timer = window.setTimeout(() => {
      flushSync(() => setDisplay(value))
      node.classList.remove('is-exit')
      node.classList.add('is-enter-start')
      void node.offsetHeight // reflow
      node.classList.remove('is-enter-start')
    }, cssMs('--text-swap-dur', 150))

    return () => window.clearTimeout(timer)
  }, [value, display])

  return (
    <span ref={ref} className={cn('t-text-swap', className)}>
      {display}
    </span>
  )
}

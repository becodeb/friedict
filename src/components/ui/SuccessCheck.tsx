import { useEffect, useRef } from 'react'
import { cn } from '@/lib/cn'

/**
 * transitions-dev-react-css/success-check/success-check.txt
 *
 * El wrapper hace fade + rotate + blur + bob; el path se dibuja solo con un
 * pequeño delay. Para poder repetirlo desde un estado ya visible hay que
 * volver a "out", forzar un reflow y recién ahí pasar a "in", si no los
 * keyframes no reinician.
 */
export function SuccessCheck({
  show,
  size = 20,
  className,
}: {
  show: boolean
  size?: number
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    if (!show) {
      node.setAttribute('data-state', 'out')
      return
    }
    node.setAttribute('data-state', 'out')
    void node.offsetWidth // reflow: reinicia los keyframes
    node.setAttribute('data-state', 'in')
  }, [show])

  return (
    <span
      ref={ref}
      className={cn('t-success-check', className)}
      data-state="out"
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path
          d="M5 12.5l4.5 4.5L19 7.5"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

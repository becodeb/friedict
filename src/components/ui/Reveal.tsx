import { useEffect, useRef, type ElementType, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * transitions-dev-react-css/texts-reveal/texts-reveal.txt
 *
 * Cada hijo directo entra desplazado, borroso y transparente; el padre pasa a
 * `.is-shown` en el próximo frame y todos vuelven a su lugar con un stagger
 * corto, para que la vista caiga primero en el título.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  className,
  delay = 0,
}: {
  children: ReactNode
  as?: ElementType
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    let frame = 0
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => {
        node.classList.add('is-shown')
      })
    }, delay)

    return () => {
      window.clearTimeout(timer)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [delay])

  return (
    <Tag ref={ref} className={cn('t-stagger', className)}>
      {children}
    </Tag>
  )
}

export function RevealLine({
  children,
  index = 1,
  className,
  as: Tag = 'span',
}: {
  children: ReactNode
  index?: 1 | 2 | 3 | 4
  className?: string
  as?: ElementType
}) {
  return (
    <Tag
      className={cn('t-stagger-line', index > 1 && `t-stagger-line--${index}`, className)}
    >
      {children}
    </Tag>
  )
}

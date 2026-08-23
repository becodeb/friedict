import { cn } from '@/lib/cn'
import { STATUS_LABEL } from '@/lib/prediction'
import type { PredictionStatus as Status } from '@/lib/types'
import { TextSwap } from '@/components/ui/TextSwap'

/**
 * Etiqueta de estado.
 *
 * El estado se comunica por TEXTO además de por color: quien no distingue el
 * ocre del tomate lee igual "En prueba" y "Abierta". El color es refuerzo,
 * nunca el único canal.
 *
 * El cambio de texto usa `text-states-swap`, así que el momento en que una
 * predicción pasa de "En prueba" a "Abierta" se ve, no aparece de golpe.
 */
const TONE: Record<Status, string> = {
  proposed: 'text-[var(--status-testing)]',
  active: 'text-[var(--accent-ink)]',
  closed: 'text-[var(--status-closed)]',
  resolving: 'text-[var(--status-closed)]',
  resolved: 'text-[var(--status-resolved)]',
  expired: 'text-[var(--status-expired)]',
  cancelled: 'text-[var(--status-cancelled)]',
}

export function PredictionStatusLabel({
  status,
  className,
  animate = true,
}: {
  status: Status
  className?: string
  animate?: boolean
}) {
  const label = STATUS_LABEL[status]

  return (
    <span className={cn('type-meta', TONE[status], className)}>
      {animate ? <TextSwap value={label} /> : label}
    </span>
  )
}

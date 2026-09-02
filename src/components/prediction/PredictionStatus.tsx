import { STATUS_LABEL } from '@/lib/prediction'
import type { PredictionStatus as Status } from '@/lib/types'
import { Sticker, type StickerTone } from '@/components/ui/Sticker'
import { TextSwap } from '@/components/ui/TextSwap'

/**
 * Sticker de estado.
 *
 * El estado se comunica por TEXTO además de por color: quien no distingue el
 * sol de la lima lee igual "En prueba" y "Abierta". El color es refuerzo,
 * nunca el único canal.
 *
 * El cambio de texto usa `text-states-swap`, así que el momento en que una
 * predicción pasa de "En prueba" a "Abierta" se ve, no aparece de golpe.
 */
const STATUS_TONE: Record<Status, StickerTone> = {
  proposed: 'sun',
  active: 'lime',
  closed: 'sky',
  resolving: 'sky',
  resolved: 'ink',
  expired: 'grey',
  cancelled: 'grey',
}

export function PredictionStatusLabel({
  status,
  className,
  animate = true,
  cut = false,
  tilt = 0,
}: {
  status: Status
  className?: string
  animate?: boolean
  cut?: boolean
  tilt?: number
}) {
  const label = STATUS_LABEL[status]

  return (
    <Sticker tone={STATUS_TONE[status]} cut={cut} tilt={tilt} className={className}>
      {animate ? <TextSwap value={label} /> : label}
    </Sticker>
  )
}

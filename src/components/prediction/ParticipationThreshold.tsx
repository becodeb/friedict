import { cn } from '@/lib/cn'
import { participantsMissing } from '@/lib/prediction'
import { PopNumber } from '@/components/ui/PopNumber'
import { TextSwap } from '@/components/ui/TextSwap'

/**
 * El indicador de "En prueba".
 *
 * Es el mecanismo más particular del producto, así que tiene su propio
 * lenguaje: puntos llenos por cada persona que ya participó, vacíos por las que
 * faltan, y una frase que cambia según cuánto falta.
 *
 * Cuando llega la última persona, el texto pasa por `text-states-swap` y el
 * número por `number-pop-in`. Ese momento —"Listo, esta predicción queda"— es
 * de los pocos que merecen motion propio.
 */
export function ParticipationThreshold({
  participantCount,
  minimumParticipants,
  qualified,
  className,
}: {
  participantCount: number
  minimumParticipants: number
  qualified: boolean
  className?: string
}) {
  const missing = participantsMissing(participantCount, minimumParticipants)

  const message = qualified
    ? 'Listo, esta predicción queda'
    : missing === 1
      ? 'Falta una persona para que siga'
      : `Faltan ${missing} personas para que siga`

  return (
    <div className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1', className)}>
      <span className="flex items-center gap-1" aria-hidden="true">
        {Array.from({ length: minimumParticipants }, (_, i) => (
          <span
            key={i}
            className={cn(
              'size-[7px] rounded-full',
              'transition-[background-color,transform] duration-[var(--motion-base)]',
              'ease-[var(--ease-emphasized)] motion-reduce:transition-none',
              i < participantCount
                ? qualified
                  ? 'scale-100 bg-[var(--accent)]'
                  : 'scale-100 bg-[var(--status-testing)]'
                : 'scale-90 bg-[var(--line-strong)]',
            )}
          />
        ))}
      </span>

      <span
        className={cn(
          'type-meta',
          qualified ? 'text-[var(--accent-ink)]' : 'text-[var(--ink-2)]',
        )}
      >
        {/* La versión animada es decorativa; el dato se anuncia una sola vez,
            en una frase completa, en el sr-only de al lado. */}
        <span className="inline-flex items-baseline gap-[0.2em]" aria-hidden="true">
          <PopNumber value={participantCount} />
          <span>de {minimumParticipants}</span>
        </span>
        <span className="sr-only">
          {participantCount} de {minimumParticipants} personas
        </span>
      </span>

      <span
        className={cn(
          'text-[0.8125rem]',
          qualified ? 'font-medium text-[var(--accent-ink)]' : 'text-[var(--ink-3)]',
        )}
      >
        <TextSwap value={message} />
      </span>
    </div>
  )
}

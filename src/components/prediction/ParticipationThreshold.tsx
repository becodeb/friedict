import { cn } from '@/lib/cn'
import { participantsMissing } from '@/lib/prediction'
import { PopNumber } from '@/components/ui/PopNumber'
import { TextSwap } from '@/components/ui/TextSwap'

/**
 * El indicador de "En prueba".
 *
 * Es el mecanismo más particular del producto, así que tiene su propio
 * lenguaje: una carita por cada persona que ya se jugó y un círculo punteado
 * con un signo de pregunta por cada una que falta. Las caritas no tienen
 * iniciales a propósito: hasta el cierre nadie sabe quién votó, y eso lo
 * garantiza la base, no esta pantalla.
 *
 * Cuando llega la última persona, el texto pasa por `text-states-swap` y el
 * número por `number-pop-in`. Ese momento —"Listo, esta predicción queda"— es
 * de los pocos que merecen motion propio.
 */
function Face() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="5.5" cy="6.2" r="1.15" fill="currentColor" />
      <circle cx="10.5" cy="6.2" r="1.15" fill="currentColor" />
      <path
        d="M5 10c1.3 1.7 4.7 1.7 6 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function ParticipationThreshold({
  participantCount,
  requiredParticipants,
  memberCount,
  qualified,
  className,
}: {
  participantCount: number
  /** Cuánta gente hace falta — ya acotado al conteo vivo del grupo. */
  requiredParticipants: number
  /** Integrantes vivos del grupo: la fila de caras nunca dibuja más que esto. */
  memberCount: number
  qualified: boolean
  className?: string
}) {
  const missing = participantsMissing(participantCount, requiredParticipants)

  // El denominador es el GRUPO, no el umbral. Un "2 de 3" donde el 3 salía de
  // un cálculo invisible es exactamente lo que no se entendía: el 3 no era
  // nadie. Contra el conteo vivo, "2 de 5" se lee solo. Cuántos hacen falta
  // para que quede es otra cosa, y se dice aparte.
  //
  // memberCount llega en 0 mientras la consulta de integrantes está en vuelo;
  // ahí se cae al umbral para no mostrar nunca un "2 de 0".
  const total = memberCount > 0 ? memberCount : requiredParticipants
  // La fila de caras se corta a 8: más allá deja de leerse de un vistazo y los
  // números de al lado siguen diciendo lo mismo.
  const faceCount = Math.min(total, 8)

  const message = qualified
    ? 'Listo, esta predicción queda'
    : missing === 1
      ? 'Falta una persona para que quede'
      : `Faltan ${missing} personas para que quede`

  const spokenCount =
    `Votaron ${participantCount} de ${total} personas del grupo` +
    (qualified ? '' : `, necesita ${requiredParticipants}`)

  return (
    <div className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1.5', className)}>
      <span className="flex items-center -space-x-1.5" aria-hidden="true">
        {Array.from({ length: faceCount }, (_, i) => {
          const filled = i < participantCount
          return (
            <span
              key={i}
              className={cn(
                'grid size-7 place-items-center rounded-full border-2 ring-2 ring-[var(--surface)]',
                'transition-[background-color,transform] duration-[var(--motion-base)]',
                'ease-[var(--ease-emphasized)] motion-reduce:transition-none',
                filled
                  ? cn(
                      'scale-100 border-[var(--line-strong)] text-[var(--on-candy)]',
                      qualified ? 'bg-[var(--status-active)]' : 'bg-[var(--status-testing)]',
                    )
                  : 'scale-90 border-dashed border-[var(--ink-3)] bg-[var(--surface)] text-[0.75rem] font-bold text-[var(--ink-3)]',
              )}
            >
              {filled ? <Face /> : '?'}
            </span>
          )
        })}
      </span>

      <span
        className={cn(
          'type-meta',
          qualified ? 'text-[var(--status-active-ink)]' : 'text-[var(--ink-2)]',
        )}
      >
        {/* La versión animada es decorativa; el dato se anuncia una sola vez,
            en una frase completa, en el sr-only de al lado. */}
        <span className="inline-flex items-baseline gap-[0.2em]" aria-hidden="true">
          <PopNumber value={participantCount} />
          <span>de {total}</span>
        </span>
        {/* La frase se arma en JS y no en JSX multilínea: ahí el salto de
            línea se colapsa en un espacio y quedaría "del grupo , necesita". */}
        <span className="sr-only">{spokenCount}</span>
      </span>

      <span
        className={cn(
          'text-[0.8125rem]',
          qualified ? 'font-semibold text-[var(--status-active-ink)]' : 'text-[var(--ink-3)]',
        )}
      >
        <TextSwap value={message} />
      </span>
    </div>
  )
}

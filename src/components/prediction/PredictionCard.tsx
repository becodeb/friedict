import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowsClockwise, Repeat, Trophy } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import {
  STATUS_RAIL,
  canSeeResults,
  effectiveStatus,
  isRevealed,
  voteAvailability,
} from '@/lib/prediction'
import { formatCountdown, formatRelative } from '@/lib/time'
import { friendlyError } from '@/lib/errors'
import type { Prediction } from '@/lib/types'
import { useCastVote } from '@/data/predictions'
import { useToast } from '@/components/ui/toast-context'
import { Countdown } from '@/components/ui/Countdown'
import { SuccessCheck } from '@/components/ui/SuccessCheck'
import { PredictionStatusLabel } from './PredictionStatus'
import { ParticipationThreshold } from './ParticipationThreshold'
import { VoteOption } from './VoteOption'

/**
 * La tarjeta del feed.
 *
 * Decisión de diseño: NO es una tarjeta con caja. Es un bloque separado por una
 * línea de pelo sobre el fondo de la página, con un rail de color a la
 * izquierda que codifica el estado. Encajar cada predicción en un rectángulo
 * con borde y sombra —y adentro otro rectángulo por opción— es exactamente el
 * apilado de cajas que hace que una app se vea generada. Acá la jerarquía la
 * dan el espacio, el peso tipográfico y el rail.
 */
export function PredictionCard({
  prediction,
  groupId,
  userId,
  index = 0,
}: {
  prediction: Prediction
  groupId: string
  userId: string | null
  index?: number
}) {
  const toast = useToast()
  const castVote = useCastVote(userId)
  const [savedAt, setSavedAt] = useState(0)
  const savedTimer = useRef<number | undefined>(undefined)

  const status = effectiveStatus(prediction)
  const availability = voteAvailability(prediction, prediction.myVotes)
  const revealed = isRevealed(status)
  const hasVoted = prediction.myVotes.length > 0
  const showResults = canSeeResults(prediction, status, hasVoted)

  const totalVotes = prediction.options.reduce(
    (sum, option) => sum + (option.tally?.voteCount ?? 0),
    0,
  )
  const selectedOptionId = prediction.myVote?.option_id ?? null

  useEffect(() => {
    return () => {
      if (savedTimer.current) window.clearTimeout(savedTimer.current)
    }
  }, [])

  const onVote = (optionId: string): void => {
    if (!availability.canVote || castVote.isPending) return

    castVote.mutate(
      { predictionId: prediction.id, optionId, groupId },
      {
        onSuccess: (result) => {
          setSavedAt(Date.now())
          if (savedTimer.current) window.clearTimeout(savedTimer.current)
          savedTimer.current = window.setTimeout(() => setSavedAt(0), 2200)

          if (
            prediction.status === 'proposed' &&
            result.status === 'active' &&
            !prediction.is_default
          ) {
            toast.show({ message: 'Listo, esta predicción queda.', tone: 'success' })
          }
        },
        onError: (error) => {
          toast.show({ message: friendlyError(error, 'No pudimos guardar tu voto.'), tone: 'error' })
        },
      },
    )
  }

  const qualified = status !== 'proposed'
  const isRecurring = prediction.voting_mode === 'recurring'
  const winnerId = prediction.resolved_option_id

  return (
    <article
      className="t-item-in relative border-t border-[var(--line)] py-5 pl-4"
      style={{ '--i': index } as React.CSSProperties}
    >
      <span
        className="status-rail"
        style={{ '--rail': STATUS_RAIL[status] } as React.CSSProperties}
        aria-hidden="true"
      />

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <PredictionStatusLabel status={status} />

        {!revealed && status !== 'expired' && (
          <Countdown
            target={prediction.closes_at}
            prefix="cierra en"
            className="type-meta text-[var(--ink-3)]"
          />
        )}
        {status === 'resolved' && prediction.resolved_at && (
          <span className="type-meta text-[var(--ink-3)]">
            {formatRelative(prediction.resolved_at)}
          </span>
        )}

        {isRecurring && (
          <span className="type-meta inline-flex items-center gap-1 text-[var(--ink-3)]">
            <Repeat size={12} weight="bold" aria-hidden="true" />
            evolutiva
          </span>
        )}
        {prediction.is_default && (
          <span className="type-meta text-[var(--ink-3)]">del sistema</span>
        )}
      </div>

      {/* Pregunta.
          El `py-3 -my-1.5` no es capricho: un título de una sola línea mide
          22px de alto y quedaría muy por debajo del objetivo táctil de 44px.
          El padding agranda el área de toque y el margen negativo devuelve el
          espacio, así que el ritmo vertical no cambia. */}
      <h3 className="mt-1">
        <Link
          to={`/g/${groupId}/p/${prediction.id}`}
          className={cn(
            'type-question block rounded-[var(--r-xs)] py-3 -my-1.5 text-[var(--ink)]',
            'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
            'hover:text-[var(--accent-ink)]',
          )}
        >
          {prediction.title}
        </Link>
      </h3>

      {prediction.description && (
        <p className="mt-1.5 text-[0.875rem] leading-snug text-[var(--ink-2)]">
          {prediction.description}
        </p>
      )}

      {/* Opciones */}
      <div
        role="radiogroup"
        aria-label={`Opciones de: ${prediction.title}`}
        className="mt-3.5 space-y-1.5"
      >
        {prediction.options.map((option) => (
          <VoteOption
            key={option.id}
            option={option}
            selected={selectedOptionId === option.id}
            disabled={!availability.canVote || castVote.isPending}
            showResults={showResults}
            totalVotes={totalVotes}
            isWinner={winnerId === option.id}
            pending={castVote.isPending}
            onSelect={() => onVote(option.id)}
          />
        ))}
      </div>

      {/* Pie contextual */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {status === 'proposed' ? (
            <ParticipationThreshold
              participantCount={prediction.participant_count}
              minimumParticipants={prediction.minimum_participants}
              qualified={qualified}
            />
          ) : status === 'expired' ? (
            <p className="text-[0.8125rem] text-[var(--ink-3)]">
              No juntó las {prediction.minimum_participants} personas a tiempo.
            </p>
          ) : status === 'closed' || status === 'resolving' ? (
            <p className="text-[0.8125rem] text-[var(--ink-2)]">
              Se cerraron las predicciones.{' '}
              <Link
                to={`/g/${groupId}/p/${prediction.id}`}
                className="font-medium text-[var(--accent-ink)] underline underline-offset-2"
              >
                {status === 'resolving' ? 'Confirmar resultado' : 'Resolver resultado'}
              </Link>
            </p>
          ) : status === 'resolved' ? (
            <p className="inline-flex items-center gap-1.5 text-[0.8125rem] text-[var(--ink-2)]">
              <Trophy size={14} weight="fill" className="text-[var(--status-resolved)]" aria-hidden="true" />
              <Link
                to={`/g/${groupId}/p/${prediction.id}`}
                className="font-medium text-[var(--ink)] underline underline-offset-2"
              >
                Ver qué pasó
              </Link>
            </p>
          ) : availability.reason === 'cycle_used' && availability.nextAt ? (
            <p className="inline-flex items-center gap-1.5 text-[0.8125rem] text-[var(--ink-3)]">
              <ArrowsClockwise size={14} weight="bold" aria-hidden="true" />
              Votás de nuevo en {formatCountdown(availability.nextAt)}
            </p>
          ) : prediction.myVote ? (
            <p className="inline-flex items-center gap-1.5 text-[0.8125rem] text-[var(--ink-3)]">
              <SuccessCheck
                show={savedAt > 0}
                size={14}
                className="text-[var(--status-resolved)]"
              />
              {savedAt > 0 ? 'Tu voto quedó guardado' : 'Podés cambiarlo hasta el cierre'}
            </p>
          ) : (
            <p className="text-[0.8125rem] text-[var(--ink-3)]">
              {prediction.participant_count === 0
                ? 'Todavía nadie se jugó'
                : `${prediction.participant_count} ${
                    prediction.participant_count === 1 ? 'persona ya eligió' : 'personas ya eligieron'
                  }`}
            </p>
          )}
        </div>

        <Link
          to={`/g/${groupId}/p/${prediction.id}`}
          className={cn(
            'inline-flex min-h-[var(--tap)] shrink-0 items-center gap-1 rounded-[var(--r-xs)]',
            'type-meta text-[var(--ink-3)] hover:text-[var(--ink)]',
            'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
          )}
        >
          Detalle
          <ArrowRight size={13} weight="bold" aria-hidden="true" />
        </Link>
      </div>
    </article>
  )
}

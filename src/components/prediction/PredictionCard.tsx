import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowsClockwise, Repeat, Trophy } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import {
  canSeeResults,
  effectiveStatus,
  isRevealed,
  voteAvailability,
  voteWindowCopy,
} from '@/lib/prediction'
import { Button } from '@/components/ui/Button'
import { formatCountdown, formatRelative } from '@/lib/time'
import { friendlyError } from '@/lib/errors'
import type { Prediction } from '@/lib/types'
import { useCastVote } from '@/data/predictions'
import { useToast } from '@/components/ui/toast-context'
import { Countdown } from '@/components/ui/Countdown'
import { Burst, Sticker } from '@/components/ui/Sticker'
import { SuccessCheck } from '@/components/ui/SuccessCheck'
import { PredictionStatusLabel } from './PredictionStatus'
import { ParticipationThreshold } from './ParticipationThreshold'
import { VoteOption } from './VoteOption'

/**
 * La tarjeta del feed.
 *
 * Una tarjeta blanca con contorno de tinta y sombra dura, y los stickers
 * pegados sobre el borde superior: a la izquierda el estado, a la derecha lo
 * que hace falta saber ahora (cuándo cierra, si es evolutiva, si la propuso
 * el sistema). Cuando se resuelve, explota el «¡Estaba cantado!» en la
 * esquina. La jerarquía la dan la pregunta en Bricolage y las píldoras de las
 * opciones, no más cajas adentro de cajas.
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

  // Mismo patrón de estagiado que PredictionDetail: vive en el consumidor, se
  // resetea en el render cuando cambia lo que lo vuelve obsoleto.
  const [staged, setStaged] = useState<string | null>(null)
  const voteKey = `${prediction.myVote?.option_id ?? ''}:${prediction.myVote?.cycle ?? ''}:${status}`
  const [lastVoteKey, setLastVoteKey] = useState(voteKey)
  if (lastVoteKey !== voteKey) {
    setLastVoteKey(voteKey)
    setStaged(null)
  }

  useEffect(() => {
    return () => {
      if (savedTimer.current) window.clearTimeout(savedTimer.current)
    }
  }, [])

  const onConfirm = (): void => {
    if (!staged || castVote.isPending) return
    const optionId = staged

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
  const detailTo = `/g/${groupId}/p/${prediction.id}`

  return (
    <article
      className="t-item-in card-pop relative mt-7 px-4 pb-4 pt-6 sm:px-5"
      style={{ '--i': index } as React.CSSProperties}
    >
      {/* Stickers pegados sobre el borde. */}
      <div className="pointer-events-none absolute inset-x-3 -top-[15px] flex items-start justify-between gap-2 sm:inset-x-4">
        <PredictionStatusLabel status={status} cut tilt={-4} />

        {!revealed && status !== 'expired' && prediction.closes_at !== null && (
          <Sticker cut tilt={3}>
            <Countdown target={prediction.closes_at} prefix="cierra en" />
          </Sticker>
        )}
        {!revealed && status !== 'expired' && prediction.closes_at === null && (
          <Sticker tone="sky" cut tilt={3}>
            sin fecha de cierre
          </Sticker>
        )}
      </div>

      {status === 'resolved' && <Burst className="-right-3 -top-8 sm:-right-4" />}

      {/* Lo que describe a la predicción y no a su momento va adentro, sobre la
          pregunta: en el borde sólo caben dos stickers sin taparse en mobile. */}
      {(isRecurring || prediction.is_default) && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {isRecurring && (
            <Sticker tone="sky" tilt={-1}>
              <Repeat size={11} weight="bold" aria-hidden="true" />
              evolutiva
            </Sticker>
          )}
          {prediction.is_default && <Sticker tilt={1}>del sistema</Sticker>}
        </div>
      )}

      {/* Pregunta.
          El `py-3 -my-1.5` no es capricho: un título de una sola línea mide
          24px de alto y quedaría muy por debajo del objetivo táctil de 44px.
          El padding agranda el área de toque y el margen negativo devuelve el
          espacio, así que el ritmo vertical no cambia. */}
      <h3 className={cn('mt-1', status === 'resolved' && 'pr-16')}>
        <Link
          to={detailTo}
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
        <p className="mt-2 text-[0.875rem] leading-snug text-[var(--ink-2)]">
          {prediction.description}
        </p>
      )}

      {/* Opciones */}
      <div
        role="radiogroup"
        aria-label={`Opciones de: ${prediction.title}`}
        className="mt-4 space-y-2"
      >
        {prediction.options.map((option) => (
          <VoteOption
            key={option.id}
            option={option}
            selected={selectedOptionId === option.id}
            staged={staged === option.id}
            disabled={!availability.canVote || castVote.isPending}
            showResults={showResults}
            totalVotes={totalVotes}
            isWinner={winnerId === option.id}
            pending={castVote.isPending}
            onSelect={() => setStaged(option.id)}
          />
        ))}
      </div>

      {/* Confirmar: se monta sólo mientras hay algo estagiado, así la tarjeta
          no crece para la mayoría, que no está votando en este momento. Nace
          como consecuencia directa del tap propio, así que el foco queda en
          el radio tocado y este botón es la siguiente parada del Tab; nunca
          roba el foco. */}
      {staged !== null && staged !== prediction.myVote?.option_id && (
        <div className="mt-2.5">
          <Button
            variant="primary"
            size="sm"
            loading={castVote.isPending}
            onClick={onConfirm}
          >
            {prediction.myVote ? 'Cambiar mi voto' : 'Confirmar'}
          </Button>
        </div>
      )}

      {/* Pie contextual */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {status === 'proposed' ? (
            <ParticipationThreshold
              participantCount={prediction.participant_count}
              requiredParticipants={prediction.required_participants}
              memberCount={prediction.member_count}
              qualified={qualified}
            />
          ) : status === 'expired' ? (
            <p className="text-[0.8125rem] text-[var(--ink-3)]">
              No juntó las {prediction.required_participants} personas a tiempo.
            </p>
          ) : status === 'closed' || status === 'resolving' ? (
            <p className="text-[0.8125rem] text-[var(--ink-2)]">
              Se cerraron las predicciones.{' '}
              <Link
                to={detailTo}
                className="font-semibold text-[var(--accent-ink)] underline underline-offset-2"
              >
                {status === 'resolving' ? 'Confirmar resultado' : 'Resolver resultado'}
              </Link>
            </p>
          ) : status === 'resolved' ? (
            <p className="inline-flex items-center gap-1.5 text-[0.8125rem] text-[var(--ink-2)]">
              <Trophy
                size={14}
                weight="fill"
                className="text-[var(--status-resolved-ink)]"
                aria-hidden="true"
              />
              {prediction.resolved_at && (
                <span className="text-[var(--ink-3)]">
                  {formatRelative(prediction.resolved_at)} ·{' '}
                </span>
              )}
              <Link
                to={detailTo}
                className="font-semibold text-[var(--ink)] underline underline-offset-2"
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
                className="text-[var(--status-active-ink)]"
              />
              {savedAt > 0
                ? 'Tu voto quedó guardado'
                : availability.reason === 'vote_locked'
                  ? 'Tu voto quedó firme'
                  : voteWindowCopy(prediction.vote_change_window)}
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
          to={detailTo}
          className={cn(
            'inline-flex min-h-[var(--tap)] shrink-0 items-center gap-1 rounded-[var(--r-pill)]',
            'border-2 border-[var(--line-strong)] bg-[var(--surface)] px-3.5',
            'text-[0.8125rem] font-semibold text-[var(--ink)]',
            'transition-[background-color,transform,box-shadow] duration-[var(--motion-fast)]',
            'hover:bg-[var(--surface-2)] hover:shadow-[var(--shadow-1)]',
            'motion-reduce:transition-none',
          )}
        >
          Detalle
          <ArrowRight size={13} weight="bold" aria-hidden="true" />
        </Link>
      </div>
    </article>
  )
}

import { Suspense, lazy, useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, Repeat, Trophy } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { useAuth } from '@/auth/useAuth'
import {
  useAddOption,
  useCancelPrediction,
  useCastVote,
  usePrediction,
  usePredictionScores,
  useVoteTimeline,
} from '@/data/predictions'
import { useMembers } from '@/data/groups'
import { usePredictionRealtime } from '@/data/realtime'
import {
  STATUS_RAIL,
  canSeeResults,
  effectiveStatus,
  isRevealed,
  voteAvailability,
} from '@/lib/prediction'
import { formatCountdown, formatDateTime, formatRelative } from '@/lib/time'
import { friendlyError } from '@/lib/errors'
import { explainScore } from '@/lib/scoring'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Countdown } from '@/components/ui/Countdown'
import { ConfettiBurst } from '@/components/ui/Confetti'
import { PopNumber } from '@/components/ui/PopNumber'
import { Skeleton } from '@/components/ui/Skeleton'
import { TextField } from '@/components/ui/Field'
import { ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/toast-context'
import { PredictionStatusLabel } from '@/components/prediction/PredictionStatus'
import { ParticipationThreshold } from '@/components/prediction/ParticipationThreshold'
import { VoteOption } from '@/components/prediction/VoteOption'
import { ResolutionPanel } from '@/components/prediction/ResolutionPanel'

/**
 * Recharts pesa ~105 kB comprimido y sólo lo necesita el gráfico de evolución,
 * que aparece únicamente en predicciones evolutivas con varias rondas. Cargarlo
 * al abrir cualquier detalle sería hacérselo pagar a todo el mundo.
 */
const PredictionTimelineChart = lazy(() =>
  import('@/components/prediction/PredictionTimelineChart').then((m) => ({
    default: m.PredictionTimelineChart,
  })),
)

interface GroupContext {
  groupId: string
  isAdmin: boolean
}

/**
 * Detalle de una predicción.
 *
 * Es la pantalla donde se revela todo: al cerrar aparecen los porcentajes,
 * quién eligió qué (si la predicción lo permite) y, una vez resuelta, los
 * puntos con su desglose. La entrada usa la gramática de
 * transitions-dev-react-css/page-side-by-side: llega desplazada desde la
 * derecha, porque se entra "hacia adentro" desde el feed.
 */
export function PredictionDetail() {
  const { groupId, isAdmin } = useOutletContext<GroupContext>()
  const { predictionId } = useParams<{ predictionId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const prediction = usePrediction(predictionId, user?.id ?? null)
  const members = useMembers(groupId)
  const castVote = useCastVote(user?.id ?? null)
  const addOption = useAddOption(groupId)
  const cancelPrediction = useCancelPrediction(groupId)

  const [newOption, setNewOption] = useState('')
  const [celebrated, setCelebrated] = useState(false)

  usePredictionRealtime(predictionId, groupId)

  const data = prediction.data
  const status = data ? effectiveStatus(data) : 'proposed'
  const revealed = isRevealed(status)
  const hasVoted = (data?.myVotes.length ?? 0) > 0
  const showResults = data ? canSeeResults(data, status, hasVoted) : false
  const availability = data
    ? voteAvailability(data, data.myVotes)
    : { canVote: false, reason: null as null, nextAt: null }

  const scores = usePredictionScores(predictionId, status === 'resolved')
  const timeline = useVoteTimeline(
    predictionId,
    Boolean(data && data.voting_mode === 'recurring' && showResults),
  )

  const totalVotes = useMemo(
    () =>
      (data?.options ?? []).reduce(
        (sum, option) => sum + (option.tally?.voteCount ?? 0),
        0,
      ),
    [data?.options],
  )

  const myScore = scores.data?.find((score) => score.user_id === user?.id)

  // Celebración: sólo si acertaste, y una sola vez por visita. Se resuelve
  // durante el render en lugar de con un efecto; el disparador pasa de 0 a 1
  // exactamente una vez y no vuelve atrás.
  const shouldCelebrate = status === 'resolved' && myScore?.correct === true
  if (shouldCelebrate && !celebrated) setCelebrated(true)

  if (prediction.isLoading) {
    return (
      <div className="feed-column space-y-4 pt-6" aria-busy="true">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-7 w-[85%]" />
        <Skeleton className="h-7 w-[55%]" />
        <div className="space-y-2 pt-3">
          <Skeleton className="h-12 w-full rounded-[var(--r-sm)]" />
          <Skeleton className="h-12 w-full rounded-[var(--r-sm)]" />
          <Skeleton className="h-12 w-full rounded-[var(--r-sm)]" />
        </div>
      </div>
    )
  }

  if (prediction.isError || !data) {
    return (
      <div className="feed-column pt-10">
        <ErrorState
          title="No encontramos esta predicción"
          body="Puede que la hayan cancelado, o que sea de otro grupo."
          onRetry={() => navigate(`/g/${groupId}`)}
        />
      </div>
    )
  }

  const canPropose = data.created_by === user?.id || isAdmin
  const canCancel =
    status !== 'resolved' &&
    (isAdmin || (data.created_by === user?.id && data.participant_count === 0))

  // Quién votó qué: sólo llega si la RLS lo permitió.
  const votesByOption = new Map<string, string[]>()
  if (revealed && data.votes.length > 0) {
    for (const vote of data.votes) {
      const name =
        members.data?.find((member) => member.user_id === vote.user_id)?.profile
          .display_name ?? 'Alguien'
      const list = votesByOption.get(vote.option_id) ?? []
      if (!list.includes(name)) list.push(name)
      votesByOption.set(vote.option_id, list)
    }
  }

  return (
    <div className="t-page-enter feed-column pt-4" data-direction="forward">
      <ConfettiBurst trigger={celebrated ? 1 : 0} />

      <Link
        to={`/g/${groupId}`}
        className={cn(
          'inline-flex min-h-[var(--tap)] items-center gap-1.5 -ml-2 rounded-[var(--r-sm)] px-2',
          'type-meta text-[var(--ink-3)] hover:text-[var(--ink)]',
          'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
        )}
      >
        <ArrowLeft size={14} weight="bold" aria-hidden="true" />
        Volver al feed
      </Link>

      <article className="relative mt-2 pl-4">
        <span
          className="status-rail"
          style={{ '--rail': STATUS_RAIL[status] } as React.CSSProperties}
          aria-hidden="true"
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <PredictionStatusLabel status={status} />
          {!revealed && status !== 'expired' && (
            <Countdown
              target={data.closes_at}
              prefix="cierra en"
              className="type-meta text-[var(--ink-3)]"
            />
          )}
          {data.voting_mode === 'recurring' && (
            <span className="type-meta inline-flex items-center gap-1 text-[var(--ink-3)]">
              <Repeat size={12} weight="bold" aria-hidden="true" />
              evolutiva
            </span>
          )}
        </div>

        <h1 className="type-title mt-3 text-[1.5rem]">{data.title}</h1>

        {data.description && (
          <p className="mt-2.5 leading-relaxed text-[var(--ink-2)]">{data.description}</p>
        )}

        <p className="mt-4 type-micro text-[var(--ink-3)]">
          {data.author ? `La propuso ${data.author.display_name}` : 'Propuesta del sistema'}
          {' · '}
          {formatRelative(data.created_at)}
          {' · '}
          {revealed ? 'cerró el ' : 'cierra el '}
          {formatDateTime(data.closes_at)}
        </p>

        {/* Opciones */}
        <div
          role="radiogroup"
          aria-label="Opciones"
          className="mt-5 space-y-1.5"
        >
          {data.options.map((option) => (
            <div key={option.id}>
              <VoteOption
                option={option}
                selected={data.myVote?.option_id === option.id}
                disabled={!availability.canVote || castVote.isPending}
                showResults={showResults}
                totalVotes={totalVotes}
                isWinner={data.resolved_option_id === option.id}
                pending={castVote.isPending}
                onSelect={() =>
                  castVote.mutate(
                    { predictionId: data.id, optionId: option.id, groupId },
                    {
                      onError: (error) =>
                        toast.show({
                          message: friendlyError(error, 'No pudimos guardar tu voto.'),
                          tone: 'error',
                        }),
                    },
                  )
                }
              />
              {votesByOption.has(option.id) && (
                <p className="mt-1 pl-3 type-micro text-[var(--ink-3)]">
                  {votesByOption.get(option.id)?.join(', ')}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Estado de participación / voto */}
        <div className="mt-4">
          {status === 'proposed' ? (
            <ParticipationThreshold
              participantCount={data.participant_count}
              minimumParticipants={data.minimum_participants}
              qualified={false}
            />
          ) : status === 'expired' ? (
            <p className="text-[0.875rem] text-[var(--ink-3)]">
              Se venció el plazo sin juntar {data.minimum_participants} personas, así
              que quedó afuera.
            </p>
          ) : availability.reason === 'cycle_used' && availability.nextAt ? (
            <p className="text-[0.875rem] text-[var(--ink-3)]">
              Ya usaste tu voto de esta ronda. Votás de nuevo en{' '}
              {formatCountdown(availability.nextAt)}.
            </p>
          ) : availability.canVote && data.myVote ? (
            <p className="text-[0.875rem] text-[var(--ink-3)]">
              Podés cambiar tu voto hasta el cierre.
            </p>
          ) : !revealed ? (
            <p className="text-[0.875rem] text-[var(--ink-3)]">
              {data.participant_count === 0
                ? 'Todavía nadie se jugó.'
                : `${data.participant_count} ${
                    data.participant_count === 1 ? 'persona ya eligió' : 'personas ya eligieron'
                  }. No se ve qué eligió cada una hasta el cierre.`}
            </p>
          ) : null}
        </div>

        {/* Sumar opción */}
        {data.allow_new_options && availability.canVote && (
          <form
            className="mt-5 flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (!newOption.trim()) return
              addOption.mutate(
                { predictionId: data.id, label: newOption.trim() },
                {
                  onSuccess: () => setNewOption(''),
                  onError: (error) =>
                    toast.show({ message: friendlyError(error), tone: 'error' }),
                },
              )
            }}
          >
            <TextField
              label="Sumar otra opción"
              placeholder="Escribí una alternativa"
              maxLength={60}
              value={newOption}
              onChange={(event) => setNewOption(event.target.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              loading={addOption.isPending}
              disabled={!newOption.trim()}
              iconLeft={<Plus size={16} weight="bold" aria-hidden="true" />}
            >
              Sumar
            </Button>
          </form>
        )}
      </article>

      {/* Evolución */}
      {timeline.data && timeline.data.length > 0 && (
        <div className="mt-8">
          {/* Altura reservada en el fallback: cuando llega el gráfico no empuja
              nada de lo que está abajo. */}
          <Suspense fallback={<div className="h-[260px]" aria-hidden="true" />}>
            <PredictionTimelineChart points={timeline.data} options={data.options} />
          </Suspense>
        </div>
      )}

      {/* Resolución */}
      {(status === 'closed' || status === 'resolving') && (
        <div className="mt-8">
          <ResolutionPanel
            prediction={data}
            groupId={groupId}
            userId={user?.id ?? null}
            canPropose={canPropose}
          />
        </div>
      )}

      {/* Puntos */}
      {status === 'resolved' && (
        <section className="mt-8" aria-labelledby="puntos-titulo">
          <h2
            id="puntos-titulo"
            className="type-meta inline-flex items-center gap-1.5 text-[var(--ink-3)]"
          >
            <Trophy size={13} weight="fill" aria-hidden="true" />
            Cómo quedaron los puntos
          </h2>

          {scores.isLoading ? (
            <div className="mt-3 space-y-2" aria-busy="true">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <ul className="mt-3">
              {(scores.data ?? []).map((score) => (
                <li
                  key={score.user_id}
                  className="flex items-center gap-3 border-t border-[var(--line)] py-3"
                >
                  {score.profile && <Avatar person={score.profile} size="sm" />}
                  <span className="min-w-0 flex-1 truncate text-[0.9375rem]">
                    {score.profile?.display_name ?? 'Alguien'}
                  </span>
                  {score.correct ? (
                    <span className="type-meta text-[var(--status-resolved)]">acertó</span>
                  ) : (
                    <span className="type-meta text-[var(--ink-3)]">no</span>
                  )}
                  <span
                    className={cn(
                      'w-14 text-right font-medium tabular',
                      score.points > 0 ? 'text-[var(--ink)]' : 'text-[var(--ink-3)]',
                    )}
                  >
                    <PopNumber value={score.points} />
                  </span>
                </li>
              ))}
            </ul>
          )}

          {myScore?.correct && (
            <p className="mt-4 rounded-[var(--r-sm)] bg-[var(--accent-wash)] px-3.5 py-3 text-[0.875rem] text-[var(--ink-2)]">
              Tus {myScore.points} puntos salen de{' '}
              {explainScore({
                winnerShare: 0,
                sampleSize: 0,
                earlyRatio: 0,
                convictionRatio: 1,
              }).base}{' '}
              base × {Number(myScore.rarity_multiplier).toFixed(2)} por lo poco
              elegida que estaba × {Number(myScore.early_multiplier).toFixed(2)} por
              haberla elegido temprano
              {Number(myScore.conviction_multiplier) < 1
                ? ` × ${Number(myScore.conviction_multiplier).toFixed(2)} por cuánto la sostuviste`
                : ''}
              .
            </p>
          )}
        </section>
      )}

      {canCancel && (
        <div className="mt-10 border-t border-[var(--line)] pt-5">
          <Button
            variant="danger"
            size="sm"
            loading={cancelPrediction.isPending}
            onClick={() =>
              cancelPrediction.mutate(data.id, {
                onSuccess: () => {
                  toast.show({ message: 'Predicción cancelada.', tone: 'neutral' })
                  navigate(`/g/${groupId}`)
                },
                onError: (error) =>
                  toast.show({ message: friendlyError(error), tone: 'error' }),
              })
            }
          >
            Cancelar esta predicción
          </Button>
          <p className="mt-2 type-micro text-[var(--ink-3)]">
            {data.participant_count > 0
              ? 'Ya hay gente que votó, así que sólo la administración puede cancelarla.'
              : 'Todavía no votó nadie, así que podés darla de baja.'}
          </p>
        </div>
      )}
    </div>
  )
}

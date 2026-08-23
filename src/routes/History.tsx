import { useMemo } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import {
  CheckCircle,
  Lock,
  Prohibit,
  Scales,
  Sparkle,
  UserPlus,
  XCircle,
} from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { useAuth } from '@/auth/useAuth'
import { usePredictions } from '@/data/predictions'
import { useActivity } from '@/data/leaderboard'
import { effectiveStatus } from '@/lib/prediction'
import { formatRelative } from '@/lib/time'
import type { ActivityType } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'

interface GroupContext {
  groupId: string
}

const ACTIVITY_ICON: Record<ActivityType, typeof Sparkle> = {
  member_joined: UserPlus,
  prediction_created: Sparkle,
  prediction_qualified: CheckCircle,
  prediction_expired: XCircle,
  prediction_closed: Lock,
  resolution_proposed: Scales,
  prediction_resolved: CheckCircle,
  prediction_cancelled: Prohibit,
}

function activityText(type: ActivityType, payload: Record<string, unknown>): string {
  const title = typeof payload.title === 'string' ? payload.title : 'una predicción'
  const name = typeof payload.name === 'string' ? payload.name : 'Alguien'
  const option = typeof payload.option === 'string' ? payload.option : null

  switch (type) {
    case 'member_joined':
      return `${name} se sumó al grupo`
    case 'prediction_created':
      return `Nueva predicción: «${title}»`
    case 'prediction_qualified':
      return `«${title}» juntó la gente y quedó`
    case 'prediction_expired':
      return `«${title}» se fue sin juntar gente`
    case 'prediction_closed':
      return `Se cerraron las predicciones de «${title}»`
    case 'resolution_proposed':
      return option
        ? `Propusieron «${option}» como resultado de «${title}»`
        : `Propusieron un resultado para «${title}»`
    case 'prediction_resolved':
      return option ? `«${title}» terminó en «${option}»` : `Se resolvió «${title}»`
    case 'prediction_cancelled':
      return `Cancelaron «${title}»`
  }
}

/**
 * Historial del grupo: predicciones ya terminadas arriba, y debajo el registro
 * de todo lo que fue pasando.
 *
 * Los eventos los escribe la base dentro de las mismas transacciones que hacen
 * los cambios, así que el historial no puede quedar desincronizado de lo que
 * realmente ocurrió.
 */
export function History() {
  const { groupId } = useOutletContext<GroupContext>()
  const { user } = useAuth()
  const predictions = usePredictions(groupId, user?.id ?? null)
  const activity = useActivity(groupId)

  const finished = useMemo(() => {
    return (predictions.data ?? [])
      .filter((prediction) => {
        const status = effectiveStatus(prediction)
        return status === 'resolved' || status === 'expired' || status === 'cancelled'
      })
      .sort(
        (a, b) =>
          new Date(b.resolved_at ?? b.closes_at).getTime() -
          new Date(a.resolved_at ?? a.closes_at).getTime(),
      )
  }, [predictions.data])

  return (
    <div className="feed-column pt-5">
      <h1 className="type-title text-[1.375rem]">Historial</h1>

      <section className="mt-5" aria-labelledby="terminadas-titulo">
        <h2 id="terminadas-titulo" className="type-meta text-[var(--ink-3)]">
          Ya terminadas
        </h2>

        {predictions.isLoading ? (
          <div className="mt-3 space-y-3" aria-busy="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : predictions.isError ? (
          <div className="mt-3">
            <ErrorState onRetry={() => void predictions.refetch()} />
          </div>
        ) : finished.length === 0 ? (
          <EmptyState
            title="Nada terminado todavía"
            body="Cuando cierre y se resuelva la primera predicción, va a quedar acá con su resultado."
          />
        ) : (
          <ul className="mt-2">
            {finished.map((prediction) => {
              const status = effectiveStatus(prediction)
              const winner = prediction.options.find(
                (option) => option.id === prediction.resolved_option_id,
              )

              return (
                <li key={prediction.id}>
                  <Link
                    to={`/g/${groupId}/p/${prediction.id}`}
                    className={cn(
                      'flex items-start gap-3 border-t border-[var(--line)] py-3.5',
                      'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
                      'hover:bg-[var(--surface-2)]',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] leading-snug">
                        {prediction.title}
                      </span>
                      <span className="mt-1 block type-micro text-[var(--ink-3)]">
                        {status === 'resolved' && winner
                          ? `Terminó en «${winner.label}»`
                          : status === 'expired'
                            ? 'No juntó gente'
                            : 'Cancelada'}
                        {' · '}
                        {formatRelative(prediction.resolved_at ?? prediction.closes_at)}
                      </span>
                    </span>
                    {status === 'resolved' && (
                      <CheckCircle
                        size={18}
                        weight="fill"
                        className="mt-0.5 shrink-0 text-[var(--status-resolved)]"
                        aria-hidden="true"
                      />
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="mt-10" aria-labelledby="actividad-titulo">
        <h2 id="actividad-titulo" className="type-meta text-[var(--ink-3)]">
          Todo lo que pasó
        </h2>

        {activity.isLoading ? (
          <div className="mt-3 space-y-2.5" aria-busy="true">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-[80%]" />
            <Skeleton className="h-9 w-[90%]" />
          </div>
        ) : (activity.data ?? []).length === 0 ? (
          <p className="mt-3 text-[0.875rem] text-[var(--ink-3)]">
            Todavía no pasó nada.
          </p>
        ) : (
          <ul className="mt-2">
            {(activity.data ?? []).map((event) => {
              const Icon = ACTIVITY_ICON[event.type]
              return (
                <li
                  key={event.id}
                  className="flex items-start gap-3 border-t border-[var(--line)] py-3"
                >
                  {event.actor ? (
                    <Avatar person={event.actor} size="xs" className="mt-0.5" />
                  ) : (
                    <span
                      className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--ink-3)]"
                      aria-hidden="true"
                    >
                      <Icon size={13} weight="bold" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 text-[0.875rem] leading-snug text-[var(--ink-2)]">
                    {activityText(
                      event.type,
                      (event.payload ?? {}) as Record<string, unknown>,
                    )}
                  </span>
                  <span className="shrink-0 type-micro text-[var(--ink-3)]">
                    {formatRelative(event.created_at)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

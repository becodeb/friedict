import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { useAuth } from '@/auth/useAuth'
import { useLeaderboard, type LeaderboardEntry } from '@/data/leaderboard'
import { Avatar } from '@/components/ui/Avatar'
import { PopNumber } from '@/components/ui/PopNumber'
import { Tabs } from '@/components/ui/Tabs'
import { SkeletonLeaderboard } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'

interface GroupContext {
  groupId: string
}

type Metric = 'total' | 'mes'

function pointsOf(entry: LeaderboardEntry, metric: Metric): number {
  return metric === 'total' ? (entry.points ?? 0) : (entry.points_30d ?? 0)
}

function hitsLine(entry: LeaderboardEntry): string {
  return (entry.resolved_predictions ?? 0) === 0
    ? 'Todavía sin resultados'
    : `${entry.hits} de ${entry.resolved_predictions} acertadas${
        entry.accuracy !== null ? ` · ${entry.accuracy}%` : ''
      }`
}

function personOf(entry: LeaderboardEntry) {
  return {
    id: entry.user_id ?? '',
    display_name: entry.display_name ?? '',
    avatar_seed: entry.avatar_seed,
    accent: entry.accent,
  }
}

/* Escalones del podio: el primero va al medio y más alto. El orden en el DOM
   sigue siendo 1, 2, 3 —eso es lo que lee un lector de pantalla—; la posición
   visual la decide la grilla. */
const STEP: Record<number, { column: string; height: string; tone: string }> = {
  1: { column: 'col-start-2', height: 'pt-10', tone: 'bg-[var(--candy-sun)]' },
  2: { column: 'col-start-1', height: 'pt-8', tone: 'bg-[var(--candy-sky)]' },
  3: { column: 'col-start-3', height: 'pt-7', tone: 'bg-[var(--candy-lime)]' },
}

function PodiumStep({
  entry,
  place,
  isMe,
  metric,
}: {
  entry: LeaderboardEntry
  place: 1 | 2 | 3
  isMe: boolean
  metric: Metric
}) {
  const step = STEP[place]
  if (!step) return null

  return (
    <li
      className={cn(
        'relative row-start-1 rounded-t-[var(--r-md)] rounded-b-[var(--r-xs)] border-2 border-[var(--line-strong)]',
        'px-2 pb-3 text-center text-[var(--on-candy)] shadow-[var(--shadow-2)]',
        step.column,
        step.height,
        step.tone,
      )}
    >
      <Avatar
        person={personOf(entry)}
        size="md"
        className="absolute -top-5 left-1/2 -translate-x-1/2"
      />
      <span className="absolute left-2 top-1.5 font-display text-[0.8125rem] font-extrabold tabular">
        {place}º
      </span>

      <span className="block truncate text-[0.8125rem] font-semibold">
        {entry.display_name}
        {isMe && <span className="ml-1 type-micro">vos</span>}
      </span>
      <span className="mt-0.5 block font-display text-[1.5rem] font-extrabold leading-none tabular">
        <PopNumber value={pointsOf(entry, metric)} />
      </span>
      <span className="type-micro opacity-80">puntos</span>
      <span className="mt-1 block truncate type-micro opacity-80">{hitsLine(entry)}</span>
    </li>
  )
}

/**
 * Ranking del grupo.
 *
 * Los tres primeros suben al podio; el resto sigue en lista. Tres datos y
 * ninguno más: posición, puntos y aciertos. El porcentaje aparece como apoyo,
 * y sólo si hay al menos una predicción resuelta — mostrar "0%" a alguien que
 * todavía no jugó nada es inventar una estadística.
 *
 * Los puntos entran con number-pop-in cuando cambian, así que resolver una
 * predicción se nota también acá.
 */
function LeaderboardRow({
  entry,
  position,
  isMe,
  metric,
}: {
  entry: LeaderboardEntry
  position: number
  isMe: boolean
  metric: Metric
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 border-t-2 border-[var(--line)] py-3.5',
        isMe && '-mx-3 rounded-[var(--r-md)] border-t-0 bg-[var(--accent-wash)] px-3',
      )}
    >
      <span className="w-7 shrink-0 text-center font-display text-[0.9375rem] font-extrabold tabular text-[var(--ink-3)]">
        {position}
      </span>

      <Avatar person={personOf(entry)} size="md" />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-semibold">
          {entry.display_name}
          {isMe && <span className="ml-1.5 type-micro text-[var(--ink-3)]">vos</span>}
        </span>
        <span className="type-micro text-[var(--ink-3)]">{hitsLine(entry)}</span>
      </span>

      <span className="shrink-0 text-right">
        <span className="block font-display text-[1.25rem] font-extrabold leading-none tabular">
          <PopNumber value={pointsOf(entry, metric)} />
        </span>
        <span className="type-micro text-[var(--ink-3)]">puntos</span>
      </span>
    </li>
  )
}

export function Leaderboard() {
  const { groupId } = useOutletContext<GroupContext>()
  const { user } = useAuth()
  const leaderboard = useLeaderboard(groupId)
  const [metric, setMetric] = useState<Metric>('total')

  const entries = leaderboard.data ?? []
  const sorted =
    metric === 'total'
      ? entries
      : [...entries].sort((a, b) => (b.points_30d ?? 0) - (a.points_30d ?? 0))

  const nobodyScored = entries.every((entry) => (entry.resolved_predictions ?? 0) === 0)
  const podium = sorted.slice(0, 3)
  const rest = sorted.slice(3)

  return (
    <div className="feed-column pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="type-title text-[1.5rem]">Ranking</h1>
        {!nobodyScored && (
          <Tabs
            label="Período del ranking"
            value={metric}
            onChange={setMetric}
            items={[
              { value: 'total', label: 'Siempre' },
              { value: 'mes', label: '30 días' },
            ]}
          />
        )}
      </div>

      <div className="mt-4">
        {leaderboard.isLoading ? (
          <SkeletonLeaderboard />
        ) : leaderboard.isError ? (
          <ErrorState onRetry={() => void leaderboard.refetch()} />
        ) : nobodyScored ? (
          <EmptyState
            title="Todavía no hay puntos"
            body="Los puntos aparecen cuando se resuelve la primera predicción. Se ganan acertando, nunca se pierden."
          />
        ) : (
          <>
            <ol className="mt-8 grid grid-cols-3 items-end gap-3" aria-label="Podio">
              {podium.map((entry, index) => (
                <PodiumStep
                  key={entry.user_id}
                  entry={entry}
                  place={(index + 1) as 1 | 2 | 3}
                  isMe={entry.user_id === user?.id}
                  metric={metric}
                />
              ))}
            </ol>

            {rest.length > 0 && (
              <ol className="mt-6" start={4} aria-label="Resto del ranking">
                {rest.map((entry, index) => (
                  <LeaderboardRow
                    key={entry.user_id}
                    entry={entry}
                    position={index + 4}
                    isMe={entry.user_id === user?.id}
                    metric={metric}
                  />
                ))}
              </ol>
            )}
          </>
        )}
      </div>

      {!nobodyScored && (
        <section className="card-pop mt-10 px-5 py-5">
          <h2 className="type-meta text-[var(--ink-3)]">Cómo se calculan</h2>
          <p className="mt-2.5 max-w-[46ch] text-[0.875rem] leading-relaxed text-[var(--ink-2)]">
            100 puntos base por acertar. Hasta un 80% más si elegiste la opción
            que casi nadie eligió, y hasta un 25% más si la elegiste temprano. En
            las evolutivas cuenta además cuánto la sostuviste. Los puntos no se
            apuestan ni se pierden: sólo se suman.
          </p>
        </section>
      )}
    </div>
  )
}

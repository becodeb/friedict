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

/**
 * Ranking del grupo.
 *
 * Tres datos y ninguno más: posición, puntos y aciertos. El porcentaje aparece
 * como apoyo, y sólo si hay al menos una predicción resuelta — mostrar "0%" a
 * alguien que todavía no jugó nada es inventar una estadística.
 *
 * Los puntos entran con number-pop-in cuando cambian, así que resolver una
 * predicción se nota también acá.
 */
function LeaderboardRow({
  entry,
  isMe,
  metric,
}: {
  entry: LeaderboardEntry
  isMe: boolean
  metric: 'total' | 'mes'
}) {
  const points = metric === 'total' ? (entry.points ?? 0) : (entry.points_30d ?? 0)

  return (
    <li
      className={cn(
        'flex items-center gap-3 border-t border-[var(--line)] py-3.5',
        isMe && 'bg-[var(--accent-wash)]',
      )}
    >
      <span
        className={cn(
          'w-6 shrink-0 text-center type-meta tabular',
          (entry.position ?? 0) <= 3 ? 'text-[var(--ink)]' : 'text-[var(--ink-3)]',
        )}
      >
        {entry.position}
      </span>

      <Avatar
        person={{
          id: entry.user_id ?? '',
          display_name: entry.display_name ?? '',
          avatar_seed: entry.avatar_seed,
          accent: entry.accent,
        }}
        size="md"
      />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-medium">
          {entry.display_name}
          {isMe && <span className="ml-1.5 type-micro text-[var(--ink-3)]">vos</span>}
        </span>
        <span className="type-micro text-[var(--ink-3)]">
          {(entry.resolved_predictions ?? 0) === 0
            ? 'Todavía sin resultados'
            : `${entry.hits} de ${entry.resolved_predictions} acertadas${
                entry.accuracy !== null ? ` · ${entry.accuracy}%` : ''
              }`}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span className="block text-[1.0625rem] font-semibold tabular">
          <PopNumber value={points} />
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
  const [metric, setMetric] = useState<'total' | 'mes'>('total')

  const entries = leaderboard.data ?? []
  const sorted =
    metric === 'total'
      ? entries
      : [...entries].sort((a, b) => (b.points_30d ?? 0) - (a.points_30d ?? 0))

  const nobodyScored = entries.every((entry) => (entry.resolved_predictions ?? 0) === 0)

  return (
    <div className="feed-column pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="type-title text-[1.375rem]">Ranking</h1>
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
          <ul>
            {sorted.map((entry) => (
              <LeaderboardRow
                key={entry.user_id}
                entry={entry}
                isMe={entry.user_id === user?.id}
                metric={metric}
              />
            ))}
          </ul>
        )}
      </div>

      {!nobodyScored && (
        <section className="mt-10 border-t border-[var(--line)] pt-5">
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

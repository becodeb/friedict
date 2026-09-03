import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import { qk } from './keys'
import type { ActivityEvent, LeaderboardRowData, Profile } from '@/lib/types'

export interface LeaderboardEntry extends LeaderboardRowData {
  accuracy: number | null
}

export function useLeaderboard(groupId: string | undefined) {
  return useQuery({
    queryKey: qk.leaderboard(groupId ?? ''),
    enabled: Boolean(groupId),
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const rows = await apiGet<LeaderboardRowData[]>(`/groups/${groupId!}/leaderboard`)
      return rows.map((row) => ({
        ...row,
        // Sin predicciones resueltas no hay porcentaje. Mostrar "0%" sería
        // inventar un dato que todavía no existe.
        accuracy:
          row.resolved_predictions && row.resolved_predictions > 0
            ? Math.round(((row.hits ?? 0) / row.resolved_predictions) * 100)
            : null,
      }))
    },
    staleTime: 30_000,
  })
}

export interface ActivityWithActor extends ActivityEvent {
  actor: Pick<Profile, 'id' | 'display_name' | 'avatar_seed' | 'accent'> | null
}

export function useActivity(groupId: string | undefined, limit = 40) {
  return useQuery({
    queryKey: qk.activity(groupId ?? ''),
    enabled: Boolean(groupId),
    queryFn: () =>
      apiGet<ActivityWithActor[]>(`/groups/${groupId!}/activity?limit=${limit}`),
    staleTime: 20_000,
  })
}

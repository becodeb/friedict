import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, rpc } from '@/lib/api'
import { qk } from './keys'
import type {
  CastVoteResult,
  ConfirmResolutionResult,
  OptionWithTally,
  Prediction,
  PredictionOption,
  PredictionRow,
  PredictionTemplate,
  Resolution,
  ResolutionConfirmation,
  TimelinePoint,
  Vote,
} from '@/lib/types'

/**
 * La forma en que el servidor devuelve una predicción: la fila más las
 * opciones (con su recuento), los votos visibles y el autor, todo armado con
 * agregación JSON en una sola consulta.
 *
 * `tally` llega en null cuando `results_visibility` todavía no deja verlo, y
 * `votes` trae sólo lo que la RLS permitió. Eso lo decide la base, no el
 * servidor: acá nunca aparece nada que no se pueda ver.
 */
interface RawPrediction extends PredictionRow {
  options: Array<
    PredictionOption & {
      tally: { vote_count: number; voter_count: number } | null
    }
  >
  votes: Vote[]
  author: Prediction['author']
}

/**
 * Normaliza lo que devuelve la API.
 *
 * `votes` no es "mis votos": es lo que la RLS me dejó ver. Con la predicción
 * abierta eso son exactamente mis votos; después del cierre son todos. Por eso
 * `myVotes` se filtra por usuario acá y no se asume nada del backend.
 */
function mapPrediction(raw: RawPrediction, userId: string | null): Prediction {
  const options: OptionWithTally[] = [...raw.options]
    .sort((a, b) => a.position - b.position)
    .map(({ tally, ...option }) => ({
      ...option,
      tally: tally ? { voteCount: tally.vote_count, voterCount: tally.voter_count } : null,
    }))

  const myVotes = userId
    ? raw.votes.filter((v) => v.user_id === userId).sort((a, b) => a.cycle - b.cycle)
    : []

  return {
    ...raw,
    options,
    votes: raw.votes,
    myVotes,
    myVote: myVotes.length > 0 ? (myVotes[myVotes.length - 1] ?? null) : null,
    author: raw.author,
  } as Prediction
}

export function usePredictions(groupId: string | undefined, userId: string | null) {
  return useQuery({
    queryKey: qk.predictions(groupId ?? ''),
    enabled: Boolean(groupId),
    queryFn: async (): Promise<Prediction[]> => {
      // Tercera vía de la expiración: además del intervalo del servidor y de
      // las validaciones en cast_vote, abrir el feed reevalúa los estados por
      // tiempo. Es idempotente y barato, y garantiza que nunca se vea una
      // predicción vencida como viva.
      await rpc<number>('finalize_predictions', { p_group_id: groupId! })

      const rows = await apiGet<RawPrediction[]>(`/groups/${groupId!}/predictions`)
      return rows.map((row) => mapPrediction(row, userId))
    },
    staleTime: 15_000,
  })
}

export function usePrediction(predictionId: string | undefined, userId: string | null) {
  return useQuery({
    queryKey: qk.prediction(predictionId ?? ''),
    enabled: Boolean(predictionId),
    queryFn: async (): Promise<Prediction> => {
      const raw = await apiGet<RawPrediction>(`/predictions/${predictionId!}`)
      return mapPrediction(raw, userId)
    },
    staleTime: 10_000,
  })
}

export function useTemplates() {
  return useQuery({
    queryKey: qk.templates(),
    queryFn: () => apiGet<PredictionTemplate[]>('/templates'),
    staleTime: 10 * 60_000,
  })
}

// ---------------------------------------------------------------------------
// Votar
// ---------------------------------------------------------------------------

interface CastVoteVars {
  predictionId: string
  optionId: string
  groupId: string
}

/**
 * Votar tiene que sentirse instantáneo, así que la UI se adelanta. Pero el
 * servidor manda: si rechaza (cerró, ya usaste el voto del ciclo), se revierte
 * el snapshot completo y se refresca contra la base. Nunca queda en pantalla un
 * voto que el backend no aceptó.
 */
export function useCastVote(userId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ predictionId, optionId }: CastVoteVars) =>
      rpc<CastVoteResult>('cast_vote', {
        p_prediction_id: predictionId,
        p_option_id: optionId,
      }),

    onMutate: async ({ predictionId, optionId, groupId }) => {
      await queryClient.cancelQueries({ queryKey: qk.predictions(groupId) })
      await queryClient.cancelQueries({ queryKey: qk.prediction(predictionId) })

      const previousList = queryClient.getQueryData<Prediction[]>(qk.predictions(groupId))
      const previousOne = queryClient.getQueryData<Prediction>(qk.prediction(predictionId))

      const patch = (prediction: Prediction): Prediction => {
        if (prediction.id !== predictionId || !userId) return prediction

        const alreadyVoted = prediction.myVote !== null
        const optimisticVote: Vote = {
          id: `optimistic-${optionId}`,
          prediction_id: predictionId,
          option_id: optionId,
          user_id: userId,
          cycle: prediction.myVote?.cycle ?? 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

        const isSingle = prediction.voting_mode === 'single'
        const myVotes = isSingle ? [optimisticVote] : [...prediction.myVotes, optimisticVote]

        return {
          ...prediction,
          myVote: optimisticVote,
          myVotes,
          // Sólo sube el contador de participantes si es tu primer voto.
          participant_count: alreadyVoted
            ? prediction.participant_count
            : prediction.participant_count + 1,
          vote_count:
            isSingle && alreadyVoted ? prediction.vote_count : prediction.vote_count + 1,
          options: prediction.options.map((option) => {
            // Los recuentos ocultos siguen ocultos: no se inventa un número que
            // la persona no tiene derecho a ver.
            if (!option.tally) return option
            const gained = option.id === optionId
            const lost = isSingle && prediction.myVote?.option_id === option.id && !gained
            if (!gained && !lost) return option
            return {
              ...option,
              tally: {
                voteCount: Math.max(0, option.tally.voteCount + (gained ? 1 : -1)),
                voterCount: Math.max(0, option.tally.voterCount + (gained ? 1 : -1)),
              },
            }
          }),
        }
      }

      if (previousList) {
        queryClient.setQueryData<Prediction[]>(
          qk.predictions(groupId),
          previousList.map(patch),
        )
      }
      if (previousOne) {
        queryClient.setQueryData<Prediction>(qk.prediction(predictionId), patch(previousOne))
      }

      return { previousList, previousOne }
    },

    onError: (_error, { predictionId, groupId }, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(qk.predictions(groupId), context.previousList)
      }
      if (context?.previousOne) {
        queryClient.setQueryData(qk.prediction(predictionId), context.previousOne)
      }
    },

    onSettled: (_data, _error, { predictionId, groupId }) => {
      void queryClient.invalidateQueries({ queryKey: qk.predictions(groupId) })
      void queryClient.invalidateQueries({ queryKey: qk.prediction(predictionId) })
      void queryClient.invalidateQueries({ queryKey: qk.timeline(predictionId) })
    },
  })
}

// ---------------------------------------------------------------------------
// Crear
// ---------------------------------------------------------------------------

export interface CreatePredictionVars {
  groupId: string
  title: string
  description?: string | undefined
  options: string[]
  optionType: 'manual' | 'members' | 'open'
  votingMode: 'single' | 'recurring'
  intervalDays?: number | undefined
  allowNewOptions: boolean
  resultsVisibility: 'always' | 'after_vote' | 'on_close'
  votesVisibility: 'visible' | 'on_close' | 'anonymous'
  closesAt: string
  qualificationHours: number
}

export function useCreatePrediction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: CreatePredictionVars) =>
      // Los parámetros opcionales se OMITEN en lugar de mandarse en null: así
      // toma el default declarado en la función SQL y no hay dos fuentes de
      // verdad para el mismo valor.
      rpc<string>('create_prediction', {
        p_group_id: vars.groupId,
        p_title: vars.title,
        p_options: vars.optionType === 'members' ? [] : vars.options,
        p_closes_at: vars.closesAt,
        p_option_type: vars.optionType,
        p_voting_mode: vars.votingMode,
        p_allow_new_options: vars.allowNewOptions,
        p_results_visibility: vars.resultsVisibility,
        p_votes_visibility: vars.votesVisibility,
        p_minimum_participants: 3,
        p_qualification_hours: vars.qualificationHours,
        ...(vars.description ? { p_description: vars.description } : {}),
        ...(vars.votingMode === 'recurring'
          ? { p_vote_interval: `${vars.intervalDays ?? 7} days` }
          : {}),
      }),
    onSuccess: (_id, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.predictions(vars.groupId) })
      void queryClient.invalidateQueries({ queryKey: qk.activity(vars.groupId) })
    },
  })
}

export function useCreateFromTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { groupId: string; templateId: string; closesAt: string }) =>
      rpc<string>('create_prediction_from_template', {
        p_group_id: vars.groupId,
        p_template_id: vars.templateId,
        p_closes_at: vars.closesAt,
        p_qualification_hours: 48,
      }),
    onSuccess: (_id, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.predictions(vars.groupId) })
      void queryClient.invalidateQueries({ queryKey: qk.activity(vars.groupId) })
    },
  })
}

export function useAddOption(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { predictionId: string; label: string }) =>
      rpc<PredictionOption>('add_prediction_option', {
        p_prediction_id: vars.predictionId,
        p_label: vars.label,
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.prediction(vars.predictionId) })
      void queryClient.invalidateQueries({ queryKey: qk.predictions(groupId) })
    },
  })
}

export function useCancelPrediction(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (predictionId: string) =>
      rpc<void>('cancel_prediction', { p_prediction_id: predictionId }),
    onSuccess: (_data, predictionId) => {
      void queryClient.invalidateQueries({ queryKey: qk.prediction(predictionId) })
      void queryClient.invalidateQueries({ queryKey: qk.predictions(groupId) })
    },
  })
}

// ---------------------------------------------------------------------------
// Resolución
// ---------------------------------------------------------------------------

export interface ResolutionWithConfirmations extends Resolution {
  confirmations: ResolutionConfirmation[]
}

export function useResolution(predictionId: string | undefined) {
  return useQuery({
    queryKey: qk.resolution(predictionId ?? ''),
    enabled: Boolean(predictionId),
    queryFn: () =>
      apiGet<ResolutionWithConfirmations | null>(`/predictions/${predictionId!}/resolution`),
    staleTime: 10_000,
  })
}

export function useProposeResolution(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { predictionId: string; optionId: string }) =>
      rpc<string>('propose_resolution', {
        p_prediction_id: vars.predictionId,
        p_option_id: vars.optionId,
      }),
    onSuccess: (_id, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.resolution(vars.predictionId) })
      void queryClient.invalidateQueries({ queryKey: qk.prediction(vars.predictionId) })
      void queryClient.invalidateQueries({ queryKey: qk.predictions(groupId) })
    },
  })
}

export function useConfirmResolution(groupId: string, predictionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { resolutionId: string; agrees: boolean }) =>
      rpc<ConfirmResolutionResult>('confirm_resolution', {
        p_resolution_id: vars.resolutionId,
        p_agrees: vars.agrees,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.resolution(predictionId) })
      void queryClient.invalidateQueries({ queryKey: qk.prediction(predictionId) })
      void queryClient.invalidateQueries({ queryKey: qk.predictions(groupId) })
      void queryClient.invalidateQueries({ queryKey: qk.leaderboard(groupId) })
      void queryClient.invalidateQueries({ queryKey: qk.activity(groupId) })
    },
  })
}

export interface PredictionScoreRow {
  user_id: string
  points: number
  correct: boolean
  rarity_multiplier: number
  early_multiplier: number
  conviction_multiplier: number
  profile: { id: string; display_name: string; avatar_seed: string; accent: number } | null
}

export function usePredictionScores(predictionId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.scores(predictionId ?? ''),
    enabled: Boolean(predictionId) && enabled,
    queryFn: () => apiGet<PredictionScoreRow[]>(`/predictions/${predictionId!}/scores`),
    staleTime: 60_000,
  })
}

// ---------------------------------------------------------------------------
// Evolución temporal
// ---------------------------------------------------------------------------

export function useVoteTimeline(predictionId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.timeline(predictionId ?? ''),
    enabled: Boolean(predictionId) && enabled,
    queryFn: () => rpc<TimelinePoint[]>('vote_timeline', { p_prediction_id: predictionId! }),
    staleTime: 30_000,
    retry: false,
  })
}

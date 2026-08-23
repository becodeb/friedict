import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from './keys'
import type {
  CastVoteResult,
  ConfirmResolutionResult,
  OptionWithTally,
  Prediction,
  PredictionTemplate,
  Resolution,
  ResolutionConfirmation,
  TimelinePoint,
  Vote,
} from '@/lib/types'
import type { Database } from '@/lib/database.types'

/**
 * `predictions` y `prediction_options` están unidas por DOS claves foráneas
 * (la opción pertenece a la predicción, y la predicción apunta a la opción
 * ganadora). PostgREST no puede adivinar cuál usar, así que cada embed nombra
 * su constraint explícitamente.
 */
const PREDICTION_SELECT = `
  *,
  options:prediction_options!prediction_options_prediction_id_fkey(
    id, prediction_id, label, position, member_id, created_by, created_at,
    tally:prediction_option_tallies(vote_count, voter_count)
  ),
  votes:prediction_votes(id, prediction_id, option_id, user_id, cycle, created_at, updated_at),
  author:profiles!predictions_created_by_fkey(id, display_name, avatar_seed, accent)
` as const

type RawPrediction = Database['public']['Tables']['predictions']['Row'] & {
  options: Array<
    Database['public']['Tables']['prediction_options']['Row'] & {
      tally: { vote_count: number; voter_count: number } | null
    }
  >
  votes: Vote[]
  author: Prediction['author']
}

/**
 * Normaliza lo que devuelve PostgREST.
 *
 * `votes` no es "mis votos": es lo que la RLS me deja ver. Con la predicción
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
    ? raw.votes
        .filter((v) => v.user_id === userId)
        .sort((a, b) => a.cycle - b.cycle)
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
      // Tercera vía de la expiración: además del cron y de las validaciones en
      // cast_vote, abrir el feed reevalúa los estados por tiempo. Es idempotente
      // y barato, y garantiza que nunca se vea una predicción vencida como viva.
      await supabase.rpc('finalize_predictions', { p_group_id: groupId! })

      const { data, error } = await supabase
        .from('predictions')
        .select(PREDICTION_SELECT)
        .eq('group_id', groupId!)
        .order('created_at', { ascending: false })
      if (error) throw error

      return (data as unknown as RawPrediction[]).map((row) => mapPrediction(row, userId))
    },
    staleTime: 15_000,
  })
}

export function usePrediction(predictionId: string | undefined, userId: string | null) {
  return useQuery({
    queryKey: qk.prediction(predictionId ?? ''),
    enabled: Boolean(predictionId),
    queryFn: async (): Promise<Prediction> => {
      const { data, error } = await supabase
        .from('predictions')
        .select(PREDICTION_SELECT)
        .eq('id', predictionId!)
        .single()
      if (error) throw error
      return mapPrediction(data as unknown as RawPrediction, userId)
    },
    staleTime: 10_000,
  })
}

export function useTemplates() {
  return useQuery({
    queryKey: qk.templates(),
    queryFn: async (): Promise<PredictionTemplate[]> => {
      const { data, error } = await supabase
        .from('prediction_templates')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return data ?? []
    },
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
    mutationFn: async ({ predictionId, optionId }: CastVoteVars) => {
      const { data, error } = await supabase.rpc('cast_vote', {
        p_prediction_id: predictionId,
        p_option_id: optionId,
      })
      if (error) throw error
      return data as unknown as CastVoteResult
    },

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
          vote_count: isSingle && alreadyVoted
            ? prediction.vote_count
            : prediction.vote_count + 1,
          options: prediction.options.map((option) => {
            // Los recuentos ocultos siguen ocultos: no se inventa un número que
            // la persona no tiene derecho a ver.
            if (!option.tally) return option
            const gained = option.id === optionId
            const lost =
              isSingle && prediction.myVote?.option_id === option.id && !gained
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
    mutationFn: async (vars: CreatePredictionVars): Promise<string> => {
      // Los parámetros opcionales se OMITEN en lugar de mandarse en null: así
      // toma el default declarado en la función SQL y no hay dos fuentes de
      // verdad para el mismo valor.
      const { data, error } = await supabase.rpc('create_prediction', {
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
      })
      if (error) throw error
      return data as unknown as string
    },
    onSuccess: (_id, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.predictions(vars.groupId) })
      void queryClient.invalidateQueries({ queryKey: qk.activity(vars.groupId) })
    },
  })
}

export function useCreateFromTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      groupId: string
      templateId: string
      closesAt: string
    }): Promise<string> => {
      const { data, error } = await supabase.rpc('create_prediction_from_template', {
        p_group_id: vars.groupId,
        p_template_id: vars.templateId,
        p_closes_at: vars.closesAt,
        p_qualification_hours: 48,
      })
      if (error) throw error
      return data as unknown as string
    },
    onSuccess: (_id, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.predictions(vars.groupId) })
      void queryClient.invalidateQueries({ queryKey: qk.activity(vars.groupId) })
    },
  })
}

export function useAddOption(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { predictionId: string; label: string }) => {
      const { error } = await supabase.rpc('add_prediction_option', {
        p_prediction_id: vars.predictionId,
        p_label: vars.label,
      })
      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: qk.prediction(vars.predictionId) })
      void queryClient.invalidateQueries({ queryKey: qk.predictions(groupId) })
    },
  })
}

export function useCancelPrediction(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (predictionId: string) => {
      const { error } = await supabase.rpc('cancel_prediction', {
        p_prediction_id: predictionId,
      })
      if (error) throw error
    },
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
    queryFn: async (): Promise<ResolutionWithConfirmations | null> => {
      const { data, error } = await supabase
        .from('prediction_resolutions')
        .select('*, confirmations:resolution_confirmations(*)')
        .eq('prediction_id', predictionId!)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return (data?.[0] as unknown as ResolutionWithConfirmations) ?? null
    },
    staleTime: 10_000,
  })
}

export function useProposeResolution(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { predictionId: string; optionId: string }) => {
      const { data, error } = await supabase.rpc('propose_resolution', {
        p_prediction_id: vars.predictionId,
        p_option_id: vars.optionId,
      })
      if (error) throw error
      return data as unknown as string
    },
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
    mutationFn: async (vars: { resolutionId: string; agrees: boolean }) => {
      const { data, error } = await supabase.rpc('confirm_resolution', {
        p_resolution_id: vars.resolutionId,
        p_agrees: vars.agrees,
      })
      if (error) throw error
      return data as unknown as ConfirmResolutionResult
    },
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
    queryFn: async (): Promise<PredictionScoreRow[]> => {
      const { data, error } = await supabase
        .from('prediction_scores')
        .select(
          'user_id, points, correct, rarity_multiplier, early_multiplier, conviction_multiplier, profile:profiles(id, display_name, avatar_seed, accent)',
        )
        .eq('prediction_id', predictionId!)
        .order('points', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as PredictionScoreRow[]
    },
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
    queryFn: async (): Promise<TimelinePoint[]> => {
      const { data, error } = await supabase.rpc('vote_timeline', {
        p_prediction_id: predictionId!,
      })
      if (error) throw error
      return (data ?? []) as unknown as TimelinePoint[]
    },
    staleTime: 30_000,
    retry: false,
  })
}

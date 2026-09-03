import type { Database, Tables, Enums } from './database.types'

export type { Database }

export type Profile = Tables<'profiles'>
export type Group = Tables<'groups'>
export type GroupMember = Tables<'group_members'>
export type GroupInvite = Tables<'group_invites'>
export type PredictionRow = Tables<'predictions'>
export type PredictionOption = Tables<'prediction_options'>
export type OptionTally = Tables<'prediction_option_tallies'>
export type Vote = Tables<'prediction_votes'>
export type Resolution = Tables<'prediction_resolutions'>
export type ResolutionConfirmation = Tables<'resolution_confirmations'>
export type PredictionTemplate = Tables<'prediction_templates'>
export type ActivityEvent = Tables<'activity_events'>
export type LeaderboardRowData = Tables<'group_leaderboard'>

export type MemberRole = Enums<'member_role'>
export type PredictionStatus = Enums<'prediction_status'>
export type OptionSource = Enums<'option_source'>
export type VotingMode = Enums<'voting_mode'>
export type ResultsVisibility = Enums<'results_visibility'>
export type VotesVisibility = Enums<'votes_visibility'>
export type ActivityType = Enums<'activity_type'>
export type ResolutionStatus = Enums<'resolution_status'>

/** Miembro con su perfil resuelto. */
export interface MemberWithProfile extends GroupMember {
  profile: Profile
}

/** Opción con su recuento, cuando la visibilidad permite verlo. */
export interface OptionWithTally extends PredictionOption {
  /** `null` cuando la predicción todavía oculta los resultados. */
  tally: { voteCount: number; voterCount: number } | null
}

/** Una predicción con todo lo que la tarjeta del feed necesita. */
export interface Prediction extends PredictionRow {
  options: OptionWithTally[]
  /**
   * Los votos que la RLS dejó leer. Con la predicción abierta son exactamente
   * los propios; después del cierre, todos (si `votes_visibility` lo permite).
   */
  votes: Vote[]
  /** Último voto propio. Los votos ajenos no viajan hasta el cierre. */
  myVote: Vote | null
  /** Todos mis votos, para predicciones evolutivas. */
  myVotes: Vote[]
  author: Pick<Profile, 'id' | 'display_name' | 'avatar_seed' | 'accent'> | null
  /**
   * Derivados, calculados del lado del servidor: el cliente no conoce el
   * tamaño real del grupo, así que nunca los computa — sólo los muestra.
   */
  /** Integrantes vivos del grupo en este momento. */
  member_count: number
  /** Cuántos hacen falta para calificar, ya acotado a member_count. */
  required_participants: number
  /** Cuántos pedidos de cierre hacen falta para cerrar sin fecha. */
  close_required: number
  /** ¿Quien consulta ya pidió el cierre de esta predicción? */
  my_close_request: boolean
}

export interface InvitePreview {
  valid: boolean
  group_id?: string
  group_name?: string
  member_count?: number
  already_member?: boolean
}

export interface CastVoteResult {
  status: PredictionStatus
  participant_count: number
  vote_count: number
  cycle: number
  next_cycle_at: string | null
}

export interface ConfirmResolutionResult {
  outcome: 'resolved' | 'rejected' | 'pending'
  agree: number
  against: number
}

export interface TimelinePoint {
  cycle: number
  bucket_at: string
  option_id: string
  votes: number
}

/**
 * Reglas de predicción del lado del cliente.
 *
 * Todo esto es un ESPEJO de lo que hace la base (`finalize_predictions`,
 * `cast_vote`, `current_cycle`). Existe por dos razones:
 *   1. que la UI muestre el estado correcto entre dos corridas del cron;
 *   2. poder deshabilitar controles antes de mandar una operación que el
 *      servidor iba a rechazar igual.
 *
 * Nunca es la autoridad. Si esta función dice que se puede votar y el servidor
 * dice que no, gana el servidor y la UI hace rollback.
 */

import type { Prediction, PredictionStatus, PredictionRow, Vote } from './types'
import { DAY, HOUR, MINUTE, parsePgInterval, toDate } from './time'

/** ¿La predicción juntó la participación que necesitaba? */
export function hasQualified(
  participantCount: number,
  minimumParticipants: number,
  isDefault: boolean,
): boolean {
  if (isDefault) return true
  return participantCount >= minimumParticipants
}

/** Cuánta gente falta para que la predicción quede. Nunca negativo. */
export function participantsMissing(
  participantCount: number,
  minimumParticipants: number,
): number {
  return Math.max(0, minimumParticipants - participantCount)
}

/**
 * `required_participants` es OBLIGATORIO, no opcional con un fallback a un
 * mínimo fijo: un fallback reintroduciría en silencio el bug de los grupos
 * chicos en cualquier payload que se olvide de mandarlo. TypeScript obliga a
 * que todo call site lo provea. Cuando el grupo no pide calificar,
 * `required_participants` llega en 0 (ver `PREDICTION_SELECT` y
 * `notify_change()`), así que `hasQualified` siempre da `true`.
 *
 * `qualification_deadline` NO está acá: nada expira más, así que
 * `effectiveStatus` no tiene ninguna razón para leerla.
 */
export type StatusInput = Pick<
  PredictionRow,
  'status' | 'is_default' | 'participant_count' | 'closes_at'
> & { required_participants: number }

/** `closes_at` nulo = sin cierre por fecha: se trata como "infinitamente lejos". */
function closesAtMs(prediction: Pick<StatusInput, 'closes_at'>): number {
  return prediction.closes_at === null
    ? Number.POSITIVE_INFINITY
    : toDate(prediction.closes_at).getTime()
}

/**
 * Estado efectivo en este instante. Mismo orden de evaluación que
 * `public.finalize_predictions()`.
 *
 * Nada expira más: una fila que YA está `expired` (de antes de este cambio)
 * se queda `expired` para siempre — es un estado terminal, igual que
 * `resolved`/`cancelled` — pero ninguna fila `proposed` puede aterrizar ahí.
 * `finalize_predictions()` del lado del servidor perdió el paso entero que lo
 * hacía; este espejo pierde la rama que lo leía.
 */
export function effectiveStatus(
  prediction: StatusInput,
  now: Date = new Date(),
): PredictionStatus {
  const { status } = prediction

  // Los estados terminales no se recalculan.
  if (
    status === 'resolved' ||
    status === 'expired' ||
    status === 'cancelled' ||
    status === 'resolving'
  ) {
    return status
  }

  const qualified = hasQualified(
    prediction.participant_count,
    prediction.required_participants,
    prediction.is_default,
  )
  const closesMs = closesAtMs(prediction)

  if (status === 'proposed') {
    // Juntó la gente (o el grupo no pide calificar, reflejado en un
    // required_participants de 0).
    if (qualified) {
      return closesMs <= now.getTime() ? 'closed' : 'active'
    }
    // Sigue en prueba: sin plazo que vencer, esto ya no tiene más salida que
    // "activa" (cuando califique) o "cerrada" (si tiene fecha y llegó).
    return closesMs <= now.getTime() ? 'closed' : 'proposed'
  }

  // Llegó el cierre. Sin closes_at (Infinity), esta rama nunca dispara: una
  // predicción abierta jamás cierra sola por fecha, a ningún `now`.
  if (status === 'active' && closesMs <= now.getTime()) {
    return 'closed'
  }

  return status
}

export function isOpenForVoting(prediction: StatusInput, now: Date = new Date()): boolean {
  const status = effectiveStatus(prediction, now)
  return (status === 'proposed' || status === 'active') && closesAtMs(prediction) > now.getTime()
}

export function isRevealed(status: PredictionStatus): boolean {
  return status === 'closed' || status === 'resolving' || status === 'resolved'
}

/**
 * ¿Se pueden ver los recuentos por opción?
 * Refleja la política RLS de `prediction_option_tallies`. La UI lo usa para
 * decidir qué dibujar; la base lo usa para decidir qué mandar.
 */
export function canSeeResults(
  prediction: Pick<PredictionRow, 'results_visibility'>,
  status: PredictionStatus,
  hasVoted: boolean,
): boolean {
  if (isRevealed(status)) return true
  if (prediction.results_visibility === 'always') return true
  if (prediction.results_visibility === 'after_vote') return hasVoted
  return false
}

/**
 * ¿Se puede ver QUIÉN votó qué? Refleja la política RLS de `prediction_votes`
 * (`can_see_votes` en `300_rls.sql`). `visible` siempre; `anonymous` nunca;
 * `on_close` recién al revelarse. Antes de esta función, `votes_visibility
 * = 'visible'` no tenía ningún efecto observable: el cliente sólo miraba
 * `revealed`, así que nunca mostraba los nombres antes del cierre aunque la
 * base ya los dejara pasar.
 */
export function canSeeVotes(
  prediction: Pick<PredictionRow, 'votes_visibility'>,
  status: PredictionStatus,
): boolean {
  if (prediction.votes_visibility === 'anonymous') return false
  if (prediction.votes_visibility === 'visible') return true
  return isRevealed(status)
}

// ---------------------------------------------------------------------------
// Ciclos (predicciones evolutivas)
// ---------------------------------------------------------------------------

/** Espejo de `public.current_cycle()`. */
export function currentCycle(
  opensAt: string | Date,
  voteInterval: string | null,
  at: Date = new Date(),
): number {
  const intervalMs = parsePgInterval(voteInterval)
  if (!intervalMs || intervalMs <= 0) return 0

  const elapsed = at.getTime() - toDate(opensAt).getTime()
  return Math.max(0, Math.floor(elapsed / intervalMs))
}

/** Cuándo se habilita el próximo voto. `null` en predicciones clásicas. */
export function nextCycleAt(
  opensAt: string | Date,
  voteInterval: string | null,
  at: Date = new Date(),
): Date | null {
  const intervalMs = parsePgInterval(voteInterval)
  if (!intervalMs || intervalMs <= 0) return null

  const cycle = currentCycle(opensAt, voteInterval, at)
  return new Date(toDate(opensAt).getTime() + (cycle + 1) * intervalMs)
}

/** El voto que corresponde al ciclo vigente, si ya lo emitió. */
export function voteForCurrentCycle(
  prediction: Pick<PredictionRow, 'opens_at' | 'vote_interval' | 'voting_mode'>,
  votes: Vote[],
  at: Date = new Date(),
): Vote | null {
  if (prediction.voting_mode === 'single') {
    return votes[0] ?? null
  }
  const cycle = currentCycle(prediction.opens_at, prediction.vote_interval, at)
  return votes.find((v) => v.cycle === cycle) ?? null
}

export interface VoteAvailability {
  canVote: boolean
  /** Motivo por el que no se puede, para mostrarlo tal cual. */
  reason: null | 'closed' | 'cycle_used' | 'not_open_yet' | 'vote_locked'
  /** En evolutivas, cuándo se habilita el próximo voto. */
  nextAt: Date | null
}

/**
 * Espejo de la ventana de cambio de voto en `cast_vote()`. El primer voto
 * NUNCA se bloquea — el candado sólo gobierna CAMBIOS —, y `vote_change_window
 * === null` significa "hasta el cierre", el mismo idioma que `closes_at`.
 */
export function voteAvailability(
  prediction: StatusInput &
    Pick<PredictionRow, 'opens_at' | 'vote_interval' | 'voting_mode' | 'vote_change_window'>,
  votes: Vote[],
  at: Date = new Date(),
): VoteAvailability {
  if (toDate(prediction.opens_at).getTime() > at.getTime()) {
    return { canVote: false, reason: 'not_open_yet', nextAt: toDate(prediction.opens_at) }
  }
  if (!isOpenForVoting(prediction, at)) {
    return { canVote: false, reason: 'closed', nextAt: null }
  }

  if (prediction.voting_mode === 'single') {
    const existing = votes[0] ?? null
    // Sin voto previo, es el primer voto: nunca se bloquea.
    if (!existing) {
      return { canVote: true, reason: null, nextAt: null }
    }

    const windowMs = parsePgInterval(prediction.vote_change_window)
    // NULL (sin match, "hasta el cierre") = sin límite.
    if (windowMs === null) {
      return { canVote: true, reason: null, nextAt: null }
    }

    const lockAt = toDate(existing.first_cast_at).getTime() + windowMs
    if (at.getTime() > lockAt) {
      return { canVote: false, reason: 'vote_locked', nextAt: null }
    }
    return { canVote: true, reason: null, nextAt: null }
  }

  const used = voteForCurrentCycle(prediction, votes, at)
  if (used) {
    return {
      canVote: false,
      reason: 'cycle_used',
      nextAt: nextCycleAt(prediction.opens_at, prediction.vote_interval, at),
    }
  }
  return {
    canVote: true,
    reason: null,
    nextAt: nextCycleAt(prediction.opens_at, prediction.vote_interval, at),
  }
}

/**
 * Copy de la ventana de cambio de voto: reemplaza el viejo "Podés cambiarlo
 * hasta el cierre" (que ya no es cierto para casi ninguna predicción) por la
 * ventana real, o por el mismo texto de siempre cuando de verdad no hay
 * límite.
 */
export function voteWindowCopy(voteChangeWindow: string | null): string {
  const ms = parsePgInterval(voteChangeWindow)
  if (voteChangeWindow === null || ms === null) return 'Podés cambiarlo hasta el cierre'
  if (ms <= 0) return 'Tu voto queda firme apenas lo emitís'
  if (ms < HOUR) return `Tenés ${Math.round(ms / MINUTE)} minutos para corregir tu voto`
  if (ms < DAY) return `Tenés ${Math.round(ms / HOUR)} horas para corregir tu voto`
  const days = Math.round(ms / DAY)
  return `Tenés ${days} ${days === 1 ? 'día' : 'días'} para corregir tu voto`
}

// ---------------------------------------------------------------------------
// Orden del feed
// ---------------------------------------------------------------------------

/**
 * Prioridad del feed: primero lo que necesita una acción tuya, después lo que
 * está por vencer. No es un dashboard: lo urgente y lo pendiente arriba.
 */
export function feedRank(prediction: Prediction, now: Date = new Date()): number {
  const status = effectiveStatus(prediction, now)
  const availability = voteAvailability(prediction, prediction.myVotes, now)
  // Sin cierre por fecha, `closesIn` es Infinity: nunca cae en la ventana de
  // "cierra pronto", que es exactamente lo correcto — no hay nada por vencer.
  const closesIn = closesAtMs(prediction) - now.getTime()

  // 0 = arriba de todo
  if (status === 'proposed' && availability.canVote && !prediction.myVote) return 0
  if (availability.canVote && !prediction.myVote) return 1
  if (status === 'closed' || status === 'resolving') return 2
  if (status === 'proposed') return 3
  if (status === 'active') return closesIn < 24 * 3_600_000 ? 4 : 5
  return 6
}

export function sortFeed(predictions: Prediction[], now: Date = new Date()): Prediction[] {
  return [...predictions].sort((a, b) => {
    const rank = feedRank(a, now) - feedRank(b, now)
    if (rank !== 0) return rank
    // Dentro del mismo rango, lo abierto (Infinity) siempre queda último.
    const diff = closesAtMs(a) - closesAtMs(b)
    return Number.isNaN(diff) ? 0 : diff
  })
}

// ---------------------------------------------------------------------------
// Quórum — mirror puro de required_participants()/required_close_requests()
// ---------------------------------------------------------------------------

/**
 * Espejo de `required_participants()` en SQL, para previsualizar en el
 * formulario de creación ANTES de que exista la fila (ahí no hay ninguna
 * predicción sobre la que pedirle el cálculo al servidor). El
 * `least(memberCount, …)` es el mismo fix que corrige el bug de los grupos
 * chicos; nunca se debe quitar acá tampoco.
 */
export function requiredParticipantsPreview(memberCount: number, percent: number): number {
  const count = Math.max(0, memberCount)
  return Math.max(1, Math.min(count, Math.ceil((count * percent) / 100)))
}

/**
 * Espejo de `required_close_requests(p_member_count, p_quorum)`: ya NO es un
 * porcentaje, es la cantidad absoluta configurada en el grupo
 * (`groups.close_request_quorum`), acotada al conteo vivo de integrantes.
 * Piso 1 en ambos extremos — "con solo uno alcance si confías en el grupo".
 */
export function requiredCloseRequestsPreview(memberCount: number, quorum: number): number {
  return Math.max(1, Math.min(Math.max(1, memberCount), quorum))
}

// ---------------------------------------------------------------------------
// Etiquetas
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<PredictionStatus, string> = {
  proposed: 'En prueba',
  active: 'Abierta',
  closed: 'Cerrada',
  resolving: 'Resolviendo',
  resolved: 'Resuelta',
  expired: 'No juntó gente',
  cancelled: 'Cancelada',
}

export const STATUS_RAIL: Record<PredictionStatus, string> = {
  proposed: 'var(--status-testing)',
  active: 'var(--status-active)',
  closed: 'var(--status-closed)',
  resolving: 'var(--status-closed)',
  resolved: 'var(--status-resolved)',
  expired: 'var(--status-expired)',
  cancelled: 'var(--status-cancelled)',
}

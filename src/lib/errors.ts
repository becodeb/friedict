/**
 * Traducción de errores a algo que una persona pueda accionar.
 *
 * Dos reglas:
 *  1. Nunca mostrar el detalle interno de Postgres.
 *  2. Nunca revelar si un grupo existe. Un token inválido, uno vencido, uno
 *     revocado y uno de un grupo borrado dan todos exactamente el mismo texto.
 */

export const DOMAIN_ERRORS: Record<string, string> = {
  auth_required: 'Necesitás iniciar sesión para hacer eso.',
  not_a_member: 'No pertenecés a este grupo.',
  admin_only: 'Sólo quien administra el grupo puede hacer eso.',
  owner_only: 'Sólo quien creó el grupo puede hacer eso.',
  not_allowed: 'No podés hacer eso.',
  owner_cannot_leave:
    'Sos la persona que creó el grupo. Pasale la administración a alguien antes de salir.',
  cannot_change_own_role: 'No podés cambiar tu propio rol.',
  ownership_transfer_unsupported: 'Todavía no se puede transferir el grupo.',

  invalid_invite: 'Este link no sirve. Pedile a alguien del grupo que te mande uno nuevo.',
  invite_not_found:
    'Este link no sirve. Pedile a alguien del grupo que te mande uno nuevo.',

  voting_closed: 'Se cerraron las predicciones.',
  voting_not_open: 'Todavía no se puede votar.',
  must_vote_first: 'Tenés que votar antes de pedir el cierre.',
  cycle_vote_used: 'Ya usaste tu voto de esta ronda. Esperá a la próxima.',
  invalid_option: 'Esa opción no es válida.',
  needs_two_options: 'Hacen falta al menos dos opciones.',
  too_many_options: 'Son demasiadas opciones. Máximo 12.',
  options_locked: 'Esta predicción no acepta opciones nuevas.',
  closes_at_must_be_future: 'El cierre tiene que ser en el futuro.',
  interval_exceeds_window:
    'No entra ni una ronda completa antes del cierre: alargá el cierre o acortá el intervalo.',
  prediction_not_found: 'No encontramos esta predicción.',
  template_not_found: 'Esa propuesta ya no está disponible.',
  already_resolved: 'Esta predicción ya está resuelta.',

  not_closed_yet: 'Todavía no cerró. Esperá al cierre para resolverla.',
  resolution_already_open: 'Ya hay un resultado propuesto esperando confirmación.',
  resolution_settled: 'Esta propuesta ya se resolvió.',
  resolution_not_found: 'No encontramos esta propuesta.',
  proposer_cannot_confirm: 'No podés confirmar tu propia propuesta.',
  already_confirmed: 'Ya diste tu opinión sobre esta propuesta.',
  not_resolved: 'Esta predicción todavía no tiene resultado.',

  rate_limited: 'Vas muy rápido. Esperá un momento y probá de nuevo.',
}

const GENERIC = 'Algo no salió bien. Probá otra vez.'

interface MaybePostgrestError {
  message?: string
  code?: string
  details?: string
  hint?: string
}

/** Extrae el código de dominio (`raise exception 'x'`) de un error de PostgREST. */
export function domainCode(error: unknown): string | null {
  const e = error as MaybePostgrestError | null
  if (!e?.message) return null

  const raw = e.message.trim()
  if (DOMAIN_ERRORS[raw]) return raw

  // PostgREST a veces envuelve el mensaje.
  const match = /\b([a-z][a-z0-9_]{3,40})\b/.exec(raw)
  if (match?.[1] && DOMAIN_ERRORS[match[1]]) return match[1]

  return null
}

export function friendlyError(error: unknown, fallback: string = GENERIC): string {
  if (!error) return fallback

  const code = domainCode(error)
  if (code) return DOMAIN_ERRORS[code] ?? fallback

  const e = error as MaybePostgrestError
  // Violación de RLS o de permisos: se responde como "no existe / no podés",
  // nunca describiendo la política.
  if (e.code === '42501' || e.code === 'PGRST301') {
    return 'No tenés acceso a esto.'
  }
  if (e.code === 'PGRST116') {
    return 'No encontramos lo que buscabas.'
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'Parece que te quedaste sin conexión. Probá de nuevo cuando vuelva.'
  }

  return fallback
}

/** ¿El error significa que hay que refrescar el estado del servidor? */
export function isStaleStateError(error: unknown): boolean {
  const code = domainCode(error)
  return (
    code === 'voting_closed' || code === 'cycle_vote_used' || code === 'resolution_settled'
  )
}

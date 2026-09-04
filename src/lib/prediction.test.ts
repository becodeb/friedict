import { describe, expect, it } from 'vitest'
import {
  canSeeVotes,
  currentCycle,
  effectiveStatus,
  feedRank,
  hasQualified,
  isOpenForVoting,
  nextCycleAt,
  participantsMissing,
  requiredCloseRequestsPreview,
  requiredParticipantsPreview,
  sortFeed,
  voteAvailability,
  voteForCurrentCycle,
} from './prediction'
import type { Prediction, PredictionRow, Vote } from './types'

const NOW = new Date('2026-08-13T12:00:00.000Z')
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString()
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

function makePrediction(overrides: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id: 'p1',
    group_id: 'g1',
    created_by: 'u1',
    template_id: null,
    title: '¿Bauti llega después de las 22:30?',
    description: null,
    option_type: 'manual',
    voting_mode: 'single',
    vote_interval: null,
    // Postgres serializa `interval '15 minutes'` como "00:15:00" (formato
    // reloj), no como texto de unidades — el fixture usa el mismo formato
    // que realmente viaja desde la base.
    vote_change_window: '00:15:00',
    allow_new_options: false,
    results_visibility: 'on_close',
    votes_visibility: 'on_close',
    close_request_count: 0,
    closed_at: null,
    // Rastro de auditoría, ya nada la lee: se deja en NULL, como en toda
    // predicción creada después de este cambio.
    qualification_deadline: null,
    opens_at: hours(-4),
    closes_at: days(2),
    is_default: false,
    status: 'proposed',
    participant_count: 0,
    vote_count: 0,
    resolved_option_id: null,
    resolved_at: null,
    created_at: hours(-4),
    updated_at: hours(-4),
    ...overrides,
  }
}

/** `StatusInput` requiere `required_participants`: se agrega acá, no en el fixture crudo. */
function withStatusInput(row: PredictionRow, requiredParticipants = 3) {
  return { ...row, required_participants: requiredParticipants }
}

function makeVote(overrides: Partial<Vote> = {}): Vote {
  return {
    id: 'v1',
    prediction_id: 'p1',
    option_id: 'o1',
    user_id: 'u1',
    cycle: 0,
    first_cast_at: hours(-1),
    option_selected_at: hours(-1),
    created_at: hours(-1),
    updated_at: hours(-1),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Umbral de participación
// ---------------------------------------------------------------------------
describe('umbral de participación', () => {
  it.each([0, 1, 2])('con %i participantes NO califica', (count) => {
    expect(hasQualified(count, 3, false)).toBe(false)
  })

  it('con 3 participantes califica', () => {
    expect(hasQualified(3, 3, false)).toBe(true)
  })

  it('con más de 3 sigue calificando', () => {
    expect(hasQualified(7, 3, false)).toBe(true)
  })

  it('una predicción del sistema califica siempre, incluso con 0 votos', () => {
    expect(hasQualified(0, 3, true)).toBe(true)
  })

  it('cuenta cuánta gente falta sin ir a negativo', () => {
    expect(participantsMissing(0, 3)).toBe(3)
    expect(participantsMissing(2, 3)).toBe(1)
    expect(participantsMissing(5, 3)).toBe(0)
  })

  // Grupos chicos: el bug era que `minimum_participants` fijo en 3 nunca
  // calificaba en un grupo de 1 o 2 personas. `hasQualified` en sí es sólo una
  // comparación — la corrección real vive en required_participants() del lado
  // del servidor (`least(member_count, …)`) — pero el mirror del cliente tiene
  // que aceptar cualquier requisito ya acotado, no sólo 3.
  it.each([
    [1, 1, true],
    [2, 2, true],
    [3, 3, true],
    [7, 5, true],
    [4, 5, false],
  ])(
    'con %i participantes y requisito %i, califica = %s (requisito ya acotado al grupo)',
    (count, required, expected) => {
      expect(hasQualified(count, required, false)).toBe(expected)
    },
  )
})

describe('effectiveStatus', () => {
  it.each([0, 1, 2])(
    'con %i participantes y sin alcanzar el requisito, se queda "en prueba" para siempre: nada expira',
    (count) => {
      const prediction = withStatusInput(
        makePrediction({ participant_count: count, closes_at: null }),
      )
      const lejano = new Date(NOW.getTime() + 100 * 365 * 86_400_000)
      expect(effectiveStatus(prediction, NOW)).toBe('proposed')
      expect(effectiveStatus(prediction, lejano)).toBe('proposed')
    },
  )

  it('una fila que YA está expired (de antes de este cambio) se queda expired: nada la revive', () => {
    const prediction = withStatusInput(makePrediction({ status: 'expired', participant_count: 0 }))
    expect(effectiveStatus(prediction, NOW)).toBe('expired')
  })

  it('se activa con 3 participantes', () => {
    const prediction = withStatusInput(makePrediction({ participant_count: 3 }))
    expect(effectiveStatus(prediction, NOW)).toBe('active')
  })

  it('una predicción del sistema no expira nunca por falta de participación', () => {
    const prediction = withStatusInput(
      makePrediction({ is_default: true, participant_count: 0 }),
    )
    expect(effectiveStatus(prediction, NOW)).toBe('active')
  })

  it('con required_participants en 0 (el grupo no pide calificar), queda activa aunque nadie haya votado', () => {
    const prediction = withStatusInput(makePrediction({ participant_count: 0 }), 0)
    expect(effectiveStatus(prediction, NOW)).toBe('active')
  })

  it('sigue en prueba mientras no alcance el requisito', () => {
    const prediction = withStatusInput(makePrediction({ participant_count: 2 }))
    expect(effectiveStatus(prediction, NOW)).toBe('proposed')
  })

  it('cierra al llegar closes_at', () => {
    const prediction = withStatusInput(
      makePrediction({ status: 'active', participant_count: 4, closes_at: hours(-1) }),
    )
    expect(effectiveStatus(prediction, NOW)).toBe('closed')
  })

  it('no recalcula estados terminales', () => {
    for (const status of ['resolved', 'expired', 'cancelled', 'resolving'] as const) {
      const prediction = withStatusInput(makePrediction({ status, closes_at: hours(-100) }))
      expect(effectiveStatus(prediction, NOW)).toBe(status)
    }
  })

  it('una que calificó pero cuyo cierre ya pasó queda cerrada, no activa', () => {
    const prediction = withStatusInput(
      makePrediction({
        participant_count: 4,
        closes_at: hours(-2),
      }),
    )
    expect(effectiveStatus(prediction, NOW)).toBe('closed')
  })

  // -------------------------------------------------------------------------
  // closes_at nulo: predicciones abiertas
  // -------------------------------------------------------------------------
  it('no lanza con closes_at nulo, activa', () => {
    const prediction = withStatusInput(
      makePrediction({ status: 'active', participant_count: 4, closes_at: null }),
    )
    expect(() => effectiveStatus(prediction, NOW)).not.toThrow()
    expect(effectiveStatus(prediction, NOW)).toBe('active')
  })

  it('nunca cierra sola por fecha con closes_at nulo, en NINGÚN now', () => {
    const prediction = withStatusInput(
      makePrediction({ status: 'active', participant_count: 4, closes_at: null }),
    )
    const lejano = new Date(NOW.getTime() + 100 * 365 * 86_400_000)
    expect(effectiveStatus(prediction, lejano)).toBe('active')
  })

  it('con closes_at nulo, "en prueba" sigue en prueba (no expira por fecha de cierre)', () => {
    const prediction = withStatusInput(
      makePrediction({ status: 'proposed', participant_count: 1, closes_at: null }),
    )
    expect(effectiveStatus(prediction, NOW)).toBe('proposed')
  })
})

// ---------------------------------------------------------------------------
// Votación clásica
// ---------------------------------------------------------------------------
describe('votación clásica', () => {
  it('se puede votar mientras esté abierta', () => {
    const prediction = withStatusInput(makePrediction({ participant_count: 3, status: 'active' }))
    expect(voteAvailability(prediction, [], NOW).canVote).toBe(true)
  })

  it('se puede CAMBIAR el voto DENTRO de la ventana', () => {
    const prediction = withStatusInput(makePrediction({ participant_count: 3, status: 'active' }))
    // vote_change_window default es 15 minutos; el voto se emitió hace 5.
    const availability = voteAvailability(
      prediction,
      [makeVote({ first_cast_at: new Date(NOW.getTime() - 5 * 60_000).toISOString() })],
      NOW,
    )
    expect(availability.canVote).toBe(true)
    expect(availability.reason).toBeNull()
  })

  it('NO se puede cambiar el voto una vez vencida la ventana: vote_locked', () => {
    const prediction = withStatusInput(makePrediction({ participant_count: 3, status: 'active' }))
    const availability = voteAvailability(
      prediction,
      [makeVote({ first_cast_at: new Date(NOW.getTime() - 20 * 60_000).toISOString() })],
      NOW,
    )
    expect(availability.canVote).toBe(false)
    expect(availability.reason).toBe('vote_locked')
  })

  it('con vote_change_window null ("hasta el cierre"), sigue sin límite sin importar cuándo se votó', () => {
    const prediction = withStatusInput(
      makePrediction({ participant_count: 3, status: 'active', vote_change_window: null }),
    )
    const availability = voteAvailability(
      prediction,
      [makeVote({ first_cast_at: days(-30) })],
      NOW,
    )
    expect(availability.canVote).toBe(true)
    expect(availability.reason).toBeNull()
  })

  it('el primer voto (sin fila previa) nunca se bloquea, incluso con la ventana ya "vencida" en abstracto', () => {
    const prediction = withStatusInput(
      makePrediction({ participant_count: 3, status: 'active', vote_change_window: '00:00:00' }),
    )
    expect(voteAvailability(prediction, [], NOW).canVote).toBe(true)
  })

  it('no se puede votar después del cierre', () => {
    const prediction = withStatusInput(
      makePrediction({ status: 'active', participant_count: 4, closes_at: hours(-1) }),
    )
    const availability = voteAvailability(prediction, [], NOW)
    expect(availability.canVote).toBe(false)
    expect(availability.reason).toBe('closed')
    expect(isOpenForVoting(prediction, NOW)).toBe(false)
  })

  it('no se puede votar en una que expiró', () => {
    const prediction = withStatusInput(makePrediction({ status: 'expired' }))
    expect(voteAvailability(prediction, [], NOW).canVote).toBe(false)
  })

  it('no se puede votar antes de que abra', () => {
    const prediction = withStatusInput(makePrediction({ opens_at: hours(3), status: 'active' }))
    const availability = voteAvailability(prediction, [], NOW)
    expect(availability.canVote).toBe(false)
    expect(availability.reason).toBe('not_open_yet')
  })

  it('se puede votar en una que está EN PRUEBA: así es como califica', () => {
    const prediction = withStatusInput(makePrediction({ status: 'proposed', participant_count: 2 }))
    expect(voteAvailability(prediction, [], NOW).canVote).toBe(true)
  })

  it('con closes_at nulo, la votación queda abierta siempre', () => {
    const prediction = withStatusInput(
      makePrediction({ status: 'active', participant_count: 4, closes_at: null }),
    )
    expect(isOpenForVoting(prediction, NOW)).toBe(true)
    expect(voteAvailability(prediction, [], NOW).canVote).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Votación evolutiva
// ---------------------------------------------------------------------------
describe('votación evolutiva', () => {
  const recurring = (overrides: Partial<PredictionRow> = {}) =>
    withStatusInput(
      makePrediction({
        voting_mode: 'recurring',
        vote_interval: '7 days',
        opens_at: days(-21),
        closes_at: days(30),
        participant_count: 4,
        status: 'active',
        ...overrides,
      }),
    )

  it('calcula el ciclo vigente a partir de opens_at y el intervalo', () => {
    expect(currentCycle(days(-21), '7 days', NOW)).toBe(3)
    expect(currentCycle(days(-6), '7 days', NOW)).toBe(0)
    expect(currentCycle(days(-7), '7 days', NOW)).toBe(1)
  })

  it('una predicción clásica está siempre en el ciclo 0', () => {
    expect(currentCycle(days(-30), null, NOW)).toBe(0)
  })

  it('habilita un voto por ciclo', () => {
    expect(voteAvailability(recurring(), [], NOW).canVote).toBe(true)
  })

  it('bloquea el segundo voto dentro del mismo ciclo', () => {
    const votes = [makeVote({ cycle: 3 })]
    const availability = voteAvailability(recurring(), votes, NOW)
    expect(availability.canVote).toBe(false)
    expect(availability.reason).toBe('cycle_used')
  })

  it('el ciclo siguiente vuelve a habilitar el voto', () => {
    // Votó en el ciclo 2; ahora estamos en el 3.
    const votes = [makeVote({ cycle: 2 })]
    expect(voteAvailability(recurring(), votes, NOW).canVote).toBe(true)
  })

  it('informa cuándo se habilita el próximo voto', () => {
    const availability = voteAvailability(recurring(), [makeVote({ cycle: 3 })], NOW)
    const expected = nextCycleAt(days(-21), '7 days', NOW)
    expect(availability.nextAt?.getTime()).toBe(expected?.getTime())
    expect(availability.nextAt!.getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('conserva el historial: los votos viejos no se pisan', () => {
    const votes = [
      makeVote({ id: 'v0', cycle: 0, option_id: 'juan' }),
      makeVote({ id: 'v1', cycle: 1, option_id: 'juan' }),
      makeVote({ id: 'v2', cycle: 2, option_id: 'lu' }),
      makeVote({ id: 'v3', cycle: 3, option_id: 'lu' }),
    ]
    const prediction = recurring()

    expect(votes).toHaveLength(4)
    expect(voteForCurrentCycle(prediction, votes, NOW)?.id).toBe('v3')
    expect(votes.filter((vote) => vote.option_id === 'juan')).toHaveLength(2)
  })

  it('en modo clásico el «voto del ciclo» es simplemente el único voto', () => {
    const prediction = withStatusInput(makePrediction({ status: 'active', participant_count: 3 }))
    const vote = makeVote()
    expect(voteForCurrentCycle(prediction, [vote], NOW)?.id).toBe(vote.id)
  })

  it('evolutiva sin cierre: el ciclo se sigue calculando bien con closes_at nulo', () => {
    const prediction = recurring({ closes_at: null })
    expect(voteAvailability(prediction, [], NOW).canVote).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Orden del feed
// ---------------------------------------------------------------------------
describe('orden del feed', () => {
  const withExtras = (
    row: PredictionRow,
    myVotes: Vote[] = [],
    requiredParticipants = 3,
  ): Prediction => ({
    ...row,
    required_participants: requiredParticipants,
    member_count: 5,
    close_required: 3,
    my_close_request: false,
    options: [],
    votes: myVotes,
    myVotes,
    myVote: myVotes[myVotes.length - 1] ?? null,
    author: null,
  })

  it('pone primero lo que necesita tu voto', () => {
    const yaVotada = withExtras(
      makePrediction({ id: 'votada', status: 'active', participant_count: 4 }),
      [makeVote()],
    )
    const sinVotar = withExtras(
      makePrediction({ id: 'sin-votar', status: 'active', participant_count: 4 }),
    )
    const enPrueba = withExtras(
      makePrediction({ id: 'en-prueba', status: 'proposed', participant_count: 2 }),
    )

    const orden = sortFeed([yaVotada, sinVotar, enPrueba], NOW).map((p) => p.id)
    expect(orden[0]).toBe('en-prueba')
    expect(orden[1]).toBe('sin-votar')
    expect(orden[2]).toBe('votada')
  })

  it('feedRank no lanza y no marca "cierra en 24h" a una predicción abierta ya votada', () => {
    // Con myVote presente se sale de las ramas "necesita tu voto" (0/1) y se
    // llega a la que compara `closesIn` — la que de verdad ejercita el fix.
    const abierta = withExtras(
      makePrediction({
        id: 'abierta',
        status: 'active',
        participant_count: 4,
        closes_at: null,
      }),
      [makeVote()],
    )
    expect(() => feedRank(abierta, NOW)).not.toThrow()
    // rank 5 = "activa, no está por vencer" — nunca 4 ("cierra en <24h"),
    // porque no hay ninguna fecha de la que esté "por vencer".
    expect(feedRank(abierta, NOW)).toBe(5)
  })

  it('sortFeed no lanza con closes_at nulo y ordena lo abierto al final de su rango', () => {
    const cierraProto = withExtras(
      makePrediction({
        id: 'cierra-pronto',
        status: 'active',
        participant_count: 4,
        closes_at: hours(2),
      }),
    )
    const abierta = withExtras(
      makePrediction({
        id: 'abierta',
        status: 'active',
        participant_count: 4,
        closes_at: null,
      }),
    )
    expect(() => sortFeed([abierta, cierraProto], NOW)).not.toThrow()

    // Las dos son rank 4 (cierran "pronto"/nunca)… en realidad la abierta cae
    // en rank 5 y la que cierra en 2h en rank 4, así que la que tiene fecha
    // aparece primero de todos modos. Se agrega una tercera del mismo rango
    // para probar el desempate real dentro de rank 5.
    const otraAbierta = withExtras(
      makePrediction({
        id: 'otra-abierta',
        status: 'active',
        participant_count: 4,
        closes_at: days(10),
      }),
    )
    const orden = sortFeed([abierta, otraAbierta], NOW).map((p) => p.id)
    expect(orden[0]).toBe('otra-abierta')
    expect(orden[1]).toBe('abierta')
  })
})

// ---------------------------------------------------------------------------
// canSeeVotes
// ---------------------------------------------------------------------------
describe('requiredParticipantsPreview / requiredCloseRequestsPreview (mirror del formulario de creación)', () => {
  it('un grupo de 2 personas al 60% pide 2 (el piso de calificación es 1, el techo es el grupo)', () => {
    expect(requiredParticipantsPreview(2, 60)).toBe(2)
  })

  it('nunca supera el conteo vivo de integrantes', () => {
    expect(requiredParticipantsPreview(3, 100)).toBe(3)
  })

  it('el piso de calificación es 1', () => {
    expect(requiredParticipantsPreview(10, 1)).toBe(1)
  })

  // requiredCloseRequestsPreview ya NO es un porcentaje: es la cantidad
  // absoluta configurada en el grupo (groups.close_request_quorum), acotada
  // al conteo vivo. Piso 1 en ambos extremos — "con solo uno alcance si
  // confías en el grupo" es el pedido central del dueño.
  it('(memberCount=1, quorum=1) da 1: el piso de 1 es intencional', () => {
    expect(requiredCloseRequestsPreview(1, 1)).toBe(1)
  })

  it('(memberCount=5, quorum=3) da 3: el quórum configurado, sin acotar', () => {
    expect(requiredCloseRequestsPreview(5, 3)).toBe(3)
  })

  it('(memberCount=2, quorum=9) da 2: el quórum se acota al conteo vivo del grupo', () => {
    expect(requiredCloseRequestsPreview(2, 9)).toBe(2)
  })

  it('(memberCount=3, quorum=0) da 1: el piso nunca baja de 1 aunque el quórum configurado sea 0', () => {
    expect(requiredCloseRequestsPreview(3, 0)).toBe(1)
  })
})

describe('canSeeVotes', () => {
  it.each([
    ['visible' as const, 'active' as const, true],
    ['anonymous' as const, 'resolved' as const, false],
    ['on_close' as const, 'proposed' as const, false],
    ['on_close' as const, 'closed' as const, true],
    ['visible' as const, 'proposed' as const, true],
    ['anonymous' as const, 'closed' as const, false],
  ])('votes_visibility=%s, status=%s → %s', (votesVisibility, status, expected) => {
    expect(canSeeVotes({ votes_visibility: votesVisibility }, status)).toBe(expected)
  })
})

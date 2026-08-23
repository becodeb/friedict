import { describe, expect, it } from 'vitest'
import {
  currentCycle,
  effectiveStatus,
  hasQualified,
  isOpenForVoting,
  nextCycleAt,
  participantsMissing,
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
    allow_new_options: false,
    results_visibility: 'on_close',
    votes_visibility: 'on_close',
    minimum_participants: 3,
    qualification_deadline: hours(6),
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

function makeVote(overrides: Partial<Vote> = {}): Vote {
  return {
    id: 'v1',
    prediction_id: 'p1',
    option_id: 'o1',
    user_id: 'u1',
    cycle: 0,
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
})

describe('effectiveStatus', () => {
  it.each([0, 1, 2])(
    'expira con %i participantes cuando vence el plazo de calificación',
    (count) => {
      const prediction = makePrediction({
        participant_count: count,
        qualification_deadline: hours(-1),
      })
      expect(effectiveStatus(prediction, NOW)).toBe('expired')
    },
  )

  it('se mantiene con 3 participantes aunque venza el plazo', () => {
    const prediction = makePrediction({
      participant_count: 3,
      qualification_deadline: hours(-1),
    })
    expect(effectiveStatus(prediction, NOW)).toBe('active')
  })

  it('una predicción del sistema no expira nunca por falta de participación', () => {
    const prediction = makePrediction({
      is_default: true,
      participant_count: 0,
      qualification_deadline: hours(-10),
    })
    expect(effectiveStatus(prediction, NOW)).toBe('active')
  })

  it('sigue en prueba mientras no venza el plazo', () => {
    const prediction = makePrediction({ participant_count: 2 })
    expect(effectiveStatus(prediction, NOW)).toBe('proposed')
  })

  it('cierra al llegar closes_at', () => {
    const prediction = makePrediction({
      status: 'active',
      participant_count: 4,
      closes_at: hours(-1),
    })
    expect(effectiveStatus(prediction, NOW)).toBe('closed')
  })

  it('no recalcula estados terminales', () => {
    for (const status of ['resolved', 'expired', 'cancelled', 'resolving'] as const) {
      const prediction = makePrediction({ status, closes_at: hours(-100) })
      expect(effectiveStatus(prediction, NOW)).toBe(status)
    }
  })

  it('una que calificó pero cuyo cierre ya pasó queda cerrada, no activa', () => {
    const prediction = makePrediction({
      participant_count: 4,
      qualification_deadline: hours(-20),
      closes_at: hours(-2),
    })
    expect(effectiveStatus(prediction, NOW)).toBe('closed')
  })
})

// ---------------------------------------------------------------------------
// Votación clásica
// ---------------------------------------------------------------------------
describe('votación clásica', () => {
  it('se puede votar mientras esté abierta', () => {
    const prediction = makePrediction({ participant_count: 3, status: 'active' })
    expect(voteAvailability(prediction, [], NOW).canVote).toBe(true)
  })

  it('se puede CAMBIAR el voto hasta el cierre', () => {
    const prediction = makePrediction({ participant_count: 3, status: 'active' })
    const availability = voteAvailability(prediction, [makeVote()], NOW)
    expect(availability.canVote).toBe(true)
    expect(availability.reason).toBeNull()
  })

  it('no se puede votar después del cierre', () => {
    const prediction = makePrediction({
      status: 'active',
      participant_count: 4,
      closes_at: hours(-1),
    })
    const availability = voteAvailability(prediction, [], NOW)
    expect(availability.canVote).toBe(false)
    expect(availability.reason).toBe('closed')
    expect(isOpenForVoting(prediction, NOW)).toBe(false)
  })

  it('no se puede votar en una que expiró', () => {
    const prediction = makePrediction({ status: 'expired' })
    expect(voteAvailability(prediction, [], NOW).canVote).toBe(false)
  })

  it('no se puede votar antes de que abra', () => {
    const prediction = makePrediction({ opens_at: hours(3), status: 'active' })
    const availability = voteAvailability(prediction, [], NOW)
    expect(availability.canVote).toBe(false)
    expect(availability.reason).toBe('not_open_yet')
  })

  it('se puede votar en una que está EN PRUEBA: así es como califica', () => {
    const prediction = makePrediction({ status: 'proposed', participant_count: 2 })
    expect(voteAvailability(prediction, [], NOW).canVote).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Votación evolutiva
// ---------------------------------------------------------------------------
describe('votación evolutiva', () => {
  const recurring = (overrides: Partial<PredictionRow> = {}) =>
    makePrediction({
      voting_mode: 'recurring',
      vote_interval: '7 days',
      opens_at: days(-21),
      closes_at: days(30),
      qualification_deadline: days(-14),
      participant_count: 4,
      status: 'active',
      ...overrides,
    })

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
    const prediction = makePrediction({ status: 'active', participant_count: 3 })
    const vote = makeVote()
    expect(voteForCurrentCycle(prediction, [vote], NOW)?.id).toBe(vote.id)
  })
})

// ---------------------------------------------------------------------------
// Orden del feed
// ---------------------------------------------------------------------------
describe('orden del feed', () => {
  const withExtras = (row: PredictionRow, myVotes: Vote[] = []): Prediction => ({
    ...row,
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
})

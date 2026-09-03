import { describe, expect, it } from 'vitest'
import { createPredictionSchema, roundsBeforeClose } from './validation'

const DAY_MS = 86_400_000

function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: '¿Bauti llega después de las 22:30?',
    optionType: 'manual' as const,
    options: ['Sí', 'No'],
    votingMode: 'single' as const,
    allowNewOptions: false,
    resultsVisibility: 'on_close' as const,
    votesVisibility: 'on_close' as const,
    closeMode: 'date' as const,
    closesAt: new Date(Date.now() + 48 * 3_600_000).toISOString(),
    qualificationPercent: 60,
    closePercent: 50,
    qualificationHours: 48,
    ...overrides,
  }
}

describe('createPredictionSchema — closeMode', () => {
  it('closesAt es obligatorio cuando closeMode es "date"', () => {
    const result = createPredictionSchema.safeParse(baseInput({ closesAt: '' }))
    expect(result.success).toBe(false)
  })

  it('closesAt no hace falta cuando closeMode es "open"', () => {
    const result = createPredictionSchema.safeParse(
      baseInput({ closeMode: 'open', closesAt: undefined }),
    )
    expect(result.success).toBe(true)
  })

  it('rechaza un closesAt en el pasado cuando closeMode es "date"', () => {
    const result = createPredictionSchema.safeParse(
      baseInput({ closesAt: new Date(Date.now() - 3_600_000).toISOString() }),
    )
    expect(result.success).toBe(false)
  })
})

describe('createPredictionSchema — porcentajes de quórum', () => {
  it.each([0, 101, -5])('rechaza qualificationPercent fuera de 1-100 (%i)', (value) => {
    const result = createPredictionSchema.safeParse(baseInput({ qualificationPercent: value }))
    expect(result.success).toBe(false)
  })

  it.each([1, 60, 100])('acepta qualificationPercent dentro de 1-100 (%i)', (value) => {
    const result = createPredictionSchema.safeParse(baseInput({ qualificationPercent: value }))
    expect(result.success).toBe(true)
  })

  it.each([0, 101])('rechaza closePercent fuera de 1-100 (%i)', (value) => {
    const result = createPredictionSchema.safeParse(baseInput({ closePercent: value }))
    expect(result.success).toBe(false)
  })
})

describe('createPredictionSchema — evolutiva vs. ventana de cierre', () => {
  it('rechaza un intervalo que no entra ni una vez antes del cierre (closeMode=date)', () => {
    const result = createPredictionSchema.safeParse(
      baseInput({
        votingMode: 'recurring',
        intervalDays: 10,
        closeMode: 'date',
        closesAt: new Date(Date.now() + 2 * DAY_MS).toISOString(),
      }),
    )
    expect(result.success).toBe(false)
  })

  it('acepta un intervalo que sí entra al menos una vez antes del cierre', () => {
    const result = createPredictionSchema.safeParse(
      baseInput({
        votingMode: 'recurring',
        intervalDays: 7,
        closeMode: 'date',
        closesAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      }),
    )
    expect(result.success).toBe(true)
  })

  it('con closeMode=open el intervalo queda SIN techo: cualquier intervalDays razonable pasa', () => {
    const result = createPredictionSchema.safeParse(
      baseInput({
        votingMode: 'recurring',
        intervalDays: 90,
        closeMode: 'open',
        closesAt: undefined,
      }),
    )
    expect(result.success).toBe(true)
  })

  it('evolutiva sin intervalDays sigue siendo un error, con cualquier closeMode', () => {
    const result = createPredictionSchema.safeParse(
      baseInput({ votingMode: 'recurring', intervalDays: undefined, closeMode: 'open' }),
    )
    expect(result.success).toBe(false)
  })
})

describe('roundsBeforeClose', () => {
  const NOW = new Date('2026-08-13T12:00:00.000Z')

  it('sin cierre (closesAt nulo) devuelve null: no hay techo de rondas', () => {
    expect(roundsBeforeClose(null, 7, NOW)).toBeNull()
  })

  it('calcula cuántas rondas completas entran antes del cierre', () => {
    const closesAt = new Date(NOW.getTime() + 30 * DAY_MS)
    expect(roundsBeforeClose(closesAt, 7, NOW)).toBe(4)
  })

  it('un intervalo que no entra ni una vez da 0, no negativo', () => {
    const closesAt = new Date(NOW.getTime() + 2 * DAY_MS)
    expect(roundsBeforeClose(closesAt, 7, NOW)).toBe(0)
  })

  it('un cierre ya pasado da 0, nunca negativo', () => {
    const closesAt = new Date(NOW.getTime() - DAY_MS)
    expect(roundsBeforeClose(closesAt, 7, NOW)).toBe(0)
  })
})

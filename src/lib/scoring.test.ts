import { describe, expect, it } from 'vitest'
import {
  BASE_POINTS,
  MAX_DURATION,
  MAX_EARLY,
  MAX_RARITY,
  RARITY_MIN_SAMPLE,
  calculatePoints,
  convictionMultiplier,
  durationMultiplier,
  earlyMultiplier,
  explainScore,
  rarityMultiplier,
} from './scoring'

describe('rarityMultiplier', () => {
  it('no premia la rareza sin muestra suficiente', () => {
    // Con 3 votos, que una opción tenga 1 solo voto no significa nada.
    expect(rarityMultiplier(0.33, 3)).toBe(1)
    expect(rarityMultiplier(0, 1)).toBe(1)
    expect(rarityMultiplier(0.5, RARITY_MIN_SAMPLE - 1)).toBe(1)
  })

  it('paga más cuanta menos gente eligió la opción correcta', () => {
    expect(rarityMultiplier(1, 10)).toBeCloseTo(1, 5)
    expect(rarityMultiplier(0.5, 10)).toBeCloseTo(1.4, 5)
    expect(rarityMultiplier(0.25, 10)).toBeCloseTo(1.6, 5)
  })

  it('tiene techo, incluso si nadie más la eligió', () => {
    expect(rarityMultiplier(0, 100)).toBe(MAX_RARITY)
    expect(rarityMultiplier(0.01, 100)).toBeLessThanOrEqual(MAX_RARITY)
  })

  it('acota entradas fuera de rango en lugar de propagarlas', () => {
    expect(rarityMultiplier(-5, 10)).toBe(MAX_RARITY)
    expect(rarityMultiplier(99, 10)).toBe(1)
    expect(rarityMultiplier(Number.NaN, 10)).toBe(MAX_RARITY)
  })
})

describe('earlyMultiplier', () => {
  it('paga hasta 25% más por haberla elegido apenas abrió', () => {
    expect(earlyMultiplier(0)).toBe(1)
    expect(earlyMultiplier(0.5)).toBeCloseTo(1.125, 5)
    expect(earlyMultiplier(1)).toBe(MAX_EARLY)
  })

  it('no se puede exceder el techo con valores fuera de rango', () => {
    expect(earlyMultiplier(4)).toBe(MAX_EARLY)
    expect(earlyMultiplier(-1)).toBe(1)
  })
})

describe('convictionMultiplier', () => {
  it('vale 1 cuando todos tus votos fueron a la opción correcta', () => {
    expect(convictionMultiplier(1)).toBe(1)
  })

  it('penaliza a medias haber repartido los votos', () => {
    expect(convictionMultiplier(0.5)).toBeCloseTo(0.75, 5)
    expect(convictionMultiplier(0)).toBe(0.5)
  })
})

describe('calculatePoints', () => {
  it('da los puntos base en el caso más plano', () => {
    // Todos eligieron lo mismo, sobre el cierre, un solo voto.
    expect(
      calculatePoints({
        winnerShare: 1,
        sampleSize: 10,
        earlyRatio: 0,
        convictionRatio: 1,
      }),
    ).toBe(BASE_POINTS)
  })

  it('nunca supera el techo de 225 a la base de 100', () => {
    const max = calculatePoints({
      winnerShare: 0,
      sampleSize: 999,
      earlyRatio: 1,
      convictionRatio: 1,
    })
    expect(max).toBe(225)
    expect(max).toBe(Math.round(BASE_POINTS * MAX_RARITY * MAX_EARLY * 1))
  })

  it('el techo REAL, con la duración en su tope de 3×, es 675', () => {
    const scaledBase = Math.round(BASE_POINTS * MAX_DURATION)
    const max = calculatePoints({
      base: scaledBase,
      winnerShare: 0,
      sampleSize: 999,
      earlyRatio: 1,
      convictionRatio: 1,
    })
    expect(max).toBe(675)
    expect(max).toBe(Math.round(BASE_POINTS * MAX_DURATION * MAX_RARITY * MAX_EARLY * 1))
  })

  it('nunca devuelve puntos negativos', () => {
    expect(
      calculatePoints({
        base: -500,
        winnerShare: 0.5,
        sampleSize: 10,
        earlyRatio: 0.5,
        convictionRatio: 1,
      }),
    ).toBe(0)
  })

  it('reproduce el caso sembrado de «¿Quién llegó último al cumple de Lu?»', () => {
    // 5 votos totales, 2 a la opción ganadora, votó a 6 de 7 días del cierre.
    expect(
      calculatePoints({
        winnerShare: 2 / 5,
        sampleSize: 5,
        earlyRatio: 6 / 7,
        convictionRatio: 1,
      }),
    ).toBe(180)
  })

  it('paga menos a quien repartió sus votos entre varias opciones', () => {
    const sostuvo = calculatePoints({
      winnerShare: 0.4,
      sampleSize: 12,
      earlyRatio: 0.8,
      convictionRatio: 1,
    })
    const repartio = calculatePoints({
      winnerShare: 0.4,
      sampleSize: 12,
      earlyRatio: 0.8,
      convictionRatio: 0.4,
    })
    expect(repartio).toBeLessThan(sostuvo)
    expect(repartio).toBeGreaterThan(0)
  })

  it('devuelve enteros', () => {
    for (let share = 0; share <= 1; share += 0.07) {
      const points = calculatePoints({
        winnerShare: share,
        sampleSize: 9,
        earlyRatio: share,
        convictionRatio: 1 - share / 2,
      })
      expect(Number.isInteger(points)).toBe(true)
    }
  })
})

describe('durationMultiplier', () => {
  it('coincide con los puntos de referencia de la curva', () => {
    expect(durationMultiplier(1)).toBe(1.0)
    expect(durationMultiplier(10)).toBe(1.75)
    expect(durationMultiplier(100)).toBe(2.5)
    // round(1 + 0.75·log10(365), 2) = 2.92, no 2.93 — verificado también
    // contra Postgres en integration/scoring-parity.test.ts.
    expect(durationMultiplier(365)).toBe(2.92)
    expect(durationMultiplier(4000)).toBe(MAX_DURATION)
  })

  it('nunca baja de 1.00×, incluso con menos de un día', () => {
    expect(durationMultiplier(0.5)).toBe(1.0)
  })

  it('nunca supera el techo de 3.00×, ni con tramos absurdamente largos', () => {
    expect(durationMultiplier(100_000)).toBe(MAX_DURATION)
  })

  it('trata una entrada no finita como 1 día (1.00×), sin lanzar', () => {
    expect(durationMultiplier(Number.NaN)).toBe(1.0)
    expect(durationMultiplier(Number.POSITIVE_INFINITY)).toBe(1.0)
    expect(durationMultiplier(-5)).toBe(1.0)
  })
})

describe('explainScore', () => {
  it('desglosa el total en factores que multiplicados dan el mismo número', () => {
    const input = {
      winnerShare: 0.25,
      sampleSize: 8,
      earlyRatio: 0.6,
      convictionRatio: 0.75,
    }
    const breakdown = explainScore(input)

    expect(breakdown.total).toBe(calculatePoints(input))
    expect(breakdown.duration).toBe(1)
    expect(
      Math.round(
        breakdown.base * breakdown.rarity * breakdown.early * breakdown.conviction * breakdown.duration,
      ),
    ).toBe(breakdown.total)
  })

  it('con durationDays, el total refleja la base escalada', () => {
    const input = {
      winnerShare: 1,
      sampleSize: 10,
      earlyRatio: 0,
      convictionRatio: 1,
      durationDays: 100,
    }
    const breakdown = explainScore(input)

    expect(breakdown.duration).toBe(2.5)
    expect(breakdown.base).toBe(BASE_POINTS)
    // Base 100 × 2.5 = 250, sin rareza (sampleSize<4 no aplica acá; con
    // winnerShare 1 la rareza es 1 igual) ni anticipación (earlyRatio 0):
    // 250 × 1 × 1 × (0.5 + 0.5·1) = 250.
    expect(breakdown.total).toBe(250)
    expect(breakdown.total).not.toBe(calculatePoints(input))
  })
})

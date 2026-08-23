import { describe, expect, it } from 'vitest'
import {
  BASE_POINTS,
  MAX_EARLY,
  MAX_RARITY,
  RARITY_MIN_SAMPLE,
  calculatePoints,
  convictionMultiplier,
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

  it('nunca supera el techo de 225', () => {
    const max = calculatePoints({
      winnerShare: 0,
      sampleSize: 999,
      earlyRatio: 1,
      convictionRatio: 1,
    })
    expect(max).toBe(225)
    expect(max).toBe(Math.round(BASE_POINTS * MAX_RARITY * MAX_EARLY * 1))
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
    expect(
      Math.round(
        breakdown.base * breakdown.rarity * breakdown.early * breakdown.conviction,
      ),
    ).toBe(breakdown.total)
  })
})

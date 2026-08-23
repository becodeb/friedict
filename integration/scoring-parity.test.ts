import { describe, expect, it } from 'vitest'
import { calculatePoints } from '../src/lib/scoring'
import { sql } from './helpers'

/**
 * La fórmula de puntos vive dos veces: en `public.calculate_points()` —que es
 * la que reparte los puntos de verdad— y en `calculatePoints()` de TypeScript,
 * que se usa en los tests y para explicarle a la persona de dónde salieron.
 *
 * Duplicar lógica es aceptable sólo si algo garantiza que no se separen. Eso es
 * este test: recorre una grilla de casos y exige que ambas den EXACTAMENTE el
 * mismo entero, incluidos los bordes de redondeo.
 */
describe('paridad entre la fórmula SQL y la de TypeScript', () => {
  const shares = [0, 0.1, 0.25, 0.333, 0.4, 0.5, 0.666, 0.75, 0.9, 1]
  const samples = [0, 1, 3, 4, 5, 8, 12, 40]
  const earlies = [0, 0.25, 0.5, 0.857, 1]
  const convictions = [0.2, 0.4, 0.5, 0.75, 1]

  it('coincide en toda la grilla de combinaciones', async () => {
    const cases: Array<{
      winnerShare: number
      sampleSize: number
      earlyRatio: number
      convictionRatio: number
    }> = []

    for (const winnerShare of shares) {
      for (const sampleSize of samples) {
        for (const earlyRatio of earlies) {
          for (const convictionRatio of convictions) {
            cases.push({ winnerShare, sampleSize, earlyRatio, convictionRatio })
          }
        }
      }
    }

    // Una sola consulta con todos los casos: 2000 round-trips serían absurdos.
    const rows = (await sql(
      `select
         c.i,
         public.calculate_points(100, c.share, c.sample, c.early, c.conviction) as points
       from unnest(
              $1::numeric[], $2::int[], $3::numeric[], $4::numeric[]
            ) with ordinality as c(share, sample, early, conviction, i)`,
      [
        cases.map((c) => c.winnerShare),
        cases.map((c) => c.sampleSize),
        cases.map((c) => c.earlyRatio),
        cases.map((c) => c.convictionRatio),
      ],
    )) as Array<{ i: string; points: number }>

    expect(rows).toHaveLength(cases.length)

    const mismatches: string[] = []
    for (const row of rows) {
      const index = Number(row.i) - 1
      const input = cases[index]!
      const ts = calculatePoints(input)
      if (ts !== row.points) {
        mismatches.push(
          `share=${input.winnerShare} n=${input.sampleSize} early=${input.earlyRatio} ` +
            `conv=${input.convictionRatio} → SQL ${row.points} vs TS ${ts}`,
        )
      }
    }

    expect(mismatches).toEqual([])
  })

  it('coincide también en los bordes de redondeo (.5 exactos)', async () => {
    // Combinaciones elegidas para caer justo sobre un medio punto.
    const edge = [
      { winnerShare: 0.5, sampleSize: 4, earlyRatio: 0, convictionRatio: 0.5 },
      { winnerShare: 0.375, sampleSize: 8, earlyRatio: 0, convictionRatio: 1 },
      { winnerShare: 0.75, sampleSize: 8, earlyRatio: 0.5, convictionRatio: 0.5 },
      { winnerShare: 0.625, sampleSize: 8, earlyRatio: 1, convictionRatio: 1 },
    ]

    for (const input of edge) {
      const rows = (await sql(
        'select public.calculate_points(100, $1, $2, $3, $4) as points',
        [input.winnerShare, input.sampleSize, input.earlyRatio, input.convictionRatio],
      )) as Array<{ points: number }>

      expect(rows[0]!.points).toBe(calculatePoints(input))
    }
  })

  it('ninguna de las dos devuelve puntos negativos ni supera el techo', async () => {
    const rows = (await sql(`
      select
        min(public.calculate_points(100, s, 10, e, c)) as minimo,
        max(public.calculate_points(100, s, 10, e, c)) as maximo
      from generate_series(0, 1, 0.1) as s,
           generate_series(0, 1, 0.25) as e,
           generate_series(0, 1, 0.25) as c
    `)) as Array<{ minimo: number; maximo: number }>

    expect(rows[0]!.minimo).toBeGreaterThanOrEqual(0)
    expect(rows[0]!.maximo).toBeLessThanOrEqual(225)
  })
})

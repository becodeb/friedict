import { describe, expect, it } from 'vitest'
import { calculatePoints, durationMultiplier } from '../src/lib/scoring'
import { createUser, sql, type TestUser } from './helpers'

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

/**
 * `duration_multiplier` es la mitad "por cuánto duró" del cambio: escala la
 * BASE que recibe `calculate_points`, así que la grilla de arriba —que sigue
 * llamando con un 100 fijo— queda intacta y sigue probando que
 * `calculate_points` no se movió. Este bloque es nuevo, no un reemplazo.
 */
describe('public.duration_multiplier', () => {
  it('es immutable', async () => {
    const rows = (await sql(
      `select provolatile from pg_proc where proname = 'duration_multiplier'`,
    )) as Array<{ provolatile: string }>
    expect(rows[0]!.provolatile).toBe('i')
  })

  it('coincide con la curva de referencia y con el mirror de TypeScript', async () => {
    // 1 día → piso 1.00×; 10 → 1.75×; 100 → 2.50×; 365 → 2.92× (no 2.93: el
    // valor real de round(1 + 0.75·log10(365), 2) — verificado tanto acá
    // contra Postgres como en durationMultiplier() — es 2.92); 4000 → techo
    // 3.00×.
    const days = [1, 10, 100, 365, 4000]
    const expected = [1.0, 1.75, 2.5, 2.92, 3.0]

    const rows = (await sql(
      `select d, public.duration_multiplier((d || ' days')::interval) as m
         from unnest($1::int[]) as d`,
      [days],
    )) as Array<{ d: number; m: string }>

    for (const row of rows) {
      const index = days.indexOf(row.d)
      expect(Number(row.m)).toBeCloseTo(expected[index]!, 2)
      expect(Number(row.m)).toBeCloseTo(durationMultiplier(row.d), 2)
    }
  })

  it('nunca baja de 1.00× para tramos de menos de un día', async () => {
    const rows = (await sql(`select public.duration_multiplier(interval '3 hours') as m`)) as Array<{
      m: string
    }>
    expect(Number(rows[0]!.m)).toBe(1.0)
  })

  it('score_prediction escala la base por duración y guarda el multiplicador', async () => {
    const owner = await createUser('dur-owner')
    const { data: group } = await owner.client.rpc('create_group', {
      p_name: 'Duración',
      p_display_name: 'Owner',
    })
    const groupId = (group as unknown as { id: string }).id
    const { data: invite } = await owner.client.rpc('create_invite', {
      p_group_id: groupId,
      p_expires_in: '7 days',
    })
    const token = (invite as unknown as { token: string }).token
    const mate: TestUser = await createUser('dur-mate')
    await mate.client.rpc('join_group', { p_token: token, p_display_name: 'Mate' })

    const shortLived = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Dura poco?',
      p_options: ['Sí', 'No'],
    })
    const longLived = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Dura mucho?',
      p_options: ['Sí', 'No'],
    })
    const shortId = shortLived.data as unknown as string
    const longId = longLived.data as unknown as string

    // La "larga" arrancó hace 100 días: opens_at se corre hacia atrás para
    // simular el tramo real sin esperar de verdad.
    await sql(`update public.predictions set opens_at = opens_at - interval '100 days' where id = $1`, [
      longId,
    ])

    for (const [id, actor] of [
      [shortId, owner],
      [longId, owner],
    ] as const) {
      const options = (await sql(
        'select id from public.prediction_options where prediction_id = $1 order by position',
        [id],
      )) as Array<{ id: string }>
      await actor.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })
      await mate.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })
      await sql("update public.predictions set status = 'closed', closed_at = now() where id = $1", [id])
      const { data: resolutionId } = await owner.client.rpc('propose_resolution', {
        p_prediction_id: id,
        p_option_id: options[0]!.id,
      })
      await mate.client.rpc('confirm_resolution', {
        p_resolution_id: resolutionId as unknown as string,
        p_agrees: true,
      })
    }

    const scores = (await sql(
      `select prediction_id, points, duration_multiplier
         from public.prediction_scores
        where prediction_id in ($1, $2) and user_id = $3`,
      [shortId, longId, owner.id],
    )) as Array<{ prediction_id: string; points: number; duration_multiplier: string }>

    const short = scores.find((s) => s.prediction_id === shortId)!
    const long = scores.find((s) => s.prediction_id === longId)!

    expect(Number(short.duration_multiplier)).toBeCloseTo(1.0, 2)
    expect(Number(long.duration_multiplier)).toBeCloseTo(2.5, 2)
    expect(long.points).toBeGreaterThan(short.points)
  })
})

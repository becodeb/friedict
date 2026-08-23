import { beforeAll, describe, expect, it } from 'vitest'
import {
  createUser,
  finalize,
  predictionStatus,
  sql,
  timeTravel,
  type TestUser,
} from './helpers'

/**
 * El ciclo de vida completo, contra la base real.
 *
 * Crear cuenta → crear grupo → invitar → sumarse → crear predicción → votar →
 * alcanzar el umbral → cerrar → proponer resultado → confirmar → puntos →
 * ranking.
 *
 * Todas las aserciones importantes miran el estado DESPUÉS de que el servidor
 * hizo lo suyo. Que la UI deshabilite un botón no prueba nada.
 */
async function optionsOf(predictionId: string): Promise<Array<{ id: string; label: string }>> {
  return (await sql(
    'select id, label from public.prediction_options where prediction_id = $1 order by position',
    [predictionId],
  )) as Array<{ id: string; label: string }>
}

const inFuture = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000).toISOString()

describe('ciclo de vida completo', () => {
  let ana: TestUser
  let beto: TestUser
  let cami: TestUser
  let dani: TestUser
  let groupId: string
  let token: string

  beforeAll(async () => {
    ;[ana, beto, cami, dani] = await Promise.all([
      createUser('ana'),
      createUser('beto'),
      createUser('cami'),
      createUser('dani'),
    ])
  })

  it('crea un grupo y deja a quien lo creó como owner', async () => {
    const { data, error } = await ana.client.rpc('create_group', {
      p_name: 'Bariloche 2027',
      p_display_name: 'Ana',
      p_accent: 2,
    })
    expect(error).toBeNull()

    groupId = (data as unknown as { id: string }).id
    expect(groupId).toBeTruthy()

    const members = (await sql(
      'select role from public.group_members where group_id = $1',
      [groupId],
    )) as Array<{ role: string }>
    expect(members).toEqual([{ role: 'owner' }])
  })

  it('genera un link de invitación impredecible', async () => {
    const { data, error } = await ana.client.rpc('create_invite', {
      p_group_id: groupId,
      p_expires_in: '7 days',
    })
    expect(error).toBeNull()

    const invite = data as unknown as { token: string; expires_at: string }
    token = invite.token

    expect(token).toHaveLength(32)
    expect(token).toMatch(/^[a-z2-9]+$/)
    expect(new Date(invite.expires_at).getTime()).toBeGreaterThan(Date.now())
  })

  it('deja ver el grupo detrás de un link válido, incluso sin ser integrante', async () => {
    const { data } = await beto.client.rpc('peek_invite', { p_token: token })
    const preview = data as unknown as { valid: boolean; group_name: string }

    expect(preview.valid).toBe(true)
    expect(preview.group_name).toBe('Bariloche 2027')
  })

  it('devuelve exactamente lo mismo para un token inventado: no filtra si el grupo existe', async () => {
    const { data } = await beto.client.rpc('peek_invite', {
      p_token: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
    })
    expect(data).toEqual({ valid: false })
  })

  it('rechaza una invitación vencida', async () => {
    const { data: expiredData } = await ana.client.rpc('create_invite', {
      p_group_id: groupId,
      p_expires_in: '1 second',
    })
    const expired = expiredData as unknown as { id: string; token: string }
    await sql('update public.group_invites set expires_at = now() - interval $1 where id = $2', [
      '1 hour',
      expired.id,
    ]).catch(async () => {
      await sql(
        "update public.group_invites set expires_at = now() - interval '1 hour' where id = $1",
        [expired.id],
      )
    })

    const { data } = await beto.client.rpc('peek_invite', { p_token: expired.token })
    expect(data).toEqual({ valid: false })

    const { error } = await beto.client.rpc('join_group', {
      p_token: expired.token,
      p_display_name: 'Beto',
    })
    expect(error?.message).toContain('invalid_invite')
  })

  it('suma a tres personas con el mismo link', async () => {
    for (const [user, name] of [
      [beto, 'Beto'],
      [cami, 'Cami'],
      [dani, 'Dani'],
    ] as const) {
      const { error } = await user.client.rpc('join_group', {
        p_token: token,
        p_display_name: name,
        p_accent: 1,
      })
      expect(error).toBeNull()
    }

    const rows = (await sql(
      'select count(*)::int as n from public.group_members where group_id = $1',
      [groupId],
    )) as Array<{ n: number }>
    expect(rows[0]!.n).toBe(4)
  })

  it('entrar dos veces con el mismo link no duplica la membresía', async () => {
    await beto.client.rpc('join_group', { p_token: token, p_display_name: 'Beto' })

    const rows = (await sql(
      'select count(*)::int as n from public.group_members where group_id = $1 and user_id = $2',
      [groupId, beto.id],
    )) as Array<{ n: number }>
    expect(rows[0]!.n).toBe(1)
  })

  it('revocar el link lo invalida al instante', async () => {
    const { data } = await ana.client.rpc('create_invite', {
      p_group_id: groupId,
      p_expires_in: '7 days',
    })
    const invite = data as unknown as { id: string; token: string }

    await ana.client.rpc('revoke_invite', { p_invite_id: invite.id })

    const { data: preview } = await beto.client.rpc('peek_invite', {
      p_token: invite.token,
    })
    expect(preview).toEqual({ valid: false })
  })

  // -------------------------------------------------------------------------
  // Umbral de participación
  // -------------------------------------------------------------------------
  describe('el umbral de las 3 personas', () => {
    let predictionId: string

    it('una predicción nueva arranca en prueba', async () => {
      const { data, error } = await ana.client.rpc('create_prediction', {
        p_group_id: groupId,
        p_title: '¿Quién se olvida el pasaporte?',
        p_options: ['Ana', 'Beto', 'Cami', 'Dani'],
        p_closes_at: inFuture(72),
        p_qualification_hours: 48,
      })
      expect(error).toBeNull()

      predictionId = data as unknown as string
      expect(await predictionStatus(predictionId)).toBe('proposed')
    })

    it('el cliente NO puede fabricar una predicción del sistema', async () => {
      // `p_is_default` no existe en la firma pública: mandarlo es un error, no
      // un atajo para saltearse el umbral.
      const { error } = await ana.client.rpc('create_prediction', {
        p_group_id: groupId,
        p_title: 'Intento de colarse como del sistema',
        p_options: ['Sí', 'No'],
        p_closes_at: inFuture(48),
        p_is_default: true,
      } as never)
      expect(error).not.toBeNull()

      const rows = (await sql(
        'select count(*)::int as n from public.predictions where group_id = $1 and is_default',
        [groupId],
      )) as Array<{ n: number }>
      expect(rows[0]!.n).toBe(0)
    })

    it('el cliente tampoco puede bajarse el umbral a 1', async () => {
      const { data } = await ana.client.rpc('create_prediction', {
        p_group_id: groupId,
        p_title: '¿Me auto-califico con mi propio voto?',
        p_options: ['Sí', 'No'],
        p_closes_at: inFuture(48),
        p_minimum_participants: 1,
      })

      const rows = (await sql(
        'select minimum_participants from public.predictions where id = $1',
        [data as unknown as string],
      )) as Array<{ minimum_participants: number }>
      expect(rows[0]!.minimum_participants).toBe(3)
    })

    it('sigue en prueba con 1 y con 2 participantes', async () => {
      const options = await optionsOf(predictionId)

      await beto.client.rpc('cast_vote', {
        p_prediction_id: predictionId,
        p_option_id: options[0]!.id,
      })
      expect(await predictionStatus(predictionId)).toBe('proposed')

      await cami.client.rpc('cast_vote', {
        p_prediction_id: predictionId,
        p_option_id: options[1]!.id,
      })
      expect(await predictionStatus(predictionId)).toBe('proposed')
    })

    it('cambiar el voto NO suma un participante nuevo', async () => {
      const options = await optionsOf(predictionId)

      await beto.client.rpc('cast_vote', {
        p_prediction_id: predictionId,
        p_option_id: options[2]!.id,
      })

      const rows = (await sql(
        'select participant_count, vote_count from public.predictions where id = $1',
        [predictionId],
      )) as Array<{ participant_count: number; vote_count: number }>

      expect(rows[0]!.participant_count).toBe(2)
      expect(rows[0]!.vote_count).toBe(2)
      expect(await predictionStatus(predictionId)).toBe('proposed')
    })

    it('con la tercera persona queda confirmada', async () => {
      const options = await optionsOf(predictionId)

      const { data } = await dani.client.rpc('cast_vote', {
        p_prediction_id: predictionId,
        p_option_id: options[0]!.id,
      })
      const result = data as unknown as { status: string; participant_count: number }

      expect(result.participant_count).toBe(3)
      expect(result.status).toBe('active')
      expect(await predictionStatus(predictionId)).toBe('active')
    })

    it('deja registrado el momento en que quedó', async () => {
      const events = (await sql(
        `select type from public.activity_events
          where prediction_id = $1 and type = 'prediction_qualified'`,
        [predictionId],
      )) as unknown[]
      expect(events).toHaveLength(1)
    })
  })

  it('una predicción con 2 votantes expira al vencer el plazo', async () => {
    const { data } = await ana.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Alguien lee los términos y condiciones?',
      p_options: ['Sí', 'No'],
      p_closes_at: inFuture(72),
      p_qualification_hours: 48,
    })
    const predictionId = data as unknown as string
    const options = await optionsOf(predictionId)

    await beto.client.rpc('cast_vote', {
      p_prediction_id: predictionId,
      p_option_id: options[0]!.id,
    })
    await cami.client.rpc('cast_vote', {
      p_prediction_id: predictionId,
      p_option_id: options[1]!.id,
    })

    expect(await predictionStatus(predictionId)).toBe('proposed')

    await timeTravel(predictionId, '3 days')
    await finalize()

    expect(await predictionStatus(predictionId)).toBe('expired')
  })

  it('una predicción del sistema NO expira por falta de participación', async () => {
    const templates = (await sql(
      'select id from public.prediction_templates order by sort_order limit 1',
    )) as Array<{ id: string }>

    const { data, error } = await ana.client.rpc('create_prediction_from_template', {
      p_group_id: groupId,
      p_template_id: templates[0]!.id,
      p_closes_at: inFuture(72),
    })
    expect(error).toBeNull()

    const predictionId = data as unknown as string
    expect(await predictionStatus(predictionId)).toBe('active')

    // Sin un solo voto y con el plazo vencido, sigue viva.
    await timeTravel(predictionId, '3 days')
    await finalize()

    const rows = (await sql(
      'select status, participant_count, is_default from public.predictions where id = $1',
      [predictionId],
    )) as Array<{ status: string; participant_count: number; is_default: boolean }>

    expect(rows[0]!.participant_count).toBe(0)
    expect(rows[0]!.is_default).toBe(true)
    expect(rows[0]!.status).not.toBe('expired')
  })

  // -------------------------------------------------------------------------
  // Votación evolutiva
  // -------------------------------------------------------------------------
  it('en una evolutiva sólo se puede votar una vez por ronda, y el historial queda', async () => {
    const { data } = await ana.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Quién reserva primero?',
      p_options: ['Ana', 'Beto', 'Cami'],
      p_closes_at: inFuture(24 * 90),
      p_voting_mode: 'recurring',
      p_vote_interval: '7 days',
      p_results_visibility: 'always',
    })
    const predictionId = data as unknown as string
    const options = await optionsOf(predictionId)

    // Ronda 0. Votan tres para que supere el umbral: si no, al adelantar el
    // reloj más abajo expiraría —correctamente— por falta de participación.
    const first = await beto.client.rpc('cast_vote', {
      p_prediction_id: predictionId,
      p_option_id: options[0]!.id,
    })
    expect(first.error).toBeNull()
    expect((first.data as unknown as { cycle: number }).cycle).toBe(0)

    await cami.client.rpc('cast_vote', {
      p_prediction_id: predictionId,
      p_option_id: options[1]!.id,
    })
    await dani.client.rpc('cast_vote', {
      p_prediction_id: predictionId,
      p_option_id: options[0]!.id,
    })
    expect(await predictionStatus(predictionId)).toBe('active')

    // Segundo voto en la MISMA ronda: bloqueado por la base.
    const second = await beto.client.rpc('cast_vote', {
      p_prediction_id: predictionId,
      p_option_id: options[1]!.id,
    })
    expect(second.error?.message).toContain('cycle_vote_used')

    // Pasa una semana: se habilita un voto nuevo, sin borrar el anterior.
    await timeTravel(predictionId, '8 days')

    const third = await beto.client.rpc('cast_vote', {
      p_prediction_id: predictionId,
      p_option_id: options[1]!.id,
    })
    expect(third.error).toBeNull()
    expect((third.data as unknown as { cycle: number }).cycle).toBe(1)

    const votes = (await sql(
      'select cycle, option_id from public.prediction_votes where prediction_id = $1 and user_id = $2 order by cycle',
      [predictionId, beto.id],
    )) as Array<{ cycle: number; option_id: string }>

    expect(votes).toHaveLength(2)
    expect(votes[0]!.option_id).toBe(options[0]!.id)
    expect(votes[1]!.option_id).toBe(options[1]!.id)
  })

  // -------------------------------------------------------------------------
  // Cierre y resolución
  // -------------------------------------------------------------------------
  describe('cierre y resolución comunitaria', () => {
    let predictionId: string
    let options: Array<{ id: string; label: string }>
    let resolutionId: string

    it('cierra sola al llegar la fecha y bloquea los votos', async () => {
      const { data } = await ana.client.rpc('create_prediction', {
        p_group_id: groupId,
        p_title: '¿Quién maneja en la ruta?',
        p_options: ['Ana', 'Beto', 'Cami', 'Dani'],
        p_closes_at: inFuture(48),
        p_qualification_hours: 24,
      })
      predictionId = data as unknown as string
      options = await optionsOf(predictionId)

      for (const [user, index] of [
        [beto, 0],
        [cami, 0],
        [dani, 1],
        [ana, 2],
      ] as const) {
        await user.client.rpc('cast_vote', {
          p_prediction_id: predictionId,
          p_option_id: options[index]!.id,
        })
      }
      expect(await predictionStatus(predictionId)).toBe('active')

      await timeTravel(predictionId, '3 days')
      await finalize()
      expect(await predictionStatus(predictionId)).toBe('closed')

      const { error } = await beto.client.rpc('cast_vote', {
        p_prediction_id: predictionId,
        p_option_id: options[3]!.id,
      })
      expect(error?.message).toContain('voting_closed')
    })

    it('un integrante común no puede proponer el resultado', async () => {
      const { error } = await dani.client.rpc('propose_resolution', {
        p_prediction_id: predictionId,
        p_option_id: options[0]!.id,
      })
      expect(error?.message).toContain('not_allowed')
    })

    it('quien la creó propone y la predicción pasa a resolviéndose', async () => {
      const { data, error } = await ana.client.rpc('propose_resolution', {
        p_prediction_id: predictionId,
        p_option_id: options[0]!.id,
      })
      expect(error).toBeNull()

      resolutionId = data as unknown as string
      expect(await predictionStatus(predictionId)).toBe('resolving')
    })

    it('quien propone NO puede confirmarse a sí mismo', async () => {
      const { error } = await ana.client.rpc('confirm_resolution', {
        p_resolution_id: resolutionId,
        p_agrees: true,
      })
      expect(error?.message).toContain('proposer_cannot_confirm')
      expect(await predictionStatus(predictionId)).toBe('resolving')
    })

    it('una sola confirmación no alcanza', async () => {
      const { data } = await beto.client.rpc('confirm_resolution', {
        p_resolution_id: resolutionId,
        p_agrees: true,
      })
      expect((data as unknown as { outcome: string }).outcome).toBe('pending')
      expect(await predictionStatus(predictionId)).toBe('resolving')
    })

    it('nadie confirma dos veces', async () => {
      const { error } = await beto.client.rpc('confirm_resolution', {
        p_resolution_id: resolutionId,
        p_agrees: true,
      })
      expect(error?.message).toContain('already_confirmed')
    })

    it('con la segunda confirmación queda resuelta', async () => {
      const { data } = await cami.client.rpc('confirm_resolution', {
        p_resolution_id: resolutionId,
        p_agrees: true,
      })
      expect((data as unknown as { outcome: string }).outcome).toBe('resolved')
      expect(await predictionStatus(predictionId)).toBe('resolved')
    })

    it('reparte puntos sólo a quienes acertaron, y nunca negativos', async () => {
      const scores = (await sql(
        `select p.display_name, s.points, s.correct
           from public.prediction_scores s
           join public.profiles p on p.id = s.user_id
          where s.prediction_id = $1
          order by s.points desc`,
        [predictionId],
      )) as Array<{ display_name: string; points: number; correct: boolean }>

      expect(scores).toHaveLength(4)
      for (const score of scores) {
        expect(score.points).toBeGreaterThanOrEqual(0)
        expect(score.correct ? score.points : 0).toBe(score.points)
      }

      // Beto y Cami eligieron la opción 0, que fue la ganadora.
      const winners = scores.filter((s) => s.correct).map((s) => s.display_name).sort()
      expect(winners).toEqual(['Beto', 'Cami'])
    })

    it('el ranking del grupo refleja los puntos', async () => {
      const { data, error } = await ana.client
        .from('group_leaderboard')
        .select('display_name, points, hits, position')
        .eq('group_id', groupId)
        .order('position', { ascending: true })

      expect(error).toBeNull()
      expect(data!.length).toBe(4)
      expect(data![0]!.points).toBeGreaterThan(0)
      expect(data![0]!.hits).toBe(1)
    })

    it('una propuesta rechazada por dos personas se cae y habilita otra', async () => {
      const { data } = await ana.client.rpc('create_prediction', {
        p_group_id: groupId,
        p_title: '¿Llegamos antes del mediodía?',
        p_options: ['Sí', 'No'],
        p_closes_at: inFuture(24),
      })
      const disputed = data as unknown as string
      const disputedOptions = await optionsOf(disputed)

      for (const user of [beto, cami, dani]) {
        await user.client.rpc('cast_vote', {
          p_prediction_id: disputed,
          p_option_id: disputedOptions[0]!.id,
        })
      }
      await timeTravel(disputed, '2 days')
      await finalize()

      const { data: proposalId } = await ana.client.rpc('propose_resolution', {
        p_prediction_id: disputed,
        p_option_id: disputedOptions[1]!.id,
      })

      await beto.client.rpc('confirm_resolution', {
        p_resolution_id: proposalId as unknown as string,
        p_agrees: false,
      })
      const { data: outcome } = await cami.client.rpc('confirm_resolution', {
        p_resolution_id: proposalId as unknown as string,
        p_agrees: false,
      })

      expect((outcome as unknown as { outcome: string }).outcome).toBe('rejected')
      expect(await predictionStatus(disputed)).toBe('closed')

      // Y ahora cualquier integrante puede proponer, no sólo quien la creó.
      const { error } = await dani.client.rpc('propose_resolution', {
        p_prediction_id: disputed,
        p_option_id: disputedOptions[0]!.id,
      })
      expect(error).toBeNull()
    })
  })

  it('rate limiting: crear grupos sin parar termina cortado', async () => {
    const victim = await createUser('spam')
    const results: Array<string | null> = []

    for (let i = 0; i < 8; i++) {
      const { error } = await victim.client.rpc('create_group', {
        p_name: `Grupo ${i}`,
        p_display_name: 'Spam',
      })
      results.push(error?.message ?? null)
    }

    expect(results.filter((r) => r === null).length).toBeLessThanOrEqual(5)
    expect(results.some((r) => r?.includes('rate_limited'))).toBe(true)
  })
})

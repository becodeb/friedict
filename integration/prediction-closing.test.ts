import { describe, expect, it } from 'vitest'
import { createUser, sql, finalize, type TestUser } from './helpers'

/**
 * Cierre colaborativo: predicciones sin fecha de cierre (`closes_at` nulo) que
 * cierran cuando el grupo lo pide, con quórum sobre los pedidos.
 *
 * Cubre además el arreglo de `score_prediction`: `greatest()` ignora NULLs, así
 * que sin este fix una predicción abierta le daba a todo el mundo el máximo
 * multiplicador de anticipación.
 */
async function makeGroup(prefix: string, members: number): Promise<{ owner: TestUser; groupId: string; mates: TestUser[] }> {
  const owner = await createUser(`${prefix}-o`)
  const { data } = await owner.client.rpc('create_group', {
    p_name: `${prefix} grupo`,
    p_display_name: 'Owner',
  })
  const groupId = (data as unknown as { id: string }).id

  const { data: invite } = await owner.client.rpc('create_invite', {
    p_group_id: groupId,
    p_expires_in: '7 days',
  })
  const token = (invite as unknown as { token: string }).token

  const mates: TestUser[] = []
  for (let i = 0; i < members - 1; i++) {
    const mate = await createUser(`${prefix}-m${i}`)
    await mate.client.rpc('join_group', { p_token: token, p_display_name: `Mate${i}` })
    mates.push(mate)
  }
  return { owner, groupId, mates }
}

async function optionsOf(predictionId: string): Promise<Array<{ id: string }>> {
  return (await sql(
    'select id from public.prediction_options where prediction_id = $1 order by position',
    [predictionId],
  )) as Array<{ id: string }>
}

describe('grants de las funciones nuevas', () => {
  it('required_participants, required_close_requests, request_close y withdraw_close_request son ejecutables por authenticated', async () => {
    const rows = (await sql(`
      select p.proname,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as ok
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('required_participants', 'required_close_requests', 'request_close', 'withdraw_close_request')
    `)) as Array<{ proname: string; ok: boolean }>

    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(row.ok, `${row.proname} debería ser ejecutable por authenticated`).toBe(true)
    }
  })

  it('group_member_count NO es un endpoint: nadie lo puede llamar por la API', async () => {
    const rows = (await sql(`
      select has_function_privilege('authenticated', p.oid, 'EXECUTE') as ok
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'group_member_count'
    `)) as Array<{ ok: boolean }>
    expect(rows[0]!.ok).toBe(false)
  })
})

describe('predicciones sin fecha de cierre', () => {
  it('la creación acepta p_closes_at nulo y la votación queda abierta', async () => {
    const { owner, groupId, mates } = await makeGroup('open', 2)
    const { data: predictionId, error } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Cuándo se termina esto?',
      p_options: ['Pronto', 'Nunca'],
    })
    expect(error).toBeNull()

    const row = (await sql('select closes_at from public.predictions where id = $1', [
      predictionId as unknown as string,
    ])) as Array<{ closes_at: string | null }>
    expect(row[0]!.closes_at).toBeNull()

    const options = await optionsOf(predictionId as unknown as string)
    const { error: voteError } = await mates[0]!.client.rpc('cast_vote', {
      p_prediction_id: predictionId as unknown as string,
      p_option_id: options[0]!.id,
    })
    expect(voteError).toBeNull()
  })

  it('pedir el cierre sin haber votado se rechaza con must_vote_first', async () => {
    const { owner, groupId, mates } = await makeGroup('mustvote', 2)
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Hace falta haber votado?',
      p_options: ['Sí', 'No'],
      p_close_percent: 50,
    })

    const { error } = await mates[0]!.client.rpc('request_close', {
      p_prediction_id: predictionId as unknown as string,
    })
    expect(error?.message).toContain('must_vote_first')
  })

  it('la base rechaza una evolutiva cuyo intervalo no entra antes del cierre', async () => {
    const { owner, groupId } = await makeGroup('interval-window', 2)

    // El cliente ya lo valida con Zod, pero cualquiera puede pegarle al RPC
    // directo: la regla tiene que vivir también en la base.
    const { error } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Entra una ronda de 30 días en 2?',
      p_options: ['Sí', 'No'],
      p_closes_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      p_voting_mode: 'recurring',
      p_vote_interval: '30 days',
    })
    expect(error?.message).toContain('interval_exceeds_window')
  })

  it('sin fecha de cierre, una evolutiva acepta cualquier intervalo', async () => {
    const { owner, groupId } = await makeGroup('interval-open', 2)

    // No hay ventana que respetar: las rondas siguen hasta que alguien pida
    // cerrar, así que la validación anterior no debe dispararse.
    const { data, error } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Sigue rondando sin fecha?',
      p_options: ['Sí', 'No'],
      p_voting_mode: 'recurring',
      p_vote_interval: '30 days',
    })
    expect(error).toBeNull()
    expect(data).toBeTruthy()
  })

  it('alcanzar el quórum de cierre cierra en la MISMA transacción que la solicitud', async () => {
    const { owner, groupId, mates } = await makeGroup('quorum-close', 2)
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Cierra apenas alcanza el quórum?',
      p_options: ['Sí', 'No'],
      p_close_percent: 100,
    })
    const options = await optionsOf(predictionId as unknown as string)

    await owner.client.rpc('cast_vote', {
      p_prediction_id: predictionId as unknown as string,
      p_option_id: options[0]!.id,
    })
    await mates[0]!.client.rpc('cast_vote', {
      p_prediction_id: predictionId as unknown as string,
      p_option_id: options[1]!.id,
    })

    const { data: first } = await owner.client.rpc('request_close', {
      p_prediction_id: predictionId as unknown as string,
    })
    expect((first as unknown as { closed: boolean }).closed).toBe(false)

    // Con 100% de close_percent en un grupo de 2, el segundo pedido completa
    // el quórum: la fila tiene que estar cerrada en el valor QUE DEVUELVE esta
    // misma llamada, antes de que corra ningún finalize_predictions.
    const { data: second } = await mates[0]!.client.rpc('request_close', {
      p_prediction_id: predictionId as unknown as string,
    })
    expect((second as unknown as { closed: boolean }).closed).toBe(true)

    const row = (await sql('select status, closed_at from public.predictions where id = $1', [
      predictionId as unknown as string,
    ])) as Array<{ status: string; closed_at: string | null }>
    expect(row[0]!.status).toBe('closed')
    expect(row[0]!.closed_at).not.toBeNull()
  })

  it('retirar el pedido baja el conteo y nunca reabre una predicción ya cerrada', async () => {
    const { owner, groupId, mates } = await makeGroup('withdraw', 2)
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Se puede retirar el pedido?',
      p_options: ['Sí', 'No'],
      p_close_percent: 100,
    })
    const options = await optionsOf(predictionId as unknown as string)

    await owner.client.rpc('cast_vote', {
      p_prediction_id: predictionId as unknown as string,
      p_option_id: options[0]!.id,
    })
    await mates[0]!.client.rpc('cast_vote', {
      p_prediction_id: predictionId as unknown as string,
      p_option_id: options[1]!.id,
    })

    await owner.client.rpc('request_close', { p_prediction_id: predictionId as unknown as string })

    const { data: withdrawn } = await owner.client.rpc('withdraw_close_request', {
      p_prediction_id: predictionId as unknown as string,
    })
    expect((withdrawn as unknown as { requests: number }).requests).toBe(0)

    const row = (await sql('select status from public.predictions where id = $1', [
      predictionId as unknown as string,
    ])) as Array<{ status: string }>
    expect(row[0]!.status).not.toBe('closed')

    // Cerrar la predicción "a mano" para probar que retirar el pedido después
    // de cerrada no la reabre.
    await sql("update public.predictions set status = 'closed', closed_at = now() where id = $1", [
      predictionId as unknown as string,
    ])
    await owner.client.rpc('request_close', { p_prediction_id: predictionId as unknown as string })
    const { error } = await owner.client.rpc('withdraw_close_request', {
      p_prediction_id: predictionId as unknown as string,
    })
    expect(error?.message).toContain('voting_closed')

    const stillClosed = (await sql('select status from public.predictions where id = $1', [
      predictionId as unknown as string,
    ])) as Array<{ status: string }>
    expect(stillClosed[0]!.status).toBe('closed')
  })

  it('un integrante que se va baja el requisito y finalize_predictions cierra la predicción', async () => {
    const { owner, groupId, mates } = await makeGroup('leave-close', 3)
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Se cierra al bajar el quórum?',
      p_options: ['Sí', 'No'],
      p_close_percent: 100,
    })
    const options = await optionsOf(predictionId as unknown as string)

    for (const voter of [owner, mates[0]!, mates[1]!]) {
      await voter.client.rpc('cast_vote', {
        p_prediction_id: predictionId as unknown as string,
        p_option_id: options[0]!.id,
      })
    }

    // Los tres piden el cierre, pero con 3 integrantes el 100% pide 3 y sólo
    // llegan 2: no alcanza todavía.
    await owner.client.rpc('request_close', { p_prediction_id: predictionId as unknown as string })
    const { data: partial } = await mates[0]!.client.rpc('request_close', {
      p_prediction_id: predictionId as unknown as string,
    })
    expect((partial as unknown as { closed: boolean }).closed).toBe(false)

    await mates[1]!.client.rpc('leave_group', { p_group_id: groupId })

    await finalize()

    const row = (await sql('select status from public.predictions where id = $1', [
      predictionId as unknown as string,
    ])) as Array<{ status: string }>
    expect(row[0]!.status).toBe('closed')
  })

  it('score_prediction no le da a todo el mundo la anticipación máxima cuando closes_at es NULL', async () => {
    const { owner, groupId, mates } = await makeGroup('scoring-open', 2)
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿La anticipación es NULL-safe?',
      p_options: ['Sí', 'No'],
      p_close_percent: 100,
    })
    const options = await optionsOf(predictionId as unknown as string)
    const id = predictionId as unknown as string

    // Un voto justo al abrir y otro mucho más tarde: con el bug de
    // `greatest()` ignorando NULLs, los dos recibirían earliness = 1.
    await owner.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })
    await sql(
      "update public.prediction_votes set created_at = (select opens_at from public.predictions where id = $1) where prediction_id = $1 and user_id = $2",
      [id, owner.id],
    )

    await mates[0]!.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })

    // Cierra manualmente, resuelve y puntúa.
    await sql("update public.predictions set status = 'closed', closed_at = now() where id = $1", [id])
    await owner.client.rpc('propose_resolution', { p_prediction_id: id, p_option_id: options[0]!.id })
    const resolution = (await sql(
      "select id from public.prediction_resolutions where prediction_id = $1 and status = 'proposed'",
      [id],
    )) as Array<{ id: string }>
    await mates[0]!.client.rpc('confirm_resolution', {
      p_resolution_id: resolution[0]!.id,
      p_agrees: true,
    })

    const scores = (await sql(
      'select user_id, early_multiplier from public.prediction_scores where prediction_id = $1 order by early_multiplier desc',
      [id],
    )) as Array<{ user_id: string; early_multiplier: string }>

    expect(scores).toHaveLength(2)
    // `numeric` viaja como string por el driver de pg: se convierte antes de comparar.
    // Si el bug siguiera vivo, TODOS los multiplicadores saldrían 1.25 (el
    // techo). Con el fix, el voto tardío tiene que quedar por debajo del que
    // votó apenas se abrió.
    const early = scores.find((s) => s.user_id === owner.id)!
    const late = scores.find((s) => s.user_id === mates[0]!.id)!
    expect(Number(early.early_multiplier)).toBeGreaterThan(Number(late.early_multiplier))
  })
})

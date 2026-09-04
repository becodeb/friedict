import { describe, expect, it } from 'vitest'
import { createUser, sql, finalize, type TestUser } from './helpers'

/**
 * Cierre colaborativo: predicciones sin fecha de cierre (`closes_at` nulo) que
 * cierran cuando el grupo lo pide, con quórum sobre los pedidos — ahora un
 * NÚMERO ABSOLUTO configurado en el grupo (`close_request_quorum`), acotado
 * al conteo vivo, y no un porcentaje por predicción.
 *
 * Cubre además el arreglo de `score_prediction`: `greatest()` ignora NULLs, así
 * que sin este fix una predicción abierta le daba a todo el mundo el máximo
 * multiplicador de anticipación, Y la segunda mitad del mismo exploit —
 * cambiar el voto a la opción ganadora en el último momento — cerrada por
 * `option_selected_at`.
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

describe('grants de las funciones de cierre y de ajustes de grupo', () => {
  it('required_participants, required_close_requests, request_close, withdraw_close_request, update_group_settings y duration_multiplier son ejecutables por authenticated', async () => {
    const rows = (await sql(`
      select p.proname,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as ok
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'required_participants', 'required_close_requests', 'request_close',
           'withdraw_close_request', 'update_group_settings', 'duration_multiplier'
         )
    `)) as Array<{ proname: string; ok: boolean }>

    expect(rows).toHaveLength(6)
    for (const row of rows) {
      expect(row.ok, `${row.proname} debería ser ejecutable por authenticated`).toBe(true)
    }
  })

  it('group_member_count, vote_change_window_of, add_member_option, sync_member_options y on_member_joined NO son endpoints', async () => {
    const rows = (await sql(`
      select p.proname,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as ok
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'group_member_count', 'vote_change_window_of', 'add_member_option',
           'sync_member_options', 'on_member_joined'
         )
    `)) as Array<{ proname: string; ok: boolean }>

    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row.ok, `${row.proname} no debería ser ejecutable por authenticated`).toBe(false)
    }
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
    })

    const { error } = await mates[0]!.client.rpc('request_close', {
      p_prediction_id: predictionId as unknown as string,
    })
    expect(error?.message).toContain('must_vote_first')
  })

  it('la base rechaza una evolutiva cuyo intervalo no entra antes del cierre', async () => {
    const { owner, groupId } = await makeGroup('interval-window', 2)

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

  it('con close_request_quorum = 1, el primer pedido de cierre cierra en la MISMA llamada', async () => {
    const { owner, groupId, mates } = await makeGroup('quorum-one', 2)
    await owner.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_close_request_quorum: 1,
    })
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Cierra con un solo pedido?',
      p_options: ['Sí', 'No'],
    })
    const options = await optionsOf(predictionId as unknown as string)

    await owner.client.rpc('cast_vote', {
      p_prediction_id: predictionId as unknown as string,
      p_option_id: options[0]!.id,
    })

    const { data: result } = await owner.client.rpc('request_close', {
      p_prediction_id: predictionId as unknown as string,
    })
    expect((result as unknown as { closed: boolean }).closed).toBe(true)
    void mates

    const row = (await sql('select status from public.predictions where id = $1', [
      predictionId as unknown as string,
    ])) as Array<{ status: string }>
    expect(row[0]!.status).toBe('closed')
  })

  it('con el quórum muy por encima del conteo de integrantes, el requisito se acota al grupo y sigue siendo cerrable', async () => {
    const { owner, groupId, mates } = await makeGroup('quorum-above', 2)
    await owner.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_close_request_quorum: 999,
    })
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿El quórum se acota al grupo?',
      p_options: ['Sí', 'No'],
    })
    const options = await optionsOf(predictionId as unknown as string)

    await owner.client.rpc('cast_vote', { p_prediction_id: predictionId as unknown as string, p_option_id: options[0]!.id })
    await mates[0]!.client.rpc('cast_vote', { p_prediction_id: predictionId as unknown as string, p_option_id: options[1]!.id })

    const { data: first } = await owner.client.rpc('request_close', {
      p_prediction_id: predictionId as unknown as string,
    })
    expect((first as unknown as { required: number; closed: boolean }).required).toBe(2)
    expect((first as unknown as { closed: boolean }).closed).toBe(false)

    const { data: second } = await mates[0]!.client.rpc('request_close', {
      p_prediction_id: predictionId as unknown as string,
    })
    expect((second as unknown as { closed: boolean }).closed).toBe(true)
  })

  it('alcanzar el quórum de cierre cierra en la MISMA transacción que la solicitud', async () => {
    const { owner, groupId, mates } = await makeGroup('quorum-close', 2)
    await owner.client.rpc('update_group_settings', { p_group_id: groupId, p_close_request_quorum: 2 })
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Cierra apenas alcanza el quórum?',
      p_options: ['Sí', 'No'],
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
    await owner.client.rpc('update_group_settings', { p_group_id: groupId, p_close_request_quorum: 2 })
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Se puede retirar el pedido?',
      p_options: ['Sí', 'No'],
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
    await owner.client.rpc('update_group_settings', { p_group_id: groupId, p_close_request_quorum: 999 })
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Se cierra al bajar el quórum?',
      p_options: ['Sí', 'No'],
    })
    const options = await optionsOf(predictionId as unknown as string)

    for (const voter of [owner, mates[0]!, mates[1]!]) {
      await voter.client.rpc('cast_vote', {
        p_prediction_id: predictionId as unknown as string,
        p_option_id: options[0]!.id,
      })
    }

    // Con quórum 999 acotado al conteo vivo (3), hacen falta los 3 pedidos:
    // con 2 no alcanza todavía.
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
    await owner.client.rpc('update_group_settings', { p_group_id: groupId, p_close_request_quorum: 2 })
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿La anticipación es NULL-safe?',
      p_options: ['Sí', 'No'],
    })
    const options = await optionsOf(predictionId as unknown as string)
    const id = predictionId as unknown as string

    // Un voto justo al abrir y otro mucho más tarde: con el bug de
    // `greatest()` ignorando NULLs, los dos recibirían earliness = 1.
    //
    // El fixture mueve `option_selected_at`, NO `created_at`: desde 705_/710_,
    // score_prediction() mide la anticipación desde option_selected_at (ver
    // el comentario largo ahí), así que created_at ya no tiene ningún efecto
    // sobre el puntaje. Y deliberadamente TAMPOCO se mueve `first_cast_at`
    // —esa es la ancla de SEGURIDAD de la ventana de cambio de voto (ver
    // vote-window.test.ts); moverla acá mezclaría un fixture de puntaje con
    // uno de seguridad sin que nadie lo note.
    await owner.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })
    await sql(
      "update public.prediction_votes set option_selected_at = (select opens_at from public.predictions where id = $1) where prediction_id = $1 and user_id = $2",
      [id, owner.id],
    )

    await mates[0]!.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })

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
    const early = scores.find((s) => s.user_id === owner.id)!
    const late = scores.find((s) => s.user_id === mates[0]!.id)!
    expect(Number(early.early_multiplier)).toBeGreaterThan(Number(late.early_multiplier))
  })

  it('cambiar el voto a la ganadora en el último momento NO farmea la anticipación de quien la votó desde el principio (segunda mitad del exploit, cerrada por option_selected_at)', async () => {
    const { owner, groupId, mates } = await makeGroup('late-switch', 2)
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿El cambio de voto tardío no farmea anticipación?',
      p_options: ['Sí', 'No'],
    })
    const id = predictionId as unknown as string
    const options = await optionsOf(id)
    const winner = options[0]!.id
    const loser = options[1]!.id
    const mate = mates[0]!

    // Owner vota la ganadora apenas abre y nunca cambia. Se corre opens_at 10
    // días atrás para tener un tramo real donde medir anticipación, y se
    // ancla option_selected_at de owner al arranque: votó temprano y sostuvo.
    await owner.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: winner })
    await sql(`update public.predictions set opens_at = opens_at - interval '10 days' where id = $1`, [id])
    await sql(
      `update public.prediction_votes
          set option_selected_at = (select opens_at from public.predictions where id = $1)
        where prediction_id = $1 and user_id = $2`,
      [id, owner.id],
    )

    // Mate vota la PERDEDORA, y recién ahora — sobre el cierre, en tiempo
    // real — cambia a la ganadora. Es el ataque: conocer el resultado y
    // saltar en el último momento.
    await mate.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: loser })
    await mate.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: winner })

    await sql("update public.predictions set status = 'closed', closed_at = now() where id = $1", [id])
    await owner.client.rpc('propose_resolution', { p_prediction_id: id, p_option_id: winner })
    const resolution = (await sql(
      "select id from public.prediction_resolutions where prediction_id = $1 and status = 'proposed'",
      [id],
    )) as Array<{ id: string }>
    await mate.client.rpc('confirm_resolution', { p_resolution_id: resolution[0]!.id, p_agrees: true })

    const scores = (await sql(
      'select user_id, early_multiplier from public.prediction_scores where prediction_id = $1',
      [id],
    )) as Array<{ user_id: string; early_multiplier: string }>

    const early = scores.find((s) => s.user_id === owner.id)!
    const late = scores.find((s) => s.user_id === mate.id)!
    // Antes del fix, min(created_at) de mate ya reflejaba su PRIMER voto (a
    // la perdedora, que nunca se reescribe en el upsert), así que el cambio
    // tardío igual cobraba anticipación máxima. Con option_selected_at, la
    // anticipación de mate sale de CUÁNDO se quedó con la ganadora.
    expect(Number(early.early_multiplier)).toBeGreaterThan(Number(late.early_multiplier))
  })
})

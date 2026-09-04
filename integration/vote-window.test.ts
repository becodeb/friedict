import { describe, expect, it } from 'vitest'
import { createUser, sql, type TestUser } from './helpers'

/**
 * La ventana de cambio de voto: el cierre del exploit de cambiar el voto
 * después de saber el resultado.
 *
 * `first_cast_at` es el ancla de SEGURIDAD (nunca se reescribe en un
 * cambio); `option_selected_at` (705_/710_, ver score_prediction) es el ancla
 * de PUNTAJE (se mueve con cada cambio real de opción). Este archivo cubre
 * sólo la primera. La segunda tiene su cobertura en
 * `prediction-closing.test.ts`.
 */
async function makeGroup(prefix: string): Promise<{ owner: TestUser; groupId: string; mate: TestUser }> {
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
  const mate = await createUser(`${prefix}-m`)
  await mate.client.rpc('join_group', { p_token: token, p_display_name: 'Mate' })
  return { owner, groupId, mate }
}

async function optionsOf(predictionId: string): Promise<Array<{ id: string }>> {
  return (await sql(
    'select id from public.prediction_options where prediction_id = $1 order by position',
    [predictionId],
  )) as Array<{ id: string }>
}

describe('columnas de la ventana de cambio de voto', () => {
  it('predictions.vote_change_window es interval nullable, default 15 minutes, y rechaza un valor negativo', async () => {
    const columns = (await sql(
      `select column_default, is_nullable, data_type
         from information_schema.columns
        where table_schema = 'public' and table_name = 'predictions' and column_name = 'vote_change_window'`,
    )) as Array<{ column_default: string | null; is_nullable: string; data_type: string }>
    expect(columns).toHaveLength(1)
    expect(columns[0]!.is_nullable).toBe('YES')
    expect(columns[0]!.data_type).toBe('interval')
    expect(columns[0]!.column_default).toContain('15')

    const { groupId } = await makeGroup('vw-cols')

    await expect(
      sql(
        `insert into public.predictions (
           group_id, created_by, title, option_type, voting_mode,
           opens_at, closes_at, vote_change_window
         ) select id, created_by, 'ventana negativa', 'manual', 'single',
                  now(), now() + interval '1 day', interval '-5 minutes'
             from public.groups where id = $1`,
        [groupId],
      ),
    ).rejects.toThrow()
  })

  it('prediction_votes.first_cast_at es not null, default now(), y la migración lo backfillea desde created_at', async () => {
    const columns = (await sql(
      `select is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'prediction_votes' and column_name = 'first_cast_at'`,
    )) as Array<{ is_nullable: string; column_default: string | null }>
    expect(columns[0]!.is_nullable).toBe('NO')
    expect(columns[0]!.column_default).toContain('now')

    const { owner, groupId, mate } = await makeGroup('vw-backfill')
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Se backfillea first_cast_at?',
      p_options: ['Sí', 'No'],
    })
    const options = await optionsOf(predictionId as unknown as string)
    await mate.client.rpc('cast_vote', {
      p_prediction_id: predictionId as unknown as string,
      p_option_id: options[0]!.id,
    })

    // Se simula una fila "de antes de la migración": first_cast_at desviado
    // de created_at. La misma sentencia que corre 705_vote_window_and_scoring.sql
    // tiene que devolverlo a estar igualado.
    await sql(
      `update public.prediction_votes set first_cast_at = now() - interval '9 days'
        where prediction_id = $1 and user_id = $2`,
      [predictionId as unknown as string, mate.id],
    )
    await sql('update public.prediction_votes set first_cast_at = created_at')

    const row = (await sql(
      'select first_cast_at, created_at from public.prediction_votes where prediction_id = $1 and user_id = $2',
      [predictionId as unknown as string, mate.id],
    )) as Array<{ first_cast_at: string; created_at: string }>
    expect(new Date(row[0]!.first_cast_at).getTime()).toBe(new Date(row[0]!.created_at).getTime())
  })
})

describe('el candado de cast_vote', () => {
  it('cambiar el voto después de la ventana levanta vote_locked y no cambia option_id', async () => {
    const { owner, groupId, mate } = await makeGroup('vw-locked')
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Se bloquea después de la ventana?',
      p_options: ['Sí', 'No'],
      p_vote_change_window: '15m',
    })
    const id = predictionId as unknown as string
    const options = await optionsOf(id)

    await mate.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })
    // Se mueve el ancla de seguridad al pasado directamente por SQL — nunca
    // created_at, que es el patrón que usan los fixtures de puntaje.
    await sql(
      `update public.prediction_votes set first_cast_at = first_cast_at - interval '20 minutes'
        where prediction_id = $1 and user_id = $2`,
      [id, mate.id],
    )

    const { error } = await mate.client.rpc('cast_vote', {
      p_prediction_id: id,
      p_option_id: options[1]!.id,
    })
    expect(error?.message).toContain('vote_locked')

    const row = (await sql(
      'select option_id from public.prediction_votes where prediction_id = $1 and user_id = $2',
      [id, mate.id],
    )) as Array<{ option_id: string }>
    expect(row[0]!.option_id).toBe(options[0]!.id)
  })

  it('anti-ratchet: re-votar cada 14 minutos no mantiene la ventana abierta para siempre', async () => {
    const { owner, groupId, mate } = await makeGroup('vw-antiratchet')
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿El re-voto cada 14 minutos no estira la ventana?',
      p_options: ['Sí', 'No'],
      p_vote_change_window: '15m',
    })
    const id = predictionId as unknown as string
    const options = await optionsOf(id)

    // T: voto inicial.
    await mate.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })

    // T+14min: cambio ACEPTADO — mueve first_cast_at 14 minutos atrás para
    // simular el paso del tiempo, y confirma que first_cast_at NO se mueve.
    await sql(
      `update public.prediction_votes set first_cast_at = first_cast_at - interval '14 minutes'
        where prediction_id = $1 and user_id = $2`,
      [id, mate.id],
    )
    const before = (await sql(
      'select first_cast_at from public.prediction_votes where prediction_id = $1 and user_id = $2',
      [id, mate.id],
    )) as Array<{ first_cast_at: string }>

    const { error: firstChange } = await mate.client.rpc('cast_vote', {
      p_prediction_id: id,
      p_option_id: options[1]!.id,
    })
    expect(firstChange).toBeNull()

    const after = (await sql(
      'select first_cast_at from public.prediction_votes where prediction_id = $1 and user_id = $2',
      [id, mate.id],
    )) as Array<{ first_cast_at: string }>
    expect(new Date(after[0]!.first_cast_at).getTime()).toBe(
      new Date(before[0]!.first_cast_at).getTime(),
    )

    // T+16min desde el T original (2 minutos más tarde que el cambio de
    // arriba): rechazado, porque first_cast_at nunca se movió.
    await sql(
      `update public.prediction_votes set first_cast_at = first_cast_at - interval '2 minutes'
        where prediction_id = $1 and user_id = $2`,
      [id, mate.id],
    )
    const { error: secondChange } = await mate.client.rpc('cast_vote', {
      p_prediction_id: id,
      p_option_id: options[0]!.id,
    })
    expect(secondChange?.message).toContain('vote_locked')
  })

  it('el primer voto nunca se bloquea, incluso con la ventana en "never"', async () => {
    const { owner, groupId, mate } = await makeGroup('vw-firstcast')
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿El primer voto nunca se bloquea?',
      p_options: ['Sí', 'No'],
      p_vote_change_window: 'never',
    })
    const id = predictionId as unknown as string
    const options = await optionsOf(id)

    const { error } = await mate.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })
    expect(error).toBeNull()
  })

  it('"never" bloquea cualquier cambio posterior de inmediato', async () => {
    const { owner, groupId, mate } = await makeGroup('vw-never')
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿"never" bloquea apenas se intenta cambiar?',
      p_options: ['Sí', 'No'],
      p_vote_change_window: 'never',
    })
    const id = predictionId as unknown as string
    const options = await optionsOf(id)

    await mate.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })
    const { error } = await mate.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[1]!.id })
    expect(error?.message).toContain('vote_locked')
  })

  it('"until_close" nunca bloquea, sin importar cuánto pase', async () => {
    const { owner, groupId, mate } = await makeGroup('vw-untilclose')
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿"until_close" nunca bloquea?',
      p_options: ['Sí', 'No'],
      p_vote_change_window: 'until_close',
    })
    const id = predictionId as unknown as string
    const options = await optionsOf(id)

    await mate.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })
    await sql(
      `update public.prediction_votes set first_cast_at = first_cast_at - interval '30 days'
        where prediction_id = $1 and user_id = $2`,
      [id, mate.id],
    )
    const { error } = await mate.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[1]!.id })
    expect(error).toBeNull()
  })

  it('recurring sigue exigiendo cycle_vote_used sin importar la ventana', async () => {
    const { owner, groupId, mate } = await makeGroup('vw-recurring')
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Evolutiva ignora la ventana?',
      p_options: ['Sí', 'No'],
      p_voting_mode: 'recurring',
      p_vote_interval: '7 days',
      p_vote_change_window: 'never',
    })
    const id = predictionId as unknown as string
    const options = await optionsOf(id)

    await mate.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })
    const { error } = await mate.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[1]!.id })
    expect(error?.message).toContain('cycle_vote_used')
  })

  it('una clave de ventana desconocida levanta invalid_vote_window y no crea la predicción', async () => {
    const { owner, groupId } = await makeGroup('vw-invalid')
    const { error } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Rechaza una clave inventada?',
      p_options: ['Sí', 'No'],
      p_vote_change_window: 'ayer',
    })
    expect(error?.message).toContain('invalid_vote_window')

    const rows = (await sql(
      "select count(*)::int as n from public.predictions where group_id = $1 and title = '¿Rechaza una clave inventada?'",
      [groupId],
    )) as Array<{ n: number }>
    expect(rows[0]!.n).toBe(0)
  })
})

describe('option_selected_at — el ancla de la anticipación', () => {
  /**
   * Este invariante es el que cierra la segunda cara del exploit. Antes,
   * `score_prediction` sacaba la anticipación de `min(created_at)`, y en modo
   * clásico ese timestamp NO se mueve al cambiar de opción: cambiabas a la
   * ganadora en el último segundo y cobrabas anticipación máxima con el
   * diario del lunes.
   *
   * Ahora el reloj es `option_selected_at`, y tiene que cumplir las dos
   * mitades: se mueve cuando cambiás de opción, y NO se mueve cuando
   * re-votás la misma. La segunda mitad importa tanto como la primera —
   * si se moviera, sostener tu voto te castigaría por confirmarlo.
   */
  // node-pg devuelve timestamptz como Date, no como string: dos Date del mismo
  // instante no son iguales por referencia, así que se compara el epoch.
  async function selectedAt(predictionId: string, userId: string): Promise<number> {
    const rows = (await sql(
      `select option_selected_at from public.prediction_votes
        where prediction_id = $1 and user_id = $2`,
      [predictionId, userId],
    )) as Array<{ option_selected_at: Date }>
    return new Date(rows[0]!.option_selected_at).getTime()
  }

  it('re-votar la MISMA opción no mueve el reloj', async () => {
    const { owner, groupId } = await makeGroup('vw-idem')
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Sostener el voto castiga?',
      p_options: ['Sí', 'No'],
      p_vote_change_window: 'until_close',
    })
    const id = predictionId as unknown as string
    const options = await optionsOf(id)

    await owner.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })
    const first = await selectedAt(id, owner.id)

    await owner.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })
    const afterRevote = await selectedAt(id, owner.id)

    expect(afterRevote).toBe(first)
  })

  it('cambiar de opción SÍ mueve el reloj hacia adelante', async () => {
    const { owner, groupId } = await makeGroup('vw-switch')
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Cambiar reinicia la anticipación?',
      p_options: ['Sí', 'No'],
      p_vote_change_window: 'until_close',
    })
    const id = predictionId as unknown as string
    const options = await optionsOf(id)

    await owner.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[0]!.id })
    const before = await selectedAt(id, owner.id)

    await owner.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: options[1]!.id })
    const after = await selectedAt(id, owner.id)

    expect(after).toBeGreaterThan(before)
  })
})

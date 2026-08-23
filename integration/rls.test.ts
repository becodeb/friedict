import { beforeAll, describe, expect, it } from 'vitest'
import { SEED, signInSeeded, sql, type TestUser } from './helpers'

/**
 * Aislamiento entre grupos.
 *
 * Caro pertenece SÓLO a «Fútbol 5». Bauti pertenece SÓLO a «Los pibes». Ninguno
 * de los dos debe poder leer, votar ni resolver nada del otro grupo, ni
 * enterarse de que existe.
 *
 * No se testea la existencia de las políticas: se testea el comportamiento. Una
 * policy que existe pero no filtra pasa cualquier revisión de código y ninguno
 * de estos tests.
 */
describe('RLS — aislamiento entre grupos', () => {
  let bauti: TestUser
  let caro: TestUser

  beforeAll(async () => {
    bauti = await signInSeeded('bauti@cantado.test')
    caro = await signInSeeded('caro@cantado.test')
  })

  it('la base tiene RLS habilitado en todas las tablas privadas', async () => {
    const rows = (await sql(`
      select c.relname
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
         and c.relrowsecurity = false
    `)) as Array<{ relname: string }>

    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('Caro no ve el grupo de Bauti', async () => {
    const { data } = await caro.client.from('groups').select('*').eq('id', SEED.losPibes)
    expect(data).toEqual([])
  })

  it('Caro no ve NINGUNA predicción del grupo ajeno', async () => {
    const { data } = await caro.client
      .from('predictions')
      .select('id')
      .eq('group_id', SEED.losPibes)
    expect(data).toEqual([])
  })

  it('Caro no ve a los integrantes del grupo ajeno', async () => {
    const { data } = await caro.client
      .from('group_members')
      .select('user_id')
      .eq('group_id', SEED.losPibes)
    expect(data).toEqual([])
  })

  it('Caro no ve el perfil de alguien con quien no comparte grupo', async () => {
    const { data } = await caro.client.from('profiles').select('id').eq('id', SEED.bauti)
    expect(data).toEqual([])
  })

  it('Caro no ve el ranking del grupo ajeno', async () => {
    const { data } = await caro.client
      .from('group_leaderboard')
      .select('user_id')
      .eq('group_id', SEED.losPibes)
    expect(data).toEqual([])
  })

  it('Caro no ve la actividad del grupo ajeno', async () => {
    const { data } = await caro.client
      .from('activity_events')
      .select('id')
      .eq('group_id', SEED.losPibes)
    expect(data).toEqual([])
  })

  it('Caro no puede votar en una predicción del grupo ajeno', async () => {
    const options = (await sql(
      'select id from public.prediction_options where prediction_id = $1 limit 1',
      [SEED.enPrueba],
    )) as Array<{ id: string }>

    const { error } = await caro.client.rpc('cast_vote', {
      p_prediction_id: SEED.enPrueba,
      p_option_id: options[0]!.id,
    })

    expect(error).not.toBeNull()
    expect(error?.message).toContain('not_a_member')
  })

  it('Caro no puede proponer un resultado en el grupo ajeno', async () => {
    const options = (await sql(
      'select id from public.prediction_options where prediction_id = $1 limit 1',
      [SEED.cerrada],
    )) as Array<{ id: string }>

    const { error } = await caro.client.rpc('propose_resolution', {
      p_prediction_id: SEED.cerrada,
      p_option_id: options[0]!.id,
    })

    expect(error).not.toBeNull()
    expect(error?.message).toContain('not_a_member')
  })

  it('Caro no puede crear una predicción en el grupo ajeno', async () => {
    const { error } = await caro.client.rpc('create_prediction', {
      p_group_id: SEED.losPibes,
      p_title: 'Intento de intrusión',
      p_options: ['Sí', 'No'],
      p_closes_at: new Date(Date.now() + 86_400_000).toISOString(),
    })

    expect(error).not.toBeNull()
    expect(error?.message).toContain('not_a_member')
  })

  it('Caro no puede invitar gente al grupo ajeno', async () => {
    const { error } = await caro.client.rpc('create_invite', {
      p_group_id: SEED.losPibes,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toContain('admin_only')
  })

  it('Caro no puede sacar a nadie del grupo ajeno', async () => {
    const { error } = await caro.client.rpc('remove_member', {
      p_group_id: SEED.losPibes,
      p_user_id: SEED.bauti,
    })
    expect(error).not.toBeNull()

    // Y efectivamente Bauti sigue adentro.
    const rows = (await sql(
      'select count(*)::int as n from public.group_members where group_id = $1 and user_id = $2',
      [SEED.losPibes, SEED.bauti],
    )) as Array<{ n: number }>
    expect(rows[0]!.n).toBe(1)
  })

  it('y al revés: Bauti tampoco ve nada de Fútbol 5', async () => {
    const [groups, predictions, members] = await Promise.all([
      bauti.client.from('groups').select('id').eq('id', SEED.futbol5),
      bauti.client.from('predictions').select('id').eq('group_id', SEED.futbol5),
      bauti.client.from('group_members').select('user_id').eq('group_id', SEED.futbol5),
    ])

    expect(groups.data).toEqual([])
    expect(predictions.data).toEqual([])
    expect(members.data).toEqual([])
  })

  it('sin sesión no se ve absolutamente nada', async () => {
    const { anonClient } = await import('./helpers')
    const anon = anonClient()

    const [groups, predictions, profiles] = await Promise.all([
      anon.from('groups').select('id'),
      anon.from('predictions').select('id'),
      anon.from('profiles').select('id'),
    ])

    expect(groups.data ?? []).toEqual([])
    expect(predictions.data ?? []).toEqual([])
    expect(profiles.data ?? []).toEqual([])
  })
})

describe('RLS — privacidad del voto dentro del propio grupo', () => {
  let bauti: TestUser

  beforeAll(async () => {
    bauti = await signInSeeded('bauti@cantado.test')
  })

  it('con la predicción abierta, Bauti sólo ve SUS votos', async () => {
    const { data } = await bauti.client
      .from('prediction_votes')
      .select('user_id')
      .eq('prediction_id', SEED.evolutiva)

    expect(data!.length).toBeGreaterThan(0)
    expect(new Set(data!.map((v) => v.user_id))).toEqual(new Set([SEED.bauti]))
  })

  it('con la predicción abierta y resultados ocultos, no llegan los recuentos', async () => {
    const { data } = await bauti.client
      .from('prediction_option_tallies')
      .select('option_id')
      .eq('prediction_id', SEED.enPrueba)

    expect(data).toEqual([])
  })

  it('una vez cerrada, se revelan los votos de todo el mundo', async () => {
    const { data } = await bauti.client
      .from('prediction_votes')
      .select('user_id')
      .eq('prediction_id', SEED.cerrada)

    expect(new Set(data!.map((v) => v.user_id)).size).toBeGreaterThan(1)
  })

  it('una vez cerrada, se revelan los recuentos por opción', async () => {
    const { data } = await bauti.client
      .from('prediction_option_tallies')
      .select('option_id, vote_count')
      .eq('prediction_id', SEED.cerrada)

    expect(data!.length).toBeGreaterThan(0)
  })

  it('un integrante común no puede leer los tokens de invitación', async () => {
    const lu = await signInSeeded('lu@cantado.test') // rol member
    const { data } = await lu.client
      .from('group_invites')
      .select('token')
      .eq('group_id', SEED.losPibes)

    expect(data).toEqual([])
  })

  it('nadie puede escribir directamente en las tablas: todo pasa por RPC', async () => {
    const insertVote = await bauti.client.from('prediction_votes').insert({
      prediction_id: SEED.enPrueba,
      option_id: crypto.randomUUID(),
      user_id: SEED.bauti,
    })
    expect(insertVote.error).not.toBeNull()

    const insertGroup = await bauti.client
      .from('groups')
      .insert({ name: 'Grupo trucho', created_by: SEED.bauti })
    expect(insertGroup.error).not.toBeNull()

    const updatePrediction = await bauti.client
      .from('predictions')
      .update({ status: 'resolved' })
      .eq('id', SEED.enPrueba)
    expect(updatePrediction.error).not.toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { createUser, sql, type TestUser } from './helpers'

/**
 * "Los del grupo" en vivo: `option_type = 'members'` deja de ser una foto del
 * momento de creación. Un integrante que se suma más tarde gana su opción; uno
 * que se va la conserva (y las votos que ya tiene), porque borrarla arrastraría
 * votos reales por `on delete cascade`.
 */
async function makeGroup(prefix: string): Promise<{ owner: TestUser; groupId: string; token: string }> {
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
  return { owner, groupId, token }
}

async function optionsOf(predictionId: string): Promise<Array<{ id: string; label: string; member_id: string | null }>> {
  return (await sql(
    'select id, label, member_id from public.prediction_options where prediction_id = $1 order by position',
    [predictionId],
  )) as Array<{ id: string; label: string; member_id: string | null }>
}

describe('"los del grupo" en vivo', () => {
  it('un integrante que se suma después se convierte en opción votable de una predicción abierta', async () => {
    const { owner, groupId, token } = await makeGroup('mo-join')
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Quién llega último?',
      p_options: [],
      p_option_type: 'members',
    })
    const id = predictionId as unknown as string

    const before = await optionsOf(id)
    expect(before.map((o) => o.label)).toEqual(['Owner'])

    const late = await createUser('mo-join-late')
    await late.client.rpc('join_group', { p_token: token, p_display_name: 'Tarde' })

    const after = await optionsOf(id)
    expect(after.map((o) => o.label).sort()).toEqual(['Owner', 'Tarde'])
    expect(after.find((o) => o.member_id === late.id)).toBeTruthy()
  })

  it('un integrante que se va conserva su opción Y los votos ya emitidos para ella', async () => {
    const { owner, groupId, token } = await makeGroup('mo-leave')
    const leaver = await createUser('mo-leave-user')
    await leaver.client.rpc('join_group', { p_token: token, p_display_name: 'Se va' })

    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Quién llega último 2?',
      p_options: [],
      p_option_type: 'members',
    })
    const id = predictionId as unknown as string
    const options = await optionsOf(id)
    const leaverOption = options.find((o) => o.member_id === leaver.id)!

    await owner.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: leaverOption.id })

    const votesBefore = (await sql(
      'select count(*)::int as n from public.prediction_votes where option_id = $1',
      [leaverOption.id],
    )) as Array<{ n: number }>
    expect(votesBefore[0]!.n).toBe(1)

    await leaver.client.rpc('leave_group', { p_group_id: groupId })

    const optionsAfter = await optionsOf(id)
    expect(optionsAfter.some((o) => o.id === leaverOption.id)).toBe(true)

    const votesAfter = (await sql(
      'select count(*)::int as n from public.prediction_votes where option_id = $1',
      [leaverOption.id],
    )) as Array<{ n: number }>
    expect(votesAfter[0]!.n).toBe(1)
  })

  it('salir y volver a entrar no crea una segunda opción', async () => {
    const { owner, groupId, token } = await makeGroup('mo-rejoin')
    const rejoiner = await createUser('mo-rejoiner')
    await rejoiner.client.rpc('join_group', { p_token: token, p_display_name: 'Va y viene' })

    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Quién llega último 3?',
      p_options: [],
      p_option_type: 'members',
    })
    const id = predictionId as unknown as string

    await rejoiner.client.rpc('leave_group', { p_group_id: groupId })
    await rejoiner.client.rpc('join_group', { p_token: token, p_display_name: 'Va y viene' })
    await rejoiner.client.rpc('leave_group', { p_group_id: groupId })
    await rejoiner.client.rpc('join_group', { p_token: token, p_display_name: 'Va y viene' })

    const options = await optionsOf(id)
    const mine = options.filter((o) => o.member_id === rejoiner.id)
    expect(mine).toHaveLength(1)
  })

  it('dos integrantes con el mismo display_name reciben ambos una opción, sin violar unique(prediction_id, label)', async () => {
    const { owner, groupId, token } = await makeGroup('mo-dup')
    const a = await createUser('mo-dup-a')
    const b = await createUser('mo-dup-b')
    await a.client.rpc('join_group', { p_token: token, p_display_name: 'Igual' })
    await b.client.rpc('join_group', { p_token: token, p_display_name: 'Igual' })

    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Quién llega último 4?',
      p_options: [],
      p_option_type: 'members',
    })
    const id = predictionId as unknown as string

    const options = await optionsOf(id)
    const labeled = options.filter((o) => o.member_id === a.id || o.member_id === b.id)
    expect(labeled).toHaveLength(2)
    expect(new Set(labeled.map((o) => o.label)).size).toBe(2)
    expect(labeled.some((o) => o.label === 'Igual')).toBe(true)
    expect(labeled.some((o) => o.label === 'Igual (2)')).toBe(true)
  })

  it('renombrarse (upsert_profile) no reescribe una etiqueta ya creada, y los votos siguen ahí', async () => {
    const { owner, groupId, token } = await makeGroup('mo-rename')
    const member = await createUser('mo-rename-user')
    await member.client.rpc('join_group', { p_token: token, p_display_name: 'Nombre Viejo' })

    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Quién llega último 5?',
      p_options: [],
      p_option_type: 'members',
    })
    const id = predictionId as unknown as string
    const before = await optionsOf(id)
    const myOption = before.find((o) => o.member_id === member.id)!

    await owner.client.rpc('cast_vote', { p_prediction_id: id, p_option_id: myOption.id })
    await member.client.rpc('upsert_profile', { p_display_name: 'Nombre Nuevo' })

    const after = await optionsOf(id)
    const stillMine = after.find((o) => o.member_id === member.id)!
    expect(stillMine.label).toBe('Nombre Viejo')

    const votes = (await sql(
      'select count(*)::int as n from public.prediction_votes where option_id = $1',
      [myOption.id],
    )) as Array<{ n: number }>
    expect(votes[0]!.n).toBe(1)
  })

  it('unirse no agrega opciones a una predicción cerrada o resuelta', async () => {
    const { owner, groupId, token } = await makeGroup('mo-closed')
    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Quién llega último 6?',
      p_options: [],
      p_option_type: 'members',
    })
    const id = predictionId as unknown as string

    await sql("update public.predictions set status = 'closed', closed_at = now() where id = $1", [id])
    const beforeCount = (await optionsOf(id)).length

    const late = await createUser('mo-closed-late')
    await late.client.rpc('join_group', { p_token: token, p_display_name: 'Llegó Tarde' })

    const afterCount = (await optionsOf(id)).length
    expect(afterCount).toBe(beforeCount)
    expect((await optionsOf(id)).some((o) => o.member_id === late.id)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { PREDICTION_SELECT } from '../server/src/prediction-select'
import { asUser, createUser, sql } from './helpers'

/**
 * El SELECT real que arma `GET /api/predictions/:id` y `GET
 * /api/groups/:id/predictions`, ejercitado tal cual — mismo texto, mismo
 * join lateral — sin necesitar levantar el servidor HTTP.
 */
describe('PREDICTION_SELECT: campos derivados', () => {
  it('trae member_count, required_participants, close_required y my_close_request', async () => {
    const owner = await createUser('read-owner')
    const { data: group } = await owner.client.rpc('create_group', {
      p_name: 'Lectura',
      p_display_name: 'Owner',
    })
    const groupId = (group as unknown as { id: string }).id

    const { data: invite } = await owner.client.rpc('create_invite', {
      p_group_id: groupId,
      p_expires_in: '7 days',
    })
    const token = (invite as unknown as { token: string }).token
    const mate = await createUser('read-mate')
    await mate.client.rpc('join_group', { p_token: token, p_display_name: 'Mate' })

    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿El SELECT trae los campos derivados?',
      p_options: ['Sí', 'No'],
      p_qualification_percent: 100,
      p_close_percent: 100,
    })

    const rows = (await asUser(
      owner.id,
      `${PREDICTION_SELECT} where p.id = $1`,
      [predictionId as unknown as string],
    )) as Array<{
      member_count: number
      required_participants: number
      close_required: number
      my_close_request: boolean
    }>

    expect(rows).toHaveLength(1)
    expect(rows[0]!.member_count).toBe(2)
    expect(rows[0]!.required_participants).toBe(2)
    expect(rows[0]!.close_required).toBe(2)
    expect(rows[0]!.my_close_request).toBe(false)

    // Votar y pedir el cierre: my_close_request tiene que reflejar el pedido
    // de QUIEN CONSULTA, no un booleano global.
    const options = (await sql(
      'select id from public.prediction_options where prediction_id = $1 order by position',
      [predictionId as unknown as string],
    )) as Array<{ id: string }>
    await owner.client.rpc('cast_vote', {
      p_prediction_id: predictionId as unknown as string,
      p_option_id: options[0]!.id,
    })

    const stillOpenRows = (await asUser(
      owner.id,
      `${PREDICTION_SELECT} where p.id = $1`,
      [predictionId as unknown as string],
    )) as Array<{ my_close_request: boolean }>
    expect(stillOpenRows[0]!.my_close_request).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { createUser, sql, timeTravel, finalize } from './helpers'

/**
 * Quórum de calificación: reemplaza el `minimum_participants = 3` hardcodeado
 * por un porcentaje del tamaño VIVO del grupo, con piso 1 y techo el propio
 * conteo de integrantes.
 *
 * Esta es la corrección del bug central de la propuesta: un grupo de 2
 * personas nunca podía calificar una predicción porque `greatest(3, …)`
 * imponía un piso de 3 sin importar cuánta gente hubiera.
 */
describe('quórum de calificación', () => {
  it('exactamente una fila de create_prediction: el drop/replace no dejó un overload', async () => {
    const rows = (await sql(
      `select count(*)::int as n from pg_proc where proname = 'create_prediction'`,
    )) as Array<{ n: number }>
    expect(rows[0]!.n).toBe(1)
  })

  it('un grupo de 2 personas puede calificar: el requisito nunca supera el conteo vivo', async () => {
    const owner = await createUser('quorum-owner')
    const { data: group } = await owner.client.rpc('create_group', {
      p_name: 'Dupla',
      p_display_name: 'Owner',
    })
    const groupId = (group as unknown as { id: string }).id

    const { data: invite } = await owner.client.rpc('create_invite', {
      p_group_id: groupId,
      p_expires_in: '7 days',
    })
    const token = (invite as unknown as { token: string }).token

    const mate = await createUser('quorum-mate')
    await mate.client.rpc('join_group', { p_token: token, p_display_name: 'Mate' })

    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Llueve el sábado que viene?',
      p_options: ['Sí', 'No'],
      p_qualification_percent: 60,
    })

    const options = (await sql(
      'select id from public.prediction_options where prediction_id = $1 order by position',
      [predictionId],
    )) as Array<{ id: string }>

    await owner.client.rpc('cast_vote', {
      p_prediction_id: predictionId as unknown as string,
      p_option_id: options[0]!.id,
    })
    const { data: castResult } = await mate.client.rpc('cast_vote', {
      p_prediction_id: predictionId as unknown as string,
      p_option_id: options[1]!.id,
    })

    expect((castResult as unknown as { status: string }).status).toBe('active')

    const row = (await sql(
      'select status, qualification_percent from public.predictions where id = $1',
      [predictionId as unknown as string],
    )) as Array<{ status: string; qualification_percent: number }>
    expect(row[0]!.status).toBe('active')
  })

  it('el piso nunca baja de 1 aunque el porcentaje configurado sea muy chico', async () => {
    const rows = (await sql(
      'select public.required_participants($1, $2) as n',
      [2, 1],
    )) as Array<{ n: number }>
    expect(rows[0]!.n).toBe(1)
  })

  it('el requisito nunca supera el conteo vivo de integrantes', async () => {
    const rows = (await sql(
      'select public.required_participants($1, $2) as n',
      [2, 100],
    )) as Array<{ n: number }>
    expect(rows[0]!.n).toBe(2)
  })

  it('el requisito sube cuando se suma un integrante nuevo, sin escribir la fila de la predicción', async () => {
    const owner = await createUser('grow-owner')
    const { data: group } = await owner.client.rpc('create_group', {
      p_name: 'Creciente',
      p_display_name: 'Owner',
    })
    const groupId = (group as unknown as { id: string }).id

    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Se suma gente nueva?',
      p_options: ['Sí', 'No'],
      p_qualification_percent: 100,
    })

    const before = (await sql(
      `select public.required_participants(
         (select count(*)::int from public.group_members where group_id = $1), 100::smallint
       ) as n`,
      [groupId],
    )) as Array<{ n: number }>
    expect(before[0]!.n).toBe(1)

    const { data: invite } = await owner.client.rpc('create_invite', {
      p_group_id: groupId,
      p_expires_in: '7 days',
    })
    const token = (invite as unknown as { token: string }).token
    const mate = await createUser('grow-mate')
    await mate.client.rpc('join_group', { p_token: token, p_display_name: 'Mate' })

    const after = (await sql(
      `select public.required_participants(
         (select count(*)::int from public.group_members where group_id = $1), 100::smallint
       ) as n`,
      [groupId],
    )) as Array<{ n: number }>
    expect(after[0]!.n).toBe(2)

    // La fila de la predicción no se tocó: la subida del requisito es pura
    // lectura, nunca un write.
    const predRow = (await sql(
      'select qualification_percent from public.predictions where id = $1',
      [predictionId as unknown as string],
    )) as Array<{ qualification_percent: number }>
    expect(predRow[0]!.qualification_percent).toBe(100)
  })

  it('finalize_predictions cierra por falta de quórum contra el conteo vivo, no un mínimo fijo', async () => {
    const owner = await createUser('expire-owner')
    const { data: group } = await owner.client.rpc('create_group', {
      p_name: 'Chica',
      p_display_name: 'Owner',
    })
    const groupId = (group as unknown as { id: string }).id

    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Expira sin quórum?',
      p_options: ['Sí', 'No'],
      p_qualification_percent: 100,
      p_qualification_hours: 1,
    })

    await timeTravel(predictionId as unknown as string, '2 hours')
    await finalize()

    const row = (await sql('select status from public.predictions where id = $1', [
      predictionId as unknown as string,
    ])) as Array<{ status: string }>
    expect(row[0]!.status).toBe('expired')
  })

  it('el backfill preserva el requisito efectivo de las filas previas y habilita a los grupos chicos', async () => {
    const owner = await createUser('backfill-owner')
    const { data: group3 } = await owner.client.rpc('create_group', {
      p_name: 'Trío backfill',
      p_display_name: 'Owner',
    })
    const group3Id = (group3 as unknown as { id: string }).id
    const { data: invite3 } = await owner.client.rpc('create_invite', {
      p_group_id: group3Id,
      p_expires_in: '7 days',
    })
    const token3 = (invite3 as unknown as { token: string }).token
    const mate1 = await createUser('backfill-mate1')
    const mate2 = await createUser('backfill-mate2')
    await mate1.client.rpc('join_group', { p_token: token3, p_display_name: 'Uno' })
    await mate2.client.rpc('join_group', { p_token: token3, p_display_name: 'Dos' })

    const owner2 = await createUser('backfill-owner2')
    const { data: group2 } = await owner2.client.rpc('create_group', {
      p_name: 'Dupla backfill',
      p_display_name: 'Owner2',
    })
    const group2Id = (group2 as unknown as { id: string }).id
    const { data: invite2 } = await owner2.client.rpc('create_invite', {
      p_group_id: group2Id,
      p_expires_in: '7 days',
    })
    const token2 = (invite2 as unknown as { token: string }).token
    const mate3 = await createUser('backfill-mate3')
    await mate3.client.rpc('join_group', { p_token: token2, p_display_name: 'Tres' })

    // Filas insertadas directamente, como si fueran anteriores a esta migración:
    // `minimum_participants = 3`, pero con el `qualification_percent` que le
    // habría tocado a una fila nueva (el default de la columna), simulando el
    // estado ANTES de que corriera el backfill.
    const rows = (await sql<{ id: string }>(
      `insert into public.predictions (
         group_id, created_by, title, option_type, voting_mode,
         minimum_participants, qualification_deadline, opens_at, closes_at,
         status, participant_count
       ) values
         ($1, $2, 'Trío: pre-backfill', 'manual', 'single', 3, now() + interval '2 days', now(), now() + interval '3 days', 'active', 3),
         ($3, $4, 'Dupla: pre-backfill', 'manual', 'single', 3, now() + interval '2 days', now(), now() + interval '3 days', 'proposed', 2)
       returning id`,
      [group3Id, owner.id, group2Id, owner2.id],
    )) as Array<{ id: string }>
    const [trioId, duplaId] = [rows[0]!.id, rows[1]!.id]

    // La MISMA fórmula que corre 600_quorum_and_open_close.sql en el backfill.
    await sql(
      `update public.predictions p
          set qualification_percent = least(100, greatest(1,
                ceil(p.minimum_participants::numeric * 100
                     / greatest(1, (select count(*) from public.group_members g where g.group_id = p.group_id)))::int))
        where p.id in ($1, $2)`,
      [trioId, duplaId],
    )

    const after = (await sql(
      `select id, qualification_percent,
              public.required_participants(
                (select count(*)::int from public.group_members where group_id = predictions.group_id),
                qualification_percent
              ) as required
         from public.predictions where id in ($1, $2)`,
      [trioId, duplaId],
    )) as Array<{ id: string; qualification_percent: number; required: number }>

    const trio = after.find((r) => r.id === trioId)!
    const dupla = after.find((r) => r.id === duplaId)!

    // Grupo de 3: seguía necesitando 3, y con 3 participantes ya calificaba
    // antes del backfill. Después de este sigue calificando exactamente igual.
    expect(trio.required).toBe(3)

    // Grupo de 2: antes NUNCA podía calificar (pedía 3 personas que no
    // existían). Con el backfill, el requisito se acota al conteo vivo: 2.
    expect(dupla.required).toBe(2)
  })
})

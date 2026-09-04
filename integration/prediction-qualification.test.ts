import { describe, expect, it } from 'vitest'
import { createUser, sql, timeTravel, finalize } from './helpers'

/**
 * Quórum de calificación: reemplaza el `minimum_participants = 3` hardcodeado
 * por un porcentaje del tamaño VIVO del grupo, con piso 1 y techo el propio
 * conteo de integrantes — y ahora vive en `groups`, apagado por default.
 *
 * `required_participants()` en sí no cambió (sigue percent-based, sigue
 * siendo la misma función pura de 600_); lo que cambió es DE DÓNDE sale el
 * porcentaje y si el gate corre siquiera.
 */
describe('quórum de calificación', () => {
  it('exactamente una fila de create_prediction y de create_prediction_from_template: el drop/replace no dejó un overload', async () => {
    const rows = (await sql(
      `select proname, count(*)::int as n from pg_proc
        where proname in ('create_prediction', 'create_prediction_from_template')
        group by proname`,
    )) as Array<{ proname: string; n: number }>
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.n, `${row.proname} tiene ${row.n} filas en pg_proc`).toBe(1)
    }
  })

  it('sin el toggle prendido, una predicción nace directamente activa, aunque nadie haya votado', async () => {
    const owner = await createUser('quali-off-owner')
    const { data: group } = await owner.client.rpc('create_group', {
      p_name: 'Sin calificar',
      p_display_name: 'Owner',
    })
    const groupId = (group as unknown as { id: string }).id

    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Nace activa sin el toggle?',
      p_options: ['Sí', 'No'],
    })

    const row = (await sql('select status from public.predictions where id = $1', [
      predictionId as unknown as string,
    ])) as Array<{ status: string }>
    expect(row[0]!.status).toBe('active')
  })

  it('un grupo de 2 personas puede calificar: el requisito nunca supera el conteo vivo', async () => {
    const owner = await createUser('quorum-owner')
    const { data: group } = await owner.client.rpc('create_group', {
      p_name: 'Dupla',
      p_display_name: 'Owner',
    })
    const groupId = (group as unknown as { id: string }).id
    await owner.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_qualification_enabled: true,
      p_qualification_percent: 60,
    })

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
      'select status from public.predictions where id = $1',
      [predictionId as unknown as string],
    )) as Array<{ status: string }>
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
    await owner.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_qualification_enabled: true,
      p_qualification_percent: 100,
    })

    await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Se suma gente nueva?',
      p_options: ['Sí', 'No'],
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

    // El GRUPO no se tocó: la subida del requisito es pura lectura, nunca un
    // write — la misma garantía que antes, con el porcentaje viviendo un
    // nivel más arriba.
    const groupRow = (await sql(
      'select qualification_percent from public.groups where id = $1',
      [groupId],
    )) as Array<{ qualification_percent: number }>
    expect(groupRow[0]!.qualification_percent).toBe(100)
  })

  it('con el toggle prendido y sin quórum, la predicción sigue en prueba después de timeTravel + finalize: NUNCA expira', async () => {
    const owner = await createUser('never-expire-owner')
    const { data: group } = await owner.client.rpc('create_group', {
      p_name: 'Nunca expira',
      p_display_name: 'Owner',
    })
    const groupId = (group as unknown as { id: string }).id
    await owner.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_qualification_enabled: true,
      p_qualification_percent: 100,
    })

    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Nunca expira sin quórum?',
      p_options: ['Sí', 'No'],
    })

    await timeTravel(predictionId as unknown as string, '400 days')
    await finalize()

    const row = (await sql('select status from public.predictions where id = $1', [
      predictionId as unknown as string,
    ])) as Array<{ status: string }>
    expect(row[0]!.status).toBe('proposed')
  })

  it('después de las migraciones, ninguna fila queda en proposed salvo que su grupo tenga qualification_enabled = true', async () => {
    const rows = (await sql(
      `select p.id from public.predictions p
         join public.groups g on g.id = p.group_id
        where p.status = 'proposed' and not g.qualification_enabled`,
    )) as Array<{ id: string }>
    expect(rows).toEqual([])
  })

  it('la fórmula del backfill de close_request_quorum: greatest(1, min de las predicciones abiertas)', async () => {
    // La misma aritmética que corre 700_group_settings.sql, ejercitada
    // directamente: el backfill real ya corrió sobre datos que no existen
    // más (predictions.close_percent se dropeó en 730_), así que esto prueba
    // la FÓRMULA, no una fila viva. min() y no un promedio ni un máximo: si
    // UNA predicción abierta ya tenía un quórum bajo, el grupo demostró que
    // le alcanzaba con eso.
    const rows = (await sql(
      `select greatest(1, min(least(n, ceil(n::numeric * close_percent / 100)::int)))::smallint as q
         from unnest($1::int[], $2::int[]) as t(n, close_percent)`,
      [
        [3, 3],
        [100, 10],
      ],
    )) as Array<{ q: number }>
    // Grupo de 3, dos predicciones abiertas al 100% y al 10%: el mínimo
    // entre least(3, 3)=3 y least(3, ceil(0.3))=least(3,1)=1 es 1.
    expect(rows[0]!.q).toBe(1)
  })

  it('apagar la calificación (update_group_settings) promueve TODAS las proposed del grupo en un solo llamado, sin evento por predicción', async () => {
    const owner = await createUser('bulk-promote-owner')
    const { data: group } = await owner.client.rpc('create_group', {
      p_name: 'Promoción en bloque',
      p_display_name: 'Owner',
    })
    const groupId = (group as unknown as { id: string }).id
    await owner.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_qualification_enabled: true,
      p_qualification_percent: 100,
    })

    const first = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Primera en prueba?',
      p_options: ['Sí', 'No'],
    })
    const second = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Segunda en prueba?',
      p_options: ['Sí', 'No'],
    })

    await owner.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_qualification_enabled: false,
    })

    const rows = (await sql(
      'select status from public.predictions where id in ($1, $2)',
      [first.data as unknown as string, second.data as unknown as string],
    )) as Array<{ status: string }>
    expect(rows.every((r) => r.status === 'active')).toBe(true)

    const events = (await sql(
      `select count(*)::int as n from public.activity_events
        where prediction_id in ($1, $2) and type = 'prediction_qualified'`,
      [first.data as unknown as string, second.data as unknown as string],
    )) as Array<{ n: number }>
    expect(events[0]!.n).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { createUser, sql } from './helpers'

/**
 * Ajustes de grupo: `close_request_quorum`, `qualification_enabled` y
 * `qualification_percent` reemplazan lo que antes vivía por predicción.
 *
 * El piso de 1 en el quórum de cierre es el pedido central del dueño: "con
 * solo uno alcance si confías en el grupo". La calificación es opt-in y
 * apagada por default — nadie tiene que "ganarse el lugar" salvo que el grupo
 * lo pida.
 */
async function makeGroup(prefix: string): Promise<{ owner: Awaited<ReturnType<typeof createUser>>; groupId: string }> {
  const owner = await createUser(prefix)
  const { data } = await owner.client.rpc('create_group', {
    p_name: `${prefix} grupo`,
    p_display_name: 'Owner',
  })
  return { owner, groupId: (data as unknown as { id: string }).id }
}

describe('columnas de ajustes de grupo', () => {
  it('groups tiene close_request_quorum (default 1, >= 1), qualification_enabled (default false) y qualification_percent (default 60, 1..100)', async () => {
    const columns = (await sql(
      `select column_name, column_default, is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'groups'
          and column_name in ('close_request_quorum', 'qualification_enabled', 'qualification_percent')`,
    )) as Array<{ column_name: string; column_default: string | null; is_nullable: string }>

    expect(columns).toHaveLength(3)
    const quorum = columns.find((c) => c.column_name === 'close_request_quorum')!
    const enabled = columns.find((c) => c.column_name === 'qualification_enabled')!
    const percent = columns.find((c) => c.column_name === 'qualification_percent')!

    expect(quorum.column_default).toContain('1')
    expect(quorum.is_nullable).toBe('NO')
    expect(enabled.column_default).toContain('false')
    expect(percent.column_default).toContain('60')

    const checks = (await sql(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
        where conrelid = 'public.groups'::regclass and contype = 'c'`,
    )) as Array<{ conname: string; def: string }>

    expect(checks.some((c) => c.def.includes('close_request_quorum') && c.def.includes('>='))).toBe(true)
    expect(
      checks.some((c) => c.def.includes('qualification_percent') && c.def.includes('100')),
    ).toBe(true)
  })

  it('close_request_quorum = 0 se rechaza', async () => {
    const { groupId } = await makeGroup('gs-quorum0')
    await expect(
      sql('update public.groups set close_request_quorum = 0 where id = $1', [groupId]),
    ).rejects.toThrow()
  })

  it('qualification_percent en 0 y en 101 se rechazan', async () => {
    const { groupId } = await makeGroup('gs-percent')
    await expect(
      sql('update public.groups set qualification_percent = 0 where id = $1', [groupId]),
    ).rejects.toThrow()
    await expect(
      sql('update public.groups set qualification_percent = 101 where id = $1', [groupId]),
    ).rejects.toThrow()
  })
})

describe('update_group_settings', () => {
  it('owner y admin pueden llamarla; un member y un no-integrante reciben admin_only y no escriben nada', async () => {
    const { owner, groupId } = await makeGroup('gs-auth')
    const { data: invite } = await owner.client.rpc('create_invite', {
      p_group_id: groupId,
      p_expires_in: '7 days',
    })
    const token = (invite as unknown as { token: string }).token

    const admin = await createUser('gs-admin')
    await admin.client.rpc('join_group', { p_token: token, p_display_name: 'Admin' })
    await sql('update public.group_members set role = $1 where group_id = $2 and user_id = $3', [
      'admin',
      groupId,
      admin.id,
    ])

    const member = await createUser('gs-member')
    await member.client.rpc('join_group', { p_token: token, p_display_name: 'Member' })

    const outsider = await createUser('gs-outsider')

    const { error: ownerError } = await owner.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_close_request_quorum: 2,
    })
    expect(ownerError).toBeNull()

    const { error: adminError } = await admin.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_close_request_quorum: 3,
    })
    expect(adminError).toBeNull()

    const { error: memberError } = await member.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_close_request_quorum: 5,
    })
    expect(memberError?.message).toContain('admin_only')

    const { error: outsiderError } = await outsider.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_close_request_quorum: 5,
    })
    expect(outsiderError?.message).toContain('admin_only')

    const row = (await sql('select close_request_quorum from public.groups where id = $1', [
      groupId,
    ])) as Array<{ close_request_quorum: number }>
    // Sólo los dos llamados válidos (owner, después admin) escribieron: la
    // fila termina en el último de ESOS dos, nunca en el valor de member/outsider.
    expect(row[0]!.close_request_quorum).toBe(3)
  })

  it('los parámetros omitidos dejan su columna sin tocar', async () => {
    const { owner, groupId } = await makeGroup('gs-partial')
    await owner.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_close_request_quorum: 4,
      p_qualification_enabled: true,
      p_qualification_percent: 80,
    })

    const { data } = await owner.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_qualification_percent: 30,
    })
    const row = data as unknown as {
      close_request_quorum: number
      qualification_enabled: boolean
      qualification_percent: number
    }

    expect(row.close_request_quorum).toBe(4)
    expect(row.qualification_enabled).toBe(true)
    expect(row.qualification_percent).toBe(30)
  })

  it('con el toggle prendido y una predicción en proposed, apagarlo la promueve a active en el mismo llamado', async () => {
    const { owner, groupId } = await makeGroup('gs-release')
    await owner.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_qualification_enabled: true,
      p_qualification_percent: 100,
    })

    const { data: predictionId } = await owner.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Queda liberada al apagar el toggle?',
      p_options: ['Sí', 'No'],
    })

    const before = (await sql('select status from public.predictions where id = $1', [
      predictionId as unknown as string,
    ])) as Array<{ status: string }>
    expect(before[0]!.status).toBe('proposed')

    await owner.client.rpc('update_group_settings', {
      p_group_id: groupId,
      p_qualification_enabled: false,
    })

    const after = (await sql('select status from public.predictions where id = $1', [
      predictionId as unknown as string,
    ])) as Array<{ status: string }>
    expect(after[0]!.status).toBe('active')
  })
})

describe('el paso destructivo (730_)', () => {
  it('predictions ya no tiene qualification_percent, close_percent ni minimum_participants', async () => {
    const columns = (await sql(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'predictions'
          and column_name in ('qualification_percent', 'close_percent', 'minimum_participants')`,
    )) as Array<{ column_name: string }>
    expect(columns).toEqual([])
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createUser, sql, type TestUser } from './helpers'

/**
 * Realtime.
 *
 * Lo que se comprueba es lo que el producto promete: que el contador de
 * participación se mueva solo en la pantalla de los demás cuando alguien vota, y
 * que el salto de «En prueba» a confirmada llegue sin recargar.
 *
 * También se comprueba lo que NO tiene que pasar: que los votos ajenos no
 * viajen por Realtime antes del cierre. `prediction_votes` está deliberadamente
 * fuera de la publicación.
 */
function waitFor<T>(
  predicate: (payload: T) => boolean,
  register: (handler: (payload: T) => void) => void,
  timeoutMs = 12_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No llegó ningún evento en ${timeoutMs}ms`)),
      timeoutMs,
    )
    register((payload) => {
      if (!predicate(payload)) return
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

describe('Realtime', () => {
  let ana: TestUser
  let beto: TestUser
  let cami: TestUser
  let groupId: string
  let channels: RealtimeChannel[] = []

  beforeAll(async () => {
    ;[ana, beto, cami] = await Promise.all([
      createUser('rt-ana'),
      createUser('rt-beto'),
      createUser('rt-cami'),
    ])

    const { data: group } = await ana.client.rpc('create_group', {
      p_name: 'Fútbol 5 (realtime)',
      p_display_name: 'Ana',
    })
    groupId = (group as unknown as { id: string }).id

    const { data: invite } = await ana.client.rpc('create_invite', {
      p_group_id: groupId,
      p_expires_in: '1 day',
    })
    const token = (invite as unknown as { token: string }).token

    await beto.client.rpc('join_group', { p_token: token, p_display_name: 'Beto' })
    await cami.client.rpc('join_group', { p_token: token, p_display_name: 'Cami' })
  }, 30_000)

  afterAll(async () => {
    await Promise.all(channels.map((channel) => ana.client.removeChannel(channel)))
    channels = []
  })

  it('la publicación incluye lo que la UI necesita y excluye los votos', async () => {
    const rows = (await sql(`
      select c.relname
        from pg_publication_tables t
        join pg_class c on c.relname = t.tablename
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname
       where t.pubname = 'supabase_realtime' and t.schemaname = 'public'
       order by c.relname
    `)) as Array<{ relname: string }>

    const tables = rows.map((r) => r.relname)

    expect(tables).toContain('predictions')
    expect(tables).toContain('prediction_option_tallies')
    expect(tables).toContain('group_members')
    expect(tables).toContain('activity_events')
    expect(tables).toContain('prediction_scores')

    // Clave: los votos individuales NUNCA se publican.
    expect(tables).not.toContain('prediction_votes')
  })

  it('avisa a los demás cuando una predicción alcanza las 3 personas', async () => {
    const { data } = await ana.client.rpc('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Se suspende por lluvia?',
      p_options: ['Sí', 'No'],
      p_closes_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    const predictionId = data as unknown as string

    const options = (await sql(
      'select id from public.prediction_options where prediction_id = $1 order by position',
      [predictionId],
    )) as Array<{ id: string }>

    // Cami mira el feed; no vota.
    const seen: Array<{ status: string; participant_count: number }> = []
    const channel = cami.client.channel(`test-group:${groupId}`)
    channels.push(channel)

    const qualified = waitFor<{ status: string; participant_count: number }>(
      (row) => row.status === 'active',
      (handler) => {
        channel
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'predictions',
              filter: `group_id=eq.${groupId}`,
            },
            (payload) => {
              const row = payload.new as { status: string; participant_count: number }
              seen.push(row)
              handler(row)
            },
          )
          .subscribe()
      },
    )

    // Espera a que la suscripción esté realmente activa antes de votar.
    await new Promise((resolve) => setTimeout(resolve, 1500))

    await ana.client.rpc('cast_vote', {
      p_prediction_id: predictionId,
      p_option_id: options[0]!.id,
    })
    await beto.client.rpc('cast_vote', {
      p_prediction_id: predictionId,
      p_option_id: options[1]!.id,
    })
    await cami.client.rpc('cast_vote', {
      p_prediction_id: predictionId,
      p_option_id: options[0]!.id,
    })

    const final = await qualified

    expect(final.status).toBe('active')
    expect(final.participant_count).toBe(3)

    // Y por el camino se vio subir el contador, que es lo que hace que la
    // pantalla diga «2 de 3» sin recargar.
    expect(seen.map((row) => row.participant_count)).toContain(1)
  }, 30_000)

  it('removeChannel deja el cliente sin canales abiertos', async () => {
    const channel = ana.client.channel(`test-cleanup:${groupId}`)
    channel.subscribe()

    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(ana.client.getChannels().length).toBeGreaterThan(0)

    await ana.client.removeChannel(channel)
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(
      ana.client.getChannels().some((c) => c.topic === `realtime:test-cleanup:${groupId}`),
    ).toBe(false)
  }, 20_000)
})

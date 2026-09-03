import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createUser, sql, type TestUser } from './helpers'

/**
 * Avisos en vivo.
 *
 * Lo que se comprueba es lo que el producto promete: que el contador de
 * participación se mueva solo en la pantalla de los demás cuando alguien vota,
 * y que el salto de «En prueba» a confirmada llegue sin recargar.
 *
 * También se comprueba lo que NO tiene que pasar: que los votos ajenos no
 * viajen por el canal antes del cierre. `prediction_votes` no dispara ningún
 * trigger de aviso, a propósito.
 *
 * El transporte cambió —antes era la publicación lógica que leía Supabase
 * Realtime, ahora son triggers con `pg_notify` que el servidor reenvía por
 * WebSocket— pero la promesa es la misma, así que estos tests siguen mirando
 * lo mismo: se escucha el canal `friedict` directo desde Postgres, que es la
 * fuente de todo lo que después sale por el socket.
 */
const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54432/friedict'

interface Aviso {
  table: string
  event: string
  group_id: string
  prediction_id?: string
  status?: string
  previous_status?: string | null
  participant_count?: number
}

/** Escucha el canal y va guardando todo lo que llega. */
class Escucha {
  private client = new Client({ connectionString: ADMIN_URL })
  readonly avisos: Aviso[] = []

  async start(): Promise<void> {
    await this.client.connect()
    this.client.on('notification', (message) => {
      if (message.payload) this.avisos.push(JSON.parse(message.payload) as Aviso)
    })
    await this.client.query('listen friedict')
  }

  async stop(): Promise<void> {
    await this.client.end()
  }

  /** Espera a que llegue un aviso que cumpla la condición. */
  async waitFor(predicate: (aviso: Aviso) => boolean, timeoutMs = 8000): Promise<Aviso> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const found = this.avisos.find(predicate)
      if (found) return found
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`No llegó ningún aviso que cumpla la condición en ${timeoutMs}ms`)
  }
}

describe('avisos en vivo', () => {
  let ana: TestUser
  let beto: TestUser
  let cami: TestUser
  let groupId: string
  let predictionId: string
  let optionIds: string[]
  const escucha = new Escucha()

  beforeAll(async () => {
    await escucha.start()
    ;[ana, beto, cami] = await Promise.all([
      createUser('rt-ana'),
      createUser('rt-beto'),
      createUser('rt-cami'),
    ])

    const { data: group } = await ana.client.rpc<{ id: string }>('create_group', {
      p_name: 'Fútbol 5 (avisos)',
      p_display_name: 'Ana',
    })
    groupId = group!.id

    const { data: invite } = await ana.client.rpc<{ token: string }>('create_invite', {
      p_group_id: groupId,
      p_expires_in: '1 day',
    })
    const token = invite!.token

    await beto.client.rpc('join_group', { p_token: token, p_display_name: 'Beto' })
    await cami.client.rpc('join_group', { p_token: token, p_display_name: 'Cami' })

    const { data: id } = await ana.client.rpc<string>('create_prediction', {
      p_group_id: groupId,
      p_title: '¿Llegamos a las 3 personas?',
      p_options: ['Sí', 'No'],
      p_closes_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
    })
    predictionId = id!

    const options = await sql<{ id: string }>(
      'select id from public.prediction_options where prediction_id = $1 order by position',
      [predictionId],
    )
    optionIds = options.map((option) => option.id)
  })

  afterAll(async () => {
    await escucha.stop()
  })

  it('avisa a los demás cuando una predicción alcanza las 3 personas', async () => {
    await ana.client.rpc('cast_vote', {
      p_prediction_id: predictionId,
      p_option_id: optionIds[0],
    })
    await beto.client.rpc('cast_vote', {
      p_prediction_id: predictionId,
      p_option_id: optionIds[1],
    })

    // Con la tercera persona pasa de `proposed` a `active`, y ese salto es
    // justamente el que la UI muestra sin recargar.
    await cami.client.rpc('cast_vote', {
      p_prediction_id: predictionId,
      p_option_id: optionIds[0],
    })

    const aviso = await escucha.waitFor(
      (a) =>
        a.table === 'predictions' &&
        a.prediction_id === predictionId &&
        a.status === 'active' &&
        a.previous_status === 'proposed',
    )

    expect(aviso.group_id).toBe(groupId)
    expect(aviso.participant_count).toBe(3)
  })

  it('el contador de participación viaja, pero los votos ajenos no', async () => {
    // Hubo tres votos; ninguno generó un aviso de `prediction_votes`.
    const deVotos = escucha.avisos.filter((a) => a.table === 'prediction_votes')
    expect(deVotos).toEqual([])

    // Lo que sí viaja es el recuento por opción, cuya visibilidad la sigue
    // decidiendo la RLS cuando el cliente lo va a buscar.
    const deRecuentos = escucha.avisos.filter(
      (a) => a.table === 'prediction_option_tallies' && a.prediction_id === predictionId,
    )
    expect(deRecuentos.length).toBeGreaterThan(0)
  })

  it('ningún aviso lleva información secreta', async () => {
    // El payload es deliberadamente chico: nombres de tabla, ids y el estado.
    // Nada de quién votó qué, ni de cuántos votos tiene cada opción.
    for (const aviso of escucha.avisos) {
      const claves = Object.keys(aviso)
      expect(claves).not.toContain('user_id')
      expect(claves).not.toContain('option_id')
      expect(claves).not.toContain('vote_count')
    }
  })

  it('avisa cuando entra alguien al grupo', async () => {
    const aviso = escucha.avisos.find(
      (a) => a.table === 'group_members' && a.event === 'insert' && a.group_id === groupId,
    )
    expect(aviso).toBeTruthy()
  })
})

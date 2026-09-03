import pg from 'pg'
import { env } from './env.js'

/**
 * Acceso a Postgres.
 *
 * La pieza central de este archivo es `withUser`. Toda la seguridad de
 * friedict vive en la base —políticas RLS y funciones SECURITY DEFINER que
 * resuelven al usuario por sí solas—, y lo único que el servidor tiene que
 * hacer bien es decir QUIÉN está pidiendo. Eso se hace escribiendo la GUC
 * `app.user_id` al principio de cada transacción, que es lo que lee
 * `public.current_user_id()`.
 *
 * Si esto se hiciera mal, no habría un agujero puntual: se caería el modelo de
 * seguridad completo. Por eso no hay ninguna forma de ejecutar una consulta de
 * la aplicación fuera de `withUser`.
 */

// `pg` devuelve los timestamptz como Date en la zona del proceso, y al
// serializar a JSON quedan en UTC — que es exactamente lo que el cliente
// espera y lo que ya venía mandando PostgREST. Los `numeric`, en cambio,
// llegan como string para no perder precisión; los multiplicadores del
// puntaje son numeric(4,2) y el cliente los quiere como número.
pg.types.setTypeParser(1700, (value) => Number.parseFloat(value))
// int8: los conteos entran holgados en un number de JS.
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10))

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

export const adminPool = new pg.Pool({
  connectionString: env.adminDatabaseUrl,
  max: 2,
  idleTimeoutMillis: 10_000,
})

pool.on('error', (error) => {
  console.error('[db] cliente inactivo del pool falló:', error.message)
})

export type UserId = string | null

/**
 * Corre una unidad de trabajo como un usuario determinado.
 *
 * `set_config(..., true)` es LOCAL a la transacción: se limpia sola al hacer
 * commit o rollback. Sin ese `true`, la conexión volvería al pool con el
 * usuario todavía puesto y la siguiente petición —de otra persona— heredaría
 * esa identidad. Es la clase de bug que no se nota hasta que alguien ve datos
 * ajenos.
 */
export async function withUser<T>(
  userId: UserId,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    // Cadena vacía y no NULL: `current_setting` con una GUC nunca definida se
    // comporta distinto de una definida en vacío, y `current_user_id()` ya
    // traduce la vacía a NULL.
    await client.query('select set_config($1, $2, true)', ['app.user_id', userId ?? ''])
    const result = await work(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => {
      // Si el rollback falla, la conexión está rota; `release(error)` de abajo
      // la descarta del pool. El error que importa es el original.
    })
    throw error
  } finally {
    client.release()
  }
}

/** Atajo para las lecturas: una sola consulta, ya con el usuario puesto. */
export async function queryAs<T extends pg.QueryResultRow>(
  userId: UserId,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  return withUser(userId, async (client) => {
    const result = await client.query<T>(text, values)
    return result.rows
  })
}

export async function closePools(): Promise<void> {
  await Promise.allSettled([pool.end(), adminPool.end()])
}

import { readFileSync } from 'node:fs'
import { Client } from 'pg'

/**
 * Utilidades para los tests de integración.
 *
 * Estos tests hablan con el Postgres LOCAL (`npm run db:start`). Antes iban
 * contra el stack de Supabase a través de supabase-js; ahora van directo a la
 * base con el mismo mecanismo que usa el servidor en producción: una conexión
 * con el rol de la aplicación (NO superusuario, NO dueño de las tablas) y la
 * GUC `app.user_id` puesta por transacción.
 *
 * Eso hace que estos tests sigan probando exactamente lo que probaban: que la
 * RLS y las funciones SECURITY DEFINER dejan pasar lo que corresponde y
 * bloquean lo demás. Si la conexión fuera de superusuario, Postgres saltearía
 * la RLS y la suite entera pasaría sin demostrar nada.
 */

const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54432/friedict'
const APP_URL =
  process.env.DATABASE_URL ?? 'postgresql://friedict_app:friedict_app@127.0.0.1:54432/friedict'

/**
 * La MISMA lista blanca que usa el servidor. Importarla en vez de repetirla
 * es lo que garantiza que los tests ejerciten las funciones con los mismos
 * tipos y los mismos defaults que la aplicación real.
 */
interface FunctionSpec {
  params: Record<string, string>
  shape: 'scalar' | 'row' | 'table' | 'void'
  allowAnonymous?: boolean
}

const FUNCTIONS = (
  JSON.parse(readFileSync('db/rpc-functions.json', 'utf8')) as {
    functions: Record<string, FunctionSpec>
  }
).functions

/** Lo que devuelve una operación: la misma forma `{ data, error }` de antes. */
export interface Result<T> {
  data: T | null
  error: { message: string; code?: string } | null
}

function toResult<T>(run: () => Promise<T>): Promise<Result<T>> {
  return run().then(
    (data) => ({ data, error: null }),
    (error: { message?: string; code?: string }) => ({
      data: null,
      error: { message: error.message ?? 'error', ...(error.code ? { code: error.code } : {}) },
    }),
  )
}

/**
 * Constructor de consultas mínimo.
 *
 * Cubre sólo lo que los tests usan —`select`, `eq`, `in`, `order`, `limit`,
 * `single`, `maybeSingle`— y nada más. No pretende ser PostgREST: es la
 * superficie exacta que hace falta para que los tests de RLS sigan leyendo
 * igual que antes.
 */
class QueryBuilder<T = Record<string, unknown>> implements PromiseLike<Result<T[]>> {
  private filters: Array<{ column: string; op: 'eq' | 'in'; value: unknown }> = []
  private columns = '*'
  private orderBy: { column: string; ascending: boolean } | null = null
  private limitTo: number | null = null

  constructor(
    private readonly userId: string | null,
    private readonly table: string,
  ) {}

  select(columns = '*'): this {
    // Los embeds de PostgREST (`*, perfil:profiles(*)`) no se soportan: los
    // tests que los usaban se reescribieron con SQL explícito.
    this.columns = columns.includes('(') ? '*' : columns
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'eq', value })
    return this
  }

  in(column: string, value: unknown[]): this {
    this.filters.push({ column, op: 'in', value })
    return this
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending ?? true }
    return this
  }

  limit(count: number): this {
    this.limitTo = count
    return this
  }

  /**
   * Las escrituras se INTENTAN de verdad contra la base.
   *
   * No son un simulacro: el rol de la aplicación no tiene INSERT, UPDATE ni
   * DELETE sobre ninguna tabla —cada escritura pasa por una función SECURITY
   * DEFINER—, así que estas llamadas tienen que fallar con «permission
   * denied». Ese fallo ES lo que el test verifica.
   */
  insert(values: Record<string, unknown>): Promise<Result<T[]>> {
    const keys = Object.keys(values)
    const params = keys.map((_, i) => `$${i + 1}`)
    return toResult(() =>
      asUser<T>(
        this.userId,
        `insert into public.${this.table} (${keys.join(', ')}) values (${params.join(', ')}) returning *`,
        Object.values(values),
      ),
    )
  }

  update(values: Record<string, unknown>): WriteBuilder<T> {
    return new WriteBuilder<T>(this.userId, this.table, { kind: 'update', values })
  }

  delete(): WriteBuilder<T> {
    return new WriteBuilder<T>(this.userId, this.table, { kind: 'delete' })
  }

  private build(): { text: string; values: unknown[] } {
    const values: unknown[] = []
    const where = this.filters.map((filter) => {
      values.push(filter.value)
      return filter.op === 'in'
        ? `${filter.column} = any($${values.length})`
        : `${filter.column} = $${values.length}`
    })

    let text = `select ${this.columns} from public.${this.table}`
    if (where.length > 0) text += ` where ${where.join(' and ')}`
    if (this.orderBy) {
      text += ` order by ${this.orderBy.column} ${this.orderBy.ascending ? 'asc' : 'desc'}`
    }
    if (this.limitTo !== null) text += ` limit ${this.limitTo}`
    return { text, values }
  }

  private run(): Promise<T[]> {
    const { text, values } = this.build()
    return asUser<T>(this.userId, text, values)
  }

  async single(): Promise<Result<T>> {
    const result = await toResult(() => this.run())
    if (result.error) return { data: null, error: result.error }
    const rows = result.data ?? []
    if (rows.length !== 1) {
      return { data: null, error: { message: 'no_single_row', code: 'PGRST116' } }
    }
    return { data: rows[0] as T, error: null }
  }

  async maybeSingle(): Promise<Result<T | null>> {
    const result = await toResult(() => this.run())
    if (result.error) return { data: null, error: result.error }
    return { data: (result.data ?? [])[0] ?? null, error: null }
  }

  then<R1 = Result<T[]>, R2 = never>(
    onfulfilled?: ((value: Result<T[]>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return toResult(() => this.run()).then(onfulfilled, onrejected)
  }
}

/**
 * Escrituras con filtro: `update(...).eq(...)` y `delete().eq(...)`.
 *
 * Es una clase aparte y no más métodos en `QueryBuilder` porque una escritura
 * no comparte nada con una lectura salvo la tabla: no tiene `select`, ni
 * `order`, ni `limit`.
 */
class WriteBuilder<T> implements PromiseLike<Result<T[]>> {
  private filters: Array<{ column: string; value: unknown }> = []

  constructor(
    private readonly userId: string | null,
    private readonly table: string,
    private readonly operation:
      | { kind: 'update'; values: Record<string, unknown> }
      | { kind: 'delete' },
  ) {}

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value })
    return this
  }

  private run(): Promise<T[]> {
    const values: unknown[] = []
    let text: string

    if (this.operation.kind === 'update') {
      const assignments = Object.entries(this.operation.values).map(([key, value]) => {
        values.push(value)
        return `${key} = $${values.length}`
      })
      text = `update public.${this.table} set ${assignments.join(', ')}`
    } else {
      text = `delete from public.${this.table}`
    }

    const where = this.filters.map((filter) => {
      values.push(filter.value)
      return `${filter.column} = $${values.length}`
    })
    if (where.length > 0) text += ` where ${where.join(' and ')}`

    return asUser<T>(this.userId, `${text} returning *`, values)
  }

  then<R1 = Result<T[]>, R2 = never>(
    onfulfilled?: ((value: Result<T[]>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return toResult(() => this.run()).then(onfulfilled, onrejected)
  }
}

/** Corre SQL como un usuario, igual que hace el servidor. */
export async function asUser<T>(
  userId: string | null,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: APP_URL })
  await client.connect()
  try {
    await client.query('begin')
    await client.query('select set_config($1, $2, true)', ['app.user_id', userId ?? ''])
    const result = await client.query(text, values)
    await client.query('commit')
    return result.rows as T[]
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

/** Cliente atado a una identidad. Reemplaza al `SupabaseClient` de antes. */
export interface Db {
  from<T = Record<string, unknown>>(table: string): QueryBuilder<T>
  rpc<T = unknown>(fn: string, params?: Record<string, unknown>): Promise<Result<T>>
}

export function clientFor(userId: string | null): Db {
  return {
    from: <T,>(table: string) => new QueryBuilder<T>(userId, table),
    rpc: <T,>(fn: string, params: Record<string, unknown> = {}) =>
      toResult<T>(async () => {
        const spec = FUNCTIONS[fn]
        if (!spec) throw new Error(`${fn} no está en db/rpc-functions.json`)

        // Argumentos por nombre y con su tipo, exactamente como los manda el
        // servidor: por nombre para que los ausentes tomen el default de la
        // función, y con tipo porque Postgres no puede inferir el de un
        // parámetro suelto cuando es un enum o un interval.
        const names: string[] = []
        const values: unknown[] = []
        for (const [key, value] of Object.entries(params)) {
          if (value === undefined) continue
          const type = spec.params[key]
          if (!type) throw new Error(`${fn} no declara el parámetro ${key}`)
          values.push(value)
          names.push(`${key} => $${values.length}::${type}`)
        }

        const call = `public.${fn}(${names.join(', ')})`
        if (spec.shape === 'table') {
          return (await asUser(userId, `select * from ${call}`, values)) as T
        }
        // `to_jsonb` también para los compuestos: sin eso, una función que
        // devuelve `public.groups` llega como el string "(uuid,nombre,...)".
        const rows = await asUser<{ result: T }>(
          userId,
          `select to_jsonb(${call}) as result`,
          values,
        )
        return rows[0]?.result as T
      }),
  }
}

export function anonClient(): Db {
  return clientFor(null)
}

export interface TestUser {
  client: Db
  id: string
  email: string
}

/** Crea una cuenta nueva y devuelve un cliente atado a ella. */
export async function createUser(prefix: string): Promise<TestUser> {
  const email = `${prefix}-${crypto.randomUUID().slice(0, 8)}@cantado.test`
  const rows = await sql<{ id: string }>(
    `insert into public.users (email, password_hash)
     values ($1, crypt('cantado123', gen_salt('bf')))
     returning id`,
    [email],
  )
  const id = rows[0]?.id
  if (!id) throw new Error(`No se pudo crear el usuario ${email}`)
  return { client: clientFor(id), id, email }
}

/** "Inicia sesión" con una de las cuentas del seed. */
export async function signInSeeded(email: string): Promise<TestUser> {
  const rows = await sql<{ id: string }>('select id from public.users where email = $1', [email])
  const id = rows[0]?.id
  if (!id) throw new Error(`No existe la cuenta sembrada ${email}`)
  return { client: clientFor(id), id, email }
}

/**
 * Acceso directo a Postgres como superusuario, sólo para lo que un cliente no
 * puede ni debe hacer: viajar en el tiempo (correr `closes_at` al pasado) y
 * leer estado SIN pasar por RLS, para comprobar que la RLS efectivamente
 * ocultó algo.
 */
export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: ADMIN_URL })
  await client.connect()
  try {
    return (await client.query(text, params)).rows as T[]
  } finally {
    await client.end()
  }
}

/** Adelanta el reloj de una predicción moviendo sus fechas hacia atrás. */
export async function timeTravel(predictionId: string, shift: string): Promise<void> {
  await sql(
    `update public.predictions
        set opens_at = opens_at - $2::interval,
            qualification_deadline = qualification_deadline - $2::interval,
            closes_at = closes_at - $2::interval
      where id = $1`,
    [predictionId, shift],
  )
}

export async function finalize(): Promise<void> {
  await sql('select public.finalize_predictions()')
}

export async function predictionStatus(predictionId: string): Promise<string> {
  const rows = await sql<{ status: string }>(
    'select status from public.predictions where id = $1',
    [predictionId],
  )
  return rows[0]?.status ?? 'missing'
}

export const SEED = {
  losPibes: 'aaaaaaaa-0000-4000-8000-000000000001',
  futbol5: 'aaaaaaaa-0000-4000-8000-000000000002',
  bauti: '11111111-1111-4111-8111-111111111111',
  caro: '66666666-6666-4666-8666-666666666666',
  enPrueba: 'bbbbbbbb-0000-4000-8000-000000000001',
  cerrada: 'bbbbbbbb-0000-4000-8000-000000000003',
  resuelta: 'bbbbbbbb-0000-4000-8000-000000000004',
  evolutiva: 'bbbbbbbb-0000-4000-8000-000000000006',
  futbolPrediccion: 'bbbbbbbb-0000-4000-8000-000000000101',
  inviteToken: 'seedseedseedseedseedseedseedseed',
  expiredToken: 'expiredexpiredexpiredexpiredexpi',
} as const

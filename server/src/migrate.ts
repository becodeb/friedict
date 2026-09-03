import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adminPool } from './db.js'
import { env } from './env.js'

/**
 * Migraciones.
 *
 * Corren al arrancar el servidor, con el rol superusuario y no con el de la
 * aplicación. Eso importa por dos motivos:
 *
 *   · crear roles y extensiones necesita privilegios que el rol de la app no
 *     tiene (ni debe tener);
 *   · el DUEÑO de las tablas queda siendo el superusuario. Postgres saltea la
 *     RLS para el dueño de la tabla, así que si la app fuera la dueña, todas
 *     las políticas del proyecto no harían absolutamente nada.
 *
 * Cada archivo se aplica una sola vez y queda anotado. Son idempotentes de
 * todas formas (`if not exists`, `create or replace`), pero anotarlas hace que
 * un arranque normal no vuelva a ejecutar 2000 líneas de SQL cada vez.
 */

/**
 * Dónde están los .sql.
 *
 * Cambia según desde dónde corra el proceso: compilado queda en `server/dist`,
 * y en la imagen de Docker el `db/` se copia al lado del `dist/`. En vez de
 * hardcodear una de las dos, se prueban las dos y se usa la que exista — así
 * el mismo binario anda en desarrollo y en producción sin variables extra.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const DB_DIR = [join(HERE, '..', 'db'), join(HERE, '..', '..', 'db')].find((candidate) =>
  existsSync(join(candidate, 'migrations')),
)

if (!DB_DIR) {
  throw new Error(
    `No encontré el directorio db/migrations. Busqué en ${join(HERE, '..', 'db')} y ${join(HERE, '..', '..', 'db')}.`,
  )
}

const MIGRATIONS_DIR = join(DB_DIR, 'migrations')
const SEED_FILE = join(DB_DIR, 'seed.sql')

/**
 * El rol con el que la app consulta. Sale de DATABASE_URL para que haya una
 * sola fuente de verdad: si alguien cambia la URL, el rol que se crea es el
 * que se va a usar.
 */
function appRoleFromUrl(url: string): { user: string; password: string } {
  const parsed = new URL(url)
  const user = decodeURIComponent(parsed.username)
  const password = decodeURIComponent(parsed.password)
  if (!user || !password) {
    throw new Error('DATABASE_URL tiene que incluir usuario y contraseña.')
  }
  return { user, password }
}

/**
 * Crea el rol de login de la aplicación.
 *
 * Va ANTES de las migraciones porque tiene que existir para poder concederle
 * permisos, pero sólo se crea: los `grant` van después, en `grantAppRole`,
 * porque los roles `authenticated` y `anon` que hereda los crea la migración
 * 000 y todavía no existen en este punto.
 */
async function ensureAppRole(): Promise<void> {
  const { user, password } = appRoleFromUrl(env.databaseUrl)

  // Ni el nombre del rol ni la contraseña pueden viajar como parámetros: en
  // `create role` los dos son parte de la sintaxis, no valores. Así que el
  // nombre se valida contra una lista blanca de caracteres y la contraseña se
  // escapa con el escapador del propio driver, que es el que sabe las reglas
  // de Postgres. Armar el literal a mano acá sería pedir un problema.
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(user)) {
    throw new Error(`Nombre de rol inválido en DATABASE_URL: ${user}`)
  }

  const client = await adminPool.connect()
  try {
    const quotedName = client.escapeIdentifier(user)
    const quotedPassword = client.escapeLiteral(password)

    const { rowCount } = await client.query('select 1 from pg_roles where rolname = $1', [user])
    if (rowCount === 0) {
      await client.query(`create role ${quotedName} login password ${quotedPassword}`)
    } else {
      await client.query(`alter role ${quotedName} login password ${quotedPassword}`)
    }
  } finally {
    client.release()
  }

  console.log(`[migrate] rol de aplicación listo: ${user}`)
}

/**
 * Le da al rol de la app los permisos que necesita, una vez que las
 * migraciones crearon los roles de los que hereda.
 *
 * `authenticated` es a quien apuntan los GRANT del esquema y las políticas RLS
 * (`to authenticated`). Con `inherit` los toma solo, sin necesidad de un
 * `set role` en cada conexión.
 */
async function grantAppRole(): Promise<void> {
  const { user } = appRoleFromUrl(env.databaseUrl)
  const client = await adminPool.connect()
  try {
    const quotedName = client.escapeIdentifier(user)
    await client.query(`grant authenticated, anon to ${quotedName}`)
    await client.query(`alter role ${quotedName} inherit`)
  } finally {
    client.release()
  }
}

async function appliedMigrations(): Promise<Set<string>> {
  await adminPool.query(`
    create table if not exists public._migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `)
  // Es infraestructura, no datos del producto, pero igual lleva RLS: la tabla
  // vive en `public` y un test verifica que ninguna tabla de ese esquema quede
  // sin protección. Sin políticas, RLS niega todo.
  await adminPool.query('alter table public._migrations enable row level security')

  const { rows } = await adminPool.query<{ name: string }>('select name from public._migrations')
  return new Set(rows.map((row) => row.name))
}

export async function runMigrations(): Promise<void> {
  await ensureAppRole()

  const applied = await appliedMigrations()
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()

  for (const file of files) {
    if (applied.has(file)) continue

    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
    const client = await adminPool.connect()
    try {
      // Cada migración es una transacción: o entra entera o no entra nada.
      await client.query('begin')
      await client.query(sql)
      await client.query('insert into public._migrations (name) values ($1)', [file])
      await client.query('commit')
      console.log(`[migrate] aplicada ${file}`)
    } catch (error) {
      await client.query('rollback').catch(() => {})
      throw new Error(
        `La migración ${file} falló: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      client.release()
    }
  }

  if (files.every((f) => applied.has(f))) {
    console.log('[migrate] sin migraciones pendientes')
  }

  // Recién ahora existen `authenticated` y `anon`.
  await grantAppRole()
}

/**
 * Carga los datos de ejemplo. Sólo se llama si `SEED_ON_BOOT=1`, y aun así se
 * saltea si ya hay grupos: sembrar dos veces duplicaría todo.
 */
export async function runSeed(): Promise<void> {
  const { rows } = await adminPool.query<{ count: number }>(
    'select count(*)::int as count from public.groups',
  )
  if ((rows[0]?.count ?? 0) > 0) {
    console.log('[seed] ya hay datos, no se siembra de nuevo')
    return
  }

  const sql = await readFile(SEED_FILE, 'utf8')
  await adminPool.query(sql)
  console.log('[seed] datos de ejemplo cargados')
}

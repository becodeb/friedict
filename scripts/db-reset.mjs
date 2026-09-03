/**
 * Deja la base local en cero: esquema limpio, migraciones aplicadas y datos de
 * ejemplo cargados.
 *
 *   npm run db:reset
 *
 * Es el reemplazo de `supabase db reset`. Aplica los mismos archivos que aplica
 * el servidor al arrancar, en el mismo orden, así que lo que queda acá es
 * exactamente lo que va a haber en producción.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'

const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54432/friedict'
const APP_USER = process.env.APP_DB_USER ?? 'friedict_app'
const APP_PASSWORD = process.env.APP_DB_PASSWORD ?? 'friedict_app'

const client = new pg.Client({ connectionString: ADMIN_URL })
await client.connect()

try {
  // Se tira el esquema entero, no tabla por tabla: así no queda ningún tipo,
  // función o trigger viejo dando vueltas que enmascare un error real.
  console.log('· limpiando el esquema')
  await client.query('drop schema if exists public cascade')
  await client.query('create schema public')
  await client.query('grant all on schema public to postgres')

  // El rol de la app sobrevive al drop (los roles son del cluster, no del
  // esquema), pero puede no existir la primera vez.
  const exists = await client.query('select 1 from pg_roles where rolname = $1', [APP_USER])
  if (exists.rowCount === 0) {
    await client.query(
      `create role ${client.escapeIdentifier(APP_USER)} login password ${client.escapeLiteral(APP_PASSWORD)}`,
    )
    console.log(`· rol ${APP_USER} creado`)
  }

  const dir = 'db/migrations'
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    await client.query(await readFile(join(dir, file), 'utf8'))
    console.log(`· ${file}`)
  }

  // El rol de la app hereda de `authenticated`, que es a quien apuntan los
  // GRANT del esquema y las políticas RLS.
  await client.query(
    `grant authenticated, anon to ${client.escapeIdentifier(APP_USER)}`,
  )
  await client.query(`alter role ${client.escapeIdentifier(APP_USER)} inherit`)

  await client.query(await readFile('db/seed.sql', 'utf8'))
  console.log('· seed')

  // El servidor lleva su propio registro de migraciones aplicadas; como acá se
  // aplicaron todas a mano, se anotan para que no las repita al arrancar.
  await client.query(`
    create table if not exists public._migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `)
  // Es infraestructura, pero vive en `public` y un test verifica que ninguna
  // tabla de ese esquema quede sin RLS.
  await client.query('alter table public._migrations enable row level security')

  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    await client.query(
      'insert into public._migrations (name) values ($1) on conflict do nothing',
      [file],
    )
  }

  console.log('\nBase lista. Todas las cuentas del seed usan la contraseña cantado123.')
} finally {
  await client.end()
}

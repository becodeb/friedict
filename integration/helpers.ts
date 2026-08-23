import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import type { Database } from '../src/lib/database.types'

/**
 * Utilidades para los tests de integración.
 *
 * Estos tests hablan con el stack LOCAL de Supabase (`npx supabase start`).
 * Las claves de abajo son las de demo del CLI, iguales en todas las
 * instalaciones y publicadas en la documentación: no son secretos y no existen
 * fuera de tu máquina.
 */
export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54421'
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54422/postgres'

export type Db = SupabaseClient<Database>

export function anonClient(): Db {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface TestUser {
  client: Db
  id: string
  email: string
}

/** Crea una cuenta nueva y devuelve un cliente ya autenticado con ella. */
export async function createUser(prefix: string): Promise<TestUser> {
  const client = anonClient()
  const email = `${prefix}-${crypto.randomUUID().slice(0, 8)}@cantado.test`

  const { data, error } = await client.auth.signUp({ email, password: 'cantado123' })
  if (error) throw new Error(`signUp(${email}): ${error.message}`)
  if (!data.user) throw new Error('signUp no devolvió usuario')

  return { client, id: data.user.id, email }
}

/** Inicia sesión con una de las cuentas del seed. */
export async function signInSeeded(email: string): Promise<TestUser> {
  const client = anonClient()
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: 'cantado123',
  })
  if (error) throw new Error(`signIn(${email}): ${error.message}`)
  return { client, id: data.user.id, email }
}

/**
 * Acceso directo a Postgres, sólo para lo que un cliente no puede ni debe
 * hacer: viajar en el tiempo (correr `closes_at` al pasado) y leer estado sin
 * pasar por RLS para comprobar que la RLS efectivamente ocultó algo.
 */
export async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: DB_URL })
  await db.connect()
  try {
    return await fn(db)
  } finally {
    await db.end()
  }
}

export async function sql(text: string, params: unknown[] = []): Promise<unknown[]> {
  return withDb(async (db) => (await db.query(text, params)).rows)
}

/** Adelanta el reloj de una predicción moviendo sus fechas hacia atrás. */
export async function timeTravel(
  predictionId: string,
  shift: string, // p.ej. '3 days'
): Promise<void> {
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
  const rows = (await sql('select status from public.predictions where id = $1', [
    predictionId,
  ])) as Array<{ status: string }>
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

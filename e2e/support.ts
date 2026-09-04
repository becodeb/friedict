import { Client } from 'pg'
import type { Page } from '@playwright/test'

export const APP_URL = process.env.E2E_APP_URL ?? 'http://localhost:5183'
const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54432/friedict'
const APP_DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://friedict_app:friedict_app@127.0.0.1:54432/friedict'

export const SEED = {
  losPibes: 'aaaaaaaa-0000-4000-8000-000000000001',
  futbol5: 'aaaaaaaa-0000-4000-8000-000000000002',
  enPrueba: 'bbbbbbbb-0000-4000-8000-000000000001',
  cerrada: 'bbbbbbbb-0000-4000-8000-000000000003',
  resuelta: 'bbbbbbbb-0000-4000-8000-000000000004',
  evolutiva: 'bbbbbbbb-0000-4000-8000-000000000006',
  inviteToken: 'seedseedseedseedseedseedseedseed',
  expiredToken: 'expiredexpiredexpiredexpiredexpi',
} as const

/** La contraseña del seed. Sólo existe en `db/seed.sql`. */
export const SEED_PASSWORD = 'cantado123'

export async function sql(text: string, params: unknown[] = []): Promise<unknown[]> {
  const db = new Client({ connectionString: ADMIN_URL })
  await db.connect()
  try {
    return (await db.query(text, params)).rows
  } finally {
    await db.end()
  }
}

/** Corre SQL con la identidad de alguien, igual que hace el servidor. */
async function asUser(userId: string, text: string, params: unknown[] = []): Promise<unknown[]> {
  const db = new Client({ connectionString: APP_DB_URL })
  await db.connect()
  try {
    await db.query('begin')
    await db.query('select set_config($1, $2, true)', ['app.user_id', userId])
    const rows = (await db.query(text, params)).rows
    await db.query('commit')
    return rows
  } catch (error) {
    await db.query('rollback').catch(() => {})
    throw error
  } finally {
    await db.end()
  }
}

export async function userIdFor(email: string): Promise<string> {
  const rows = (await sql('select id from public.users where email = $1', [email])) as Array<{
    id: string
  }>
  const id = rows[0]?.id
  if (!id) throw new Error(`No existe la cuenta ${email}. ¿Corriste el seed?`)
  return id
}

/**
 * Deja al navegador con sesión iniciada.
 *
 * No es un atajo que saltee la autenticación: pega contra el mismo endpoint
 * que usa la app y guarda la cookie que devuelve. Como la sesión es una cookie
 * `httpOnly`, no se puede inyectar desde `localStorage` como antes — hay que
 * ponerla en el contexto del navegador.
 */
export async function signInAs(page: Page, email: string): Promise<string> {
  const response = await fetch(`${APP_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: SEED_PASSWORD }),
  })
  if (!response.ok) {
    throw new Error(`No se pudo iniciar sesión como ${email}: ${response.status}`)
  }

  const setCookie = response.headers.get('set-cookie')
  const token = setCookie ? /friedict_session=([^;]+)/.exec(setCookie)?.[1] : null
  if (!token) throw new Error('El login no devolvió la cookie de sesión')

  const url = new URL(APP_URL)
  await page.context().addCookies([
    {
      name: 'friedict_session',
      value: token,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
    },
  ])

  const { user } = (await response.json()) as { user: { id: string } }
  return user.id
}

/** Fija el tema para que las capturas de fallo sean comparables. */
export async function useLightTheme(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('friedict.theme', 'light')
  })
}

/**
 * Corre las fechas de una predicción hacia el pasado y reevalúa los estados.
 *
 * `qualification_deadline` ya no se mueve — nada la lee (nada expira más).
 * `firstCastAtUserId` es opcional y sirve para simular el paso del tiempo
 * sobre la ventana de cambio de voto de una persona puntual, sin tocar
 * `created_at` (ver el comentario largo en `705_vote_window_and_scoring.sql`).
 */
export async function timeTravel(
  predictionId: string,
  shift: string,
  options: { firstCastAtUserId?: string } = {},
): Promise<void> {
  await sql(
    `update public.predictions
        set opens_at = opens_at - $2::interval,
            closes_at = closes_at - $2::interval
      where id = $1`,
    [predictionId, shift],
  )
  if (options.firstCastAtUserId) {
    await sql(
      `update public.prediction_votes
          set first_cast_at = first_cast_at - $3::interval
        where prediction_id = $1 and user_id = $2`,
      [predictionId, options.firstCastAtUserId, shift],
    )
  }
  await sql('select public.finalize_predictions()')
}

export async function statusOf(predictionId: string): Promise<string> {
  const rows = (await sql('select status from public.predictions where id = $1', [
    predictionId,
  ])) as Array<{ status: string }>
  return rows[0]?.status ?? 'missing'
}

/** Crea una predicción directamente, como el creador indicado. */
export async function createPredictionAs(
  email: string,
  groupId: string,
  title: string,
  options: string[],
  closesInHours = 48,
): Promise<string> {
  const userId = await userIdFor(email)
  const rows = (await asUser(
    userId,
    `select public.create_prediction(
       p_group_id => $1::uuid,
       p_title => $2::text,
       p_options => $3::text[],
       p_closes_at => $4::timestamptz
     ) as id`,
    [groupId, title, options, new Date(Date.now() + closesInHours * 3_600_000).toISOString()],
  )) as Array<{ id: string }>

  const id = rows[0]?.id
  if (!id) throw new Error('create_prediction no devolvió id')
  return id
}

export async function voteAs(
  email: string,
  predictionId: string,
  optionLabel: string,
): Promise<void> {
  const userId = await userIdFor(email)
  const rows = (await sql(
    'select id from public.prediction_options where prediction_id = $1 and label = $2',
    [predictionId, optionLabel],
  )) as Array<{ id: string }>

  const optionId = rows[0]?.id
  if (!optionId) throw new Error(`No existe la opción «${optionLabel}»`)

  await asUser(
    userId,
    'select public.cast_vote(p_prediction_id => $1::uuid, p_option_id => $2::uuid)',
    [predictionId, optionId],
  )
}

/** Confirma (o rechaza) una propuesta de resultado, como la persona indicada. */
export async function confirmResolutionAs(
  email: string,
  resolutionId: string,
  agrees = true,
): Promise<void> {
  const userId = await userIdFor(email)
  await asUser(
    userId,
    'select public.confirm_resolution(p_resolution_id => $1::uuid, p_agrees => $2::boolean)',
    [resolutionId, agrees],
  )
}

import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'
import type { Page } from '@playwright/test'

export const SUPABASE_URL = 'http://127.0.0.1:54421'
export const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
export const MAILPIT = 'http://127.0.0.1:54424'
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres'

export const SEED = {
  losPibes: 'aaaaaaaa-0000-4000-8000-000000000001',
  enPrueba: 'bbbbbbbb-0000-4000-8000-000000000001',
  cerrada: 'bbbbbbbb-0000-4000-8000-000000000003',
  resuelta: 'bbbbbbbb-0000-4000-8000-000000000004',
  evolutiva: 'bbbbbbbb-0000-4000-8000-000000000006',
  inviteToken: 'seedseedseedseedseedseedseedseed',
  expiredToken: 'expiredexpiredexpiredexpiredexpi',
} as const

export async function sql(text: string, params: unknown[] = []): Promise<unknown[]> {
  const db = new Client({ connectionString: DB_URL })
  await db.connect()
  try {
    return (await db.query(text, params)).rows
  } finally {
    await db.end()
  }
}

/**
 * Inyecta una sesión real en localStorage antes de que cargue la app.
 *
 * No es un atajo que saltee la autenticación: la sesión se obtiene del mismo
 * endpoint que usa la app. Sirve para que los tests de flujo no tengan que
 * pasar por el mail cada vez. El recorrido real del Magic Link se prueba
 * aparte, de punta a punta, en auth.spec.ts.
 */
export async function signInAs(page: Page, email: string): Promise<string> {
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: 'cantado123',
  })
  if (error) throw new Error(`No se pudo iniciar sesión como ${email}: ${error.message}`)

  await page.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key as string, JSON.stringify(session))
    },
    ['friedict.auth', data.session] as const,
  )

  return data.user!.id
}

/** Fija el tema para que las capturas de fallo sean comparables. */
export async function useLightTheme(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('friedict.theme', 'light')
  })
}

interface MailpitMessage {
  ID: string
  To: Array<{ Address: string }>
  Created: string
}

/** Busca el último mail dirigido a una dirección y devuelve su link de acceso. */
export async function magicLinkFor(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const listResponse = await fetch(`${MAILPIT}/api/v1/messages?limit=50`)
    const list = (await listResponse.json()) as { messages: MailpitMessage[] }

    const message = list.messages?.find((candidate) =>
      candidate.To?.some((to) => to.Address.toLowerCase() === email.toLowerCase()),
    )

    if (message) {
      const detail = (await (
        await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)
      ).json()) as { HTML?: string; Text?: string }

      const body = `${detail.HTML ?? ''}\n${detail.Text ?? ''}`
      const match = /https?:\/\/[^\s"'<>]*\/auth\/v1\/verify[^\s"'<>]*/.exec(body)
      if (match) return match[0].replaceAll('&amp;', '&')
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(`No llegó ningún mail para ${email} en ${timeoutMs}ms`)
}

export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' })
}

/** Corre las fechas de una predicción hacia el pasado y reevalúa los estados. */
export async function timeTravel(predictionId: string, shift: string): Promise<void> {
  await sql(
    `update public.predictions
        set opens_at = opens_at - $2::interval,
            qualification_deadline = qualification_deadline - $2::interval,
            closes_at = closes_at - $2::interval
      where id = $1`,
    [predictionId, shift],
  )
  await sql('select public.finalize_predictions()')
}

export async function statusOf(predictionId: string): Promise<string> {
  const rows = (await sql('select status from public.predictions where id = $1', [
    predictionId,
  ])) as Array<{ status: string }>
  return rows[0]?.status ?? 'missing'
}

/** Crea una predicción de prueba directamente por RPC, como el creador indicado. */
export async function createPredictionAs(
  email: string,
  groupId: string,
  title: string,
  options: string[],
  closesInHours = 48,
): Promise<string> {
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  })
  await supabase.auth.signInWithPassword({ email, password: 'cantado123' })

  const { data, error } = await supabase.rpc('create_prediction', {
    p_group_id: groupId,
    p_title: title,
    p_options: options,
    p_closes_at: new Date(Date.now() + closesInHours * 3_600_000).toISOString(),
  })
  if (error) throw new Error(`create_prediction: ${error.message}`)
  return data as unknown as string
}

export async function voteAs(
  email: string,
  predictionId: string,
  optionLabel: string,
): Promise<void> {
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  })
  await supabase.auth.signInWithPassword({ email, password: 'cantado123' })

  const rows = (await sql(
    'select id from public.prediction_options where prediction_id = $1 and label = $2',
    [predictionId, optionLabel],
  )) as Array<{ id: string }>

  const { error } = await supabase.rpc('cast_vote', {
    p_prediction_id: predictionId,
    p_option_id: rows[0]!.id,
  })
  if (error) throw new Error(`cast_vote: ${error.message}`)
}

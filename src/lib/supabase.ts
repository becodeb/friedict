import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Cliente único. Se crea a nivel de módulo a propósito: instanciarlo dentro de
 * un componente genera canales Realtime duplicados en cada render.
 *
 * Sólo la clave pública (anon / publishable) vive acá. `service_role` jamás
 * toca el navegador: no existe ninguna variable `VITE_*` que la contenga.
 */

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. Copiá .env.example a .env.local y completalas.',
  )
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'friedict.auth',
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
  global: {
    headers: { 'x-application-name': 'friedict' },
  },
})

/** URL absoluta a la que vuelve el Magic Link. */
export function authRedirectTo(next?: string): string {
  const base = `${window.location.origin}/auth/callback`
  return next ? `${base}?next=${encodeURIComponent(next)}` : base
}

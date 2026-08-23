/**
 * Abre la app en un navegador de verdad, listo para recorrer.
 *
 *   node scripts/abrir.mjs
 *
 * Levanta dos ventanas:
 *   · Con sesión iniciada como Bauti, en el grupo «Los pibes».
 *   · Sin sesión, para ver la portada y una invitación como la vería alguien
 *     que abre el link desde un chat.
 *
 * La sesión se obtiene del mismo endpoint que usa la app y se inyecta en
 * localStorage. No se pasa por el Magic Link porque el flujo PKCE guarda su
 * verificador en el navegador que PIDIÓ el link: un link generado desde acá no
 * lo podría canjear otra ventana.
 *
 * Se cierra con Ctrl+C.
 */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const APP = 'http://localhost:5183'
const SUPABASE_URL = 'http://127.0.0.1:54421'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

const GRUPO = 'aaaaaaaa-0000-4000-8000-000000000001'
const EVOLUTIVA = 'bbbbbbbb-0000-4000-8000-000000000006'
const RESUELTA = 'bbbbbbbb-0000-4000-8000-000000000004'
const CERRADA = 'bbbbbbbb-0000-4000-8000-000000000003'
const INVITE = 'seedseedseedseedseedseedseedseed'

const supabase = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } })
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'bauti@cantado.test',
  password: 'cantado123',
})
if (error) {
  console.error(`No se pudo iniciar sesión: ${error.message}`)
  console.error('¿Corriste `npm run db:reset`?')
  process.exit(1)
}

const browser = await chromium.launch({
  headless: false,
  args: ['--window-size=1360,940', '--window-position=40,20'],
})

// ── Ventana 1: con sesión ────────────────────────────────────────────────────
const conSesion = await browser.newContext({
  viewport: null,
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
})
await conSesion.addInitScript(
  ([key, session]) => window.localStorage.setItem(key, JSON.stringify(session)),
  ['cantado.auth', data.session],
)

const pestanias = [
  { url: `${APP}/g/${GRUPO}`, que: 'Feed del grupo — mirá la de «En prueba», 2 de 3' },
  { url: `${APP}/g/${GRUPO}/p/${EVOLUTIVA}`, que: 'Evolutiva con gráfico de cómo cambió la opinión' },
  { url: `${APP}/g/${GRUPO}/p/${CERRADA}`, que: 'Cerrada: acá se resuelve el resultado' },
  { url: `${APP}/g/${GRUPO}/p/${RESUELTA}`, que: 'Resuelta: puntos repartidos (+ confeti, acertaste)' },
  { url: `${APP}/g/${GRUPO}/ranking`, que: 'Ranking del grupo' },
  { url: `${APP}/g/${GRUPO}/historial`, que: 'Historial y actividad' },
]

for (const { url } of pestanias) {
  const page = await conSesion.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {})
}
// La primera pestaña queda al frente.
await conSesion.pages()[0]?.bringToFront()

// ── Ventana 2: sin sesión ────────────────────────────────────────────────────
const sinSesion = await browser.newContext({
  viewport: null,
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
})
for (const url of [`${APP}/`, `${APP}/join/${INVITE}`, `${APP}/join/tokenroto`]) {
  const page = await sinSesion.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {})
}
await sinSesion.pages()[0]?.bringToFront()

console.log('\n  CANTADO — abierto en el navegador\n')
console.log('  Ventana 1 · con sesión como Bauti')
for (const { que } of pestanias) console.log(`     · ${que}`)
console.log('\n  Ventana 2 · sin sesión')
console.log('     · Portada')
console.log('     · Invitación válida a «Los pibes»')
console.log('     · Invitación rota (no revela nada del grupo)')
console.log('\n  Probá también:')
console.log('     · El botón ☾ del encabezado cambia a tema oscuro')
console.log('     · «Nueva predicción» abre el formulario')
console.log('     · Achicá la ventana para ver el layout mobile')
console.log('\n  Mailpit (los mails de acceso):  http://127.0.0.1:54424')
console.log('  Supabase Studio (la base):     http://127.0.0.1:54423')
console.log('\n  Ctrl+C para cerrar.\n')

// Se queda abierto hasta que lo cierres.
await new Promise(() => {})

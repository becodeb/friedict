/**
 * QA visual.
 *
 * Recorre las pantallas principales en tres viewports, guarda capturas y —lo
 * más importante— junta TODO lo que la app haya escrito en la consola o dejado
 * como pedido fallido. Compilar no es lo mismo que funcionar.
 *
 *   node scripts/visual-qa.mjs
 */
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const APP = 'http://localhost:5183'
const SUPABASE_URL = 'http://127.0.0.1:54421'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const GROUP = 'aaaaaaaa-0000-4000-8000-000000000001'
const OUT = 'screenshots'

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 900 },
}

await mkdir(OUT, { recursive: true })

// Sesión real, obtenida con el mismo cliente que usa la app.
const supabase = createClient(SUPABASE_URL, ANON)
const { data: auth, error } = await supabase.auth.signInWithPassword({
  email: 'bauti@cantado.test',
  password: 'cantado123',
})
if (error) throw new Error(`No se pudo iniciar sesión: ${error.message}`)

const browser = await chromium.launch()
const problems = []

async function visit(page, name, path, { wait = 900 } = {}) {
  await page.goto(`${APP}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(wait)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })

  // Overflow horizontal: el pecado mortal en mobile.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  if (overflow) {
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    problems.push(`[overflow] ${name}: scrollWidth=${width}px`)
  }
  console.log(`  ✓ ${name}`)
}

for (const [label, viewport] of Object.entries(VIEWPORTS)) {
  console.log(`\n── ${label} ${viewport.width}×${viewport.height}`)

  const context = await browser.newContext({ viewport, locale: 'es-AR' })
  const page = await context.newPage()

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      const text = message.text()
      // Vite inyecta su propio ruido en dev.
      if (text.includes('[vite]') || text.includes('Download the React DevTools')) return
      problems.push(`[console.${message.type()}] ${label}: ${text.slice(0, 220)}`)
    }
  })
  page.on('pageerror', (err) => {
    problems.push(`[pageerror] ${label}: ${err.message.slice(0, 220)}`)
  })
  page.on('requestfailed', (request) => {
    problems.push(`[requestfailed] ${label}: ${request.url().slice(0, 160)}`)
  })

  await visit(page, `${label}-01-landing`, '/')
  await visit(page, `${label}-02-login`, '/entrar')
  await visit(page, `${label}-03-invite-invalida`, '/join/tokenquenoexisteentodoelmundo')

  // A partir de acá, con sesión.
  await page.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key, JSON.stringify(session))
    },
    ['cantado.auth', auth.session],
  )

  await visit(page, `${label}-04-feed`, `/g/${GROUP}`)
  await visit(page, `${label}-05-ranking`, `/g/${GROUP}/ranking`)
  await visit(page, `${label}-06-historial`, `/g/${GROUP}/historial`)
  await visit(page, `${label}-07-miembros`, `/g/${GROUP}/miembros`)
  await visit(page, `${label}-08-ajustes`, `/g/${GROUP}/ajustes`)

  // Detalle de la evolutiva (tiene el gráfico) y de la resuelta (tiene puntos).
  await visit(
    page,
    `${label}-09-detalle-evolutiva`,
    `/g/${GROUP}/p/bbbbbbbb-0000-4000-8000-000000000006`,
    { wait: 1400 },
  )
  await visit(
    page,
    `${label}-10-detalle-resuelta`,
    `/g/${GROUP}/p/bbbbbbbb-0000-4000-8000-000000000004`,
    { wait: 1400 },
  )
  await visit(
    page,
    `${label}-11-detalle-cerrada`,
    `/g/${GROUP}/p/bbbbbbbb-0000-4000-8000-000000000003`,
  )

  if (label === 'desktop') {
    // Tema oscuro.
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
      localStorage.setItem('cantado.theme', 'dark')
    })
    await visit(page, 'desktop-12-feed-oscuro', `/g/${GROUP}`)

    // Sheet de crear predicción abierto.
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light'
      localStorage.setItem('cantado.theme', 'light')
    })
    await page.goto(`${APP}/g/${GROUP}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /nueva predicción/i }).first().click()
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/desktop-13-crear.png` })
    console.log('  ✓ desktop-13-crear')
  }

  if (label === 'mobile') {
    await page.goto(`${APP}/g/${GROUP}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /nueva predicción/i }).first().click()
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/mobile-13-crear.png` })
    console.log('  ✓ mobile-13-crear')
  }

  await context.close()
}

await browser.close()

console.log('\n' + '─'.repeat(60))
if (problems.length === 0) {
  console.log('Sin errores de consola, pedidos fallidos ni overflow horizontal.')
} else {
  console.log(`${problems.length} problema(s):\n`)
  for (const problem of [...new Set(problems)]) console.log('  ' + problem)
  process.exitCode = 1
}

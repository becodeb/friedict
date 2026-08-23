/**
 * Prueba de humo de la PWA sobre el build real.
 *
 * En desarrollo el service worker está desactivado a propósito
 * (`devOptions.enabled: false`), así que esto es lo único que comprueba de
 * verdad que la app es instalable. Levantar `npm run preview` antes.
 */
import { chromium } from '@playwright/test'

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4183'
const problemas = []

const browser = await chromium.launch()
const page = await browser.newPage()

// 1. Los archivos que exige una PWA instalable existen y se sirven bien.
for (const ruta of [
  '/manifest.webmanifest',
  '/sw.js',
  '/registerSW.js',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/favicon.svg',
]) {
  const response = await page.request.get(`${BASE}${ruta}`)
  if (!response.ok()) problemas.push(`${ruta} → HTTP ${response.status()}`)
  else console.log(`  ✓ ${ruta} (${response.status()})`)
}

// 2. El manifiesto tiene lo mínimo para que el navegador ofrezca instalarla.
const manifest = await (await page.request.get(`${BASE}/manifest.webmanifest`)).json()
for (const campo of ['name', 'short_name', 'start_url', 'display', 'icons']) {
  if (!manifest[campo]) problemas.push(`manifest sin "${campo}"`)
}
if (manifest.display !== 'standalone') {
  problemas.push(`display es "${manifest.display}", se esperaba "standalone"`)
}
if (!manifest.icons?.some((i) => i.sizes === '512x512')) {
  problemas.push('manifest sin ícono de 512x512')
}
if (!manifest.icons?.some((i) => i.purpose === 'maskable')) {
  problemas.push('manifest sin ícono maskable')
}
console.log(`  ✓ manifest: ${manifest.name}`)

// 3. El service worker se registra de verdad al cargar la app.
await page.goto(BASE, { waitUntil: 'load' })
const registrado = await page.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'sin soporte'
  const registro = await navigator.serviceWorker.getRegistration()
  if (registro) return registro.scope
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const reintento = await navigator.serviceWorker.getRegistration()
  return reintento ? reintento.scope : null
})

if (!registrado) problemas.push('el service worker no llegó a registrarse')
else console.log(`  ✓ service worker registrado en ${registrado}`)

// 4. Y la app funciona: la portada renderiza.
const titulo = await page.textContent('h1')
if (!titulo?.includes('¿Qué va a pasar?')) {
  problemas.push(`la portada no renderizó (h1 = ${JSON.stringify(titulo)})`)
} else {
  console.log('  ✓ la portada renderiza sobre el build')
}

await browser.close()

console.log('\n' + '─'.repeat(50))
if (problemas.length === 0) {
  console.log('PWA instalable: manifiesto, íconos y service worker en orden.')
} else {
  for (const problema of problemas) console.log('  ✗ ' + problema)
  process.exitCode = 1
}

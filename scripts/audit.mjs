/** Auditoría puntual: objetivos táctiles chicos y desbordes horizontales. */
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const APP = 'http://localhost:5183'
const GROUP = 'aaaaaaaa-0000-4000-8000-000000000001'
const supabase = createClient(
  'http://127.0.0.1:54421',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
)
const { data } = await supabase.auth.signInWithPassword({
  email: 'bauti@cantado.test',
  password: 'cantado123',
})

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: Number(process.argv[2] ?? 412), height: 915 } })
const page = await context.newPage()
await page.addInitScript(
  ([key, session]) => window.localStorage.setItem(key, JSON.stringify(session)),
  ['cantado.auth', data.session],
)

for (const path of [
  `/g/${GROUP}`,
  `/g/${GROUP}/p/bbbbbbbb-0000-4000-8000-000000000006`,
  `/g/${GROUP}/ranking`,
  `/g/${GROUP}/miembros`,
  `/g/${GROUP}/ajustes`,
]) {
  await page.goto(`${APP}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  const report = await page.evaluate(() => {
    const small = []
    for (const node of document.querySelectorAll(
      'button:not([tabindex="-1"]), a[href], [role="radio"], [role="tab"]',
    )) {
      const rect = node.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.height < 44) {
        small.push(
          `${node.tagName.toLowerCase()}.${(node.className || '').toString().split(' ')[0]} "${(node.textContent || '').trim().slice(0, 28)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        )
      }
    }

    const wide = []
    const docWidth = document.documentElement.clientWidth
    for (const node of document.querySelectorAll('*')) {
      const rect = node.getBoundingClientRect()
      if (rect.right > docWidth + 1 || rect.left < -1) {
        wide.push(
          `${node.tagName.toLowerCase()}.${(node.className || '').toString().split(' ').slice(0, 2).join('.')} left=${Math.round(rect.left)} right=${Math.round(rect.right)}`,
        )
      }
    }

    return {
      small: [...new Set(small)],
      wide: [...new Set(wide)].slice(0, 6),
      overflow: document.documentElement.scrollWidth - docWidth,
    }
  })

  console.log(`\n${path}  (overflow: ${report.overflow}px)`)
  if (report.small.length) {
    console.log('  táctiles < 44px:')
    for (const item of report.small) console.log('    ' + item)
  }
  if (report.wide.length) {
    console.log('  se salen del viewport:')
    for (const item of report.wide) console.log('    ' + item)
  }
}

await browser.close()

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Deja la base en un estado conocido antes de correr la suite.
 *
 * Varios tests votan, resuelven y adelantan fechas; sin este reset, correr la
 * suite dos veces seguidas daría resultados distintos y el diagnóstico de un
 * fallo real se volvería adivinanza.
 *
 * Se puede saltear con `E2E_SKIP_RESET=1` cuando se está iterando sobre un
 * único test y la base ya está limpia.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_SKIP_RESET === '1') {
    console.log('[e2e] reset de base salteado (E2E_SKIP_RESET=1)')
    return
  }

  console.log('[e2e] reiniciando la base local…')
  await run('npx', ['--yes', 'supabase@latest', 'db', 'reset'], {
    shell: true,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  })
  console.log('[e2e] base lista')
}

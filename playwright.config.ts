import { defineConfig, devices } from '@playwright/test'

/**
 * E2E.
 *
 * Requiere el stack local levantado y con datos:
 *   npx supabase start && npx supabase db reset
 *
 * El dev server lo levanta Playwright si no está corriendo ya.
 *
 * Los proyectos cubren los tres viewports que exige el producto. Los flujos
 * completos corren en mobile —es una app mobile-first— y en desktop se corre lo
 * que cambia de layout, para no triplicar el tiempo sin ganar cobertura real.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // Serie, y un solo worker: todos los tests comparten una única base de datos
  // y varios cambian su estado (votan, resuelven, adelantan fechas).
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:5183',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // Los flujos que cambian el estado de la base corren UNA vez, en mobile, que
  // es el viewport principal del producto. Los demás proyectos corren lo que
  // depende del layout y de las preferencias del sistema. Correr los flujos
  // completos en los tres proyectos contra la misma base haría que el segundo
  // encontrara predicciones ya resueltas y fallara por arrastre, no por un
  // defecto real.
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testIgnore: /desktop\.spec\.ts/,
    },
    {
      // Viewport de tablet sobre Chromium en lugar del perfil de iPad, que
      // exige descargar WebKit. Lo que se está probando acá es el layout a
      // 820px con puntero táctil, no el motor de render de Safari.
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 820, height: 1180 },
        isMobile: false,
        hasTouch: true,
      },
      testMatch: /a11y\.spec\.ts/,
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
      testMatch: /(a11y|desktop)\.spec\.ts/,
    },
    {
      // Mismo recorrido con el sistema pidiendo menos movimiento.
      name: 'reduced-motion',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        contextOptions: { reducedMotion: 'reduce' },
      },
      testMatch: /a11y\.spec\.ts/,
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5183',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})

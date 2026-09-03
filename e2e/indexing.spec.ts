import { test, expect } from '@playwright/test'
import { APP_URL } from './support'

/**
 * Indexación selectiva por ruta — comportamiento real de HTTP.
 *
 * Playwright no está instalado en este entorno (falta el browser binary), así
 * que este spec queda ESCRITO pero NUNCA CORRIDO acá. La lógica pura que
 * decide qué lleva `X-Robots-Tag` está cubierta de verdad por
 * `integration/robots.test.ts`, que ejercita el mismo módulo
 * (`server/src/robots.ts`) sin necesitar un navegador.
 */
test.describe('X-Robots-Tag por ruta', () => {
  test('la portada y /entrar no llevan X-Robots-Tag', async ({ request }) => {
    const home = await request.get(APP_URL)
    expect(home.headers()['x-robots-tag']).toBeUndefined()

    const login = await request.get(`${APP_URL}/entrar`)
    expect(login.headers()['x-robots-tag']).toBeUndefined()
  })

  test('un grupo, un link de invitación y crear-grupo llevan noindex, nofollow', async ({
    request,
  }) => {
    for (const path of ['/g/x', '/join/tok', '/crear-grupo']) {
      const response = await request.get(`${APP_URL}${path}`)
      expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow')
    }
  })

  test('un asset estático lleva noindex, nofollow', async ({ request }) => {
    const response = await request.get(`${APP_URL}/assets/does-not-exist.js`)
    // El middleware estático manda el header aunque el archivo puntual no
    // exista: la política es de la RUTA, no del archivo.
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow')
  })

  test('una ruta desconocida es noindex por default-deny', async ({ request }) => {
    const response = await request.get(`${APP_URL}/esto-no-existe-en-ningun-lado`)
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow')
  })

  test('public/robots.txt disallowea los prefijos privados', async ({ request }) => {
    const response = await request.get(`${APP_URL}/robots.txt`)
    const body = await response.text()
    expect(body).toContain('Disallow: /g/')
    expect(body).toContain('Disallow: /join/')
    expect(body).toContain('Disallow: /crear-grupo')
    expect(body).toContain('Allow: /')
  })
})

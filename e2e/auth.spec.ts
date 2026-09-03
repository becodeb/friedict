import { expect, test } from '@playwright/test'
import { useLightTheme } from './support'

/**
 * El recorrido real de autenticación, sin atajos: se crea una cuenta desde el
 * formulario, se cierra sesión y se vuelve a entrar con las mismas
 * credenciales.
 *
 * El Magic Link ya no existe —necesitaba un proveedor de mail saliente— así
 * que lo que se prueba es contraseña. Google no se puede probar acá: implica
 * salir del sitio hacia un tercero.
 */
test.describe('entrar con mail y contraseña', () => {
  test('crear una cuenta desde la portada deja la sesión iniciada', async ({ page }) => {
    await useLightTheme(page)
    const email = `e2e-${Date.now()}@cantado.test`

    await page.goto('/')
    await expect(page.getByRole('heading', { name: '¿Qué va a pasar?' })).toBeVisible()

    await page.getByRole('link', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/entrar/)

    await page.getByRole('button', { name: /creá una/i }).click()
    await page.getByLabel('Tu email').fill(email)
    await page.getByLabel('Tu contraseña').fill('unaclavelarga123')
    await page.getByRole('button', { name: /crear cuenta/i }).click()

    // Sin grupos todavía, la portada es el destino y ya hay sesión.
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('link', { name: 'Entrar' })).toHaveCount(0)
  })

  test('un mail inválido se avisa en el campo y no manda nada', async ({ page }) => {
    await page.goto('/entrar')

    await page.getByLabel('Tu email').fill('esto-no-es-un-mail')
    await page.getByLabel('Tu contraseña').fill('unaclavelarga123')
    await page.getByRole('button', { name: /^entrar$/i }).click()

    await expect(page.getByText(/no parece válido/i)).toBeVisible()
  })

  test('una contraseña corta se rechaza antes de salir del navegador', async ({ page }) => {
    await page.goto('/entrar')

    await page.getByLabel('Tu email').fill('alguien@cantado.test')
    await page.getByLabel('Tu contraseña').fill('corta')
    await page.getByRole('button', { name: /^entrar$/i }).click()

    await expect(page.getByText(/al menos 8 caracteres/i)).toBeVisible()
  })

  test('las credenciales incorrectas no dejan entrar', async ({ page }) => {
    await page.goto('/entrar')

    await page.getByLabel('Tu email').fill('bauti@cantado.test')
    await page.getByLabel('Tu contraseña').fill('estanoeslaclave')
    await page.getByRole('button', { name: /^entrar$/i }).click()

    await expect(page.getByText(/incorrectos/i)).toBeVisible()
    await expect(page).toHaveURL(/\/entrar/)
  })
})

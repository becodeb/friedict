import { expect, test } from '@playwright/test'
import { clearMailbox, magicLinkFor, useLightTheme } from './support'

/**
 * El recorrido real de autenticación, sin atajos: se escribe el mail en el
 * formulario, se lee el mensaje que llegó al servidor de correo local y se abre
 * el link como lo haría una persona.
 */
test.describe('entrar con Magic Link', () => {
  test.beforeEach(async () => {
    await clearMailbox()
  })

  test('desde la portada hasta tener sesión, pasando por el mail', async ({ page }) => {
    await useLightTheme(page)
    const email = `e2e-${Date.now()}@cantado.test`

    await page.goto('/')
    await expect(page.getByRole('heading', { name: '¿Qué va a pasar?' })).toBeVisible()

    await page.getByRole('link', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/entrar/)

    await page.getByLabel('Tu email').fill(email)
    await page.getByRole('button', { name: /mandame el link/i }).click()

    // La app confirma sin revelar nada de más.
    await expect(page.getByRole('heading', { name: /te mandamos un link/i })).toBeVisible()
    await expect(page.getByText(email)).toBeVisible()

    const link = await magicLinkFor(email)
    await page.goto(link)

    // Sin grupos todavía, la portada es el destino y ya hay sesión.
    await expect(page).toHaveURL(/\/(entrar)?$|\/$/)
    await expect(page.getByRole('link', { name: 'Entrar' })).toHaveCount(0)
  })

  test('un mail inválido no manda nada y se avisa en el campo', async ({ page }) => {
    await page.goto('/entrar')

    await page.getByLabel('Tu email').fill('esto-no-es-un-mail')
    await page.getByRole('button', { name: /mandame el link/i }).click()

    await expect(page.getByText(/no parece válido/i)).toBeVisible()
    await expect(page.getByRole('heading', { name: /te mandamos un link/i })).toHaveCount(0)
  })

  test('un link de acceso ya usado no deja entrar dos veces', async ({ page, context }) => {
    const email = `e2e-once-${Date.now()}@cantado.test`

    await page.goto('/entrar')
    await page.getByLabel('Tu email').fill(email)
    await page.getByRole('button', { name: /mandame el link/i }).click()
    await expect(page.getByRole('heading', { name: /te mandamos un link/i })).toBeVisible()

    const link = await magicLinkFor(email)
    await page.goto(link)
    await expect(page.getByRole('link', { name: 'Entrar' })).toHaveCount(0)

    // Otro navegador, mismo link: ya se consumió.
    const fresh = await context.browser()!.newContext()
    const freshPage = await fresh.newPage()
    await freshPage.goto(link)

    await expect(
      freshPage.getByRole('heading', { name: /este link ya no sirve/i }),
    ).toBeVisible()
    await fresh.close()
  })
})

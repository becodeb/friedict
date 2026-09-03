import { expect, test } from '@playwright/test'
import {
  SEED,
  createPredictionAs,
  signInAs,
  useLightTheme,
  voteAs,
} from './support'

/**
 * Flujo de quien recibe el link por un chat: abrir la invitación, entrar,
 * elegir nombre, votar y ver el ranking.
 */
test.describe('flujo del invitado', () => {
  test('entra por el link, se suma al grupo y vota', async ({ page }) => {
    await useLightTheme(page)
    const email = `invitado-${Date.now()}@cantado.test`

    // Llega el link por WhatsApp y lo abre sin tener cuenta.
    await page.goto(`/join/${SEED.inviteToken}`)
    await expect(page.getByText('Te invitaron a')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Los pibes' })).toBeVisible()

    await page.getByRole('button', { name: /entrar para sumarme/i }).click()
    await expect(page).toHaveURL(/\/entrar/)

    await page.getByRole('button', { name: /creá una/i }).click()
    await page.getByLabel('Tu email').fill(email)
    await page.getByLabel('Tu contraseña').fill('unaclavelarga123')
    await page.getByRole('button', { name: /crear cuenta/i }).click()

    // Vuelve a la invitación, ya con sesión: sólo falta el nombre.
    await expect(page).toHaveURL(new RegExp(`/join/${SEED.inviteToken}`))
    await page.getByLabel('Cómo te llamás').fill('Vicky')
    await page.getByRole('button', { name: /sumarme al grupo/i }).click()

    await expect(page).toHaveURL(new RegExp(`/g/${SEED.losPibes}`))
    await expect(page.getByRole('button', { name: /los pibes/i })).toBeVisible()

    // Vota en la que está en prueba y su voto queda guardado.
    const card = page
      .locator('article')
      .filter({ hasText: '¿Bauti llega después de las 22:30?' })
    await card.getByRole('radio', { name: 'No' }).click()

    await expect(card.getByRole('radio', { name: 'No' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(card.getByText(/tu voto quedó guardado|podés cambiarlo/i)).toBeVisible()

    // Y aparece en la lista de integrantes.
    await page.goto(`/g/${SEED.losPibes}/miembros`)
    await expect(page.locator('main')).toContainText('Vicky')
  })

  test('puede cambiar su voto hasta el cierre', async ({ page }) => {
    await useLightTheme(page)
    await signInAs(page, 'fran@cantado.test')
    await page.goto(`/g/${SEED.losPibes}`)

    const card = page
      .locator('article')
      .filter({ hasText: '¿Dónde terminamos cenando el sábado?' })

    await card.getByRole('radio', { name: 'Sushi' }).click()
    await expect(card.getByRole('radio', { name: 'Sushi' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await card.getByRole('radio', { name: 'Hamburguesas' }).click()
    await expect(card.getByRole('radio', { name: 'Hamburguesas' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(card.getByRole('radio', { name: 'Sushi' })).toHaveAttribute(
      'aria-checked',
      'false',
    )

    // Cambiar de opinión no suma un participante nuevo.
    await page.reload()
    await expect(
      page
        .locator('article')
        .filter({ hasText: '¿Dónde terminamos cenando el sábado?' })
        .getByRole('radio', { name: 'Hamburguesas' }),
    ).toHaveAttribute('aria-checked', 'true')
  })

  test('no ve qué votó el resto mientras la predicción está abierta', async ({ page }) => {
    await useLightTheme(page)

    // Predicción propia del test: si usara una del seed, cualquier otro test
    // que vote en ella cambiaría el conteo y este fallaría por rebote.
    const predictionId = await createPredictionAs(
      'bauti@cantado.test',
      SEED.losPibes,
      '¿Se corta la luz otra vez?',
      ['Sí', 'No', 'Justo cuando estemos comiendo'],
    )
    await voteAs('bauti@cantado.test', predictionId, 'Sí')
    await voteAs('juan@cantado.test', predictionId, 'No')

    await signInAs(page, 'fran@cantado.test')
    await page.goto(`/g/${SEED.losPibes}/p/${predictionId}`)

    // Se sabe cuánta gente participó…
    await expect(page.getByText('2 de 3 personas')).toBeAttached()
    // …pero no hay ni porcentajes ni nombres de quién eligió qué.
    await expect(page.getByText(/%/)).toHaveCount(0)
    await expect(page.getByText('Bauti', { exact: true })).toHaveCount(0)

    // Con la tercera persona pasa a abierta, y sigue sin revelarse nada.
    await voteAs('agus@cantado.test', predictionId, 'Sí')
    await page.reload()

    await expect(page.getByText('Abierta')).toBeVisible()
    await expect(page.getByText(/%/)).toHaveCount(0)
    await expect(
      page.getByText(/no se ve qué eligió cada una hasta el cierre/i),
    ).toBeVisible()
  })

  test('ve el ranking del grupo con puntos y aciertos', async ({ page }) => {
    await useLightTheme(page)
    await signInAs(page, 'bauti@cantado.test')
    await page.goto(`/g/${SEED.losPibes}/ranking`)

    await expect(page.getByRole('heading', { name: 'Ranking' })).toBeVisible()

    // Bauti se ve a sí mismo marcado como «vos».
    await expect(page.getByText('vos', { exact: true })).toBeVisible()
    // Y su fila muestra aciertos y puntos. No se afirma un número exacto: otros
    // tests resuelven predicciones y mueven el marcador.
    await expect(page.locator('main')).toContainText('acertadas')
    await expect(page.getByText('puntos').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: /cómo se calculan/i })).toBeVisible()
  })

  test('la predicción evolutiva muestra cómo fue cambiando la opinión', async ({
    page,
  }) => {
    await useLightTheme(page)
    await signInAs(page, 'bauti@cantado.test')
    await page.goto(`/g/${SEED.losPibes}/p/${SEED.evolutiva}`)

    await expect(page.getByRole('heading', { name: /quién se muda primero/i })).toBeVisible()
    await expect(page.getByText('evolutiva')).toBeVisible()
    await expect(page.getByRole('heading', { name: /cómo fue cambiando/i })).toBeVisible()
    // La leyenda nombra a cada serie: el gráfico no depende sólo del color.
    await expect(page.getByText('Lu', { exact: true }).first()).toBeVisible()
  })
})

test.describe('links de invitación que no sirven', () => {
  test('un link vencido no revela nada del grupo', async ({ page }) => {
    await useLightTheme(page)
    await page.goto(`/join/${SEED.expiredToken}`)

    await expect(page.getByRole('heading', { name: /este link no sirve/i })).toBeVisible()
    await expect(page.getByText('Los pibes')).toHaveCount(0)
  })

  test('un link inventado da exactamente la misma pantalla', async ({ page }) => {
    await useLightTheme(page)
    await page.goto('/join/estetokennoexisteenningunladoxxx')

    await expect(page.getByRole('heading', { name: /este link no sirve/i })).toBeVisible()
    await expect(page.getByText('Los pibes')).toHaveCount(0)
  })

  test('una ruta que no existe muestra un 404 con salida', async ({ page }) => {
    await useLightTheme(page)
    await page.goto('/una-ruta-que-no-existe')

    await expect(page.getByRole('heading', { name: /esta página no existe/i })).toBeVisible()
    await page.getByRole('button', { name: /ir al inicio/i }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('un grupo del que no sos parte no confirma ni que exista', async ({ page }) => {
    await useLightTheme(page)
    // Caro sólo pertenece a Fútbol 5.
    await signInAs(page, 'caro@cantado.test')
    await page.goto(`/g/${SEED.losPibes}`)

    await expect(page.getByRole('heading', { name: /no encontramos este grupo/i })).toBeVisible()
    await expect(page.getByText('Los pibes')).toHaveCount(0)
  })
})

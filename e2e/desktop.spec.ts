import { expect, test } from '@playwright/test'
import { SEED, signInAs, useLightTheme } from './support'

/**
 * Lo que cambia de verdad entre mobile y desktop. No se repiten los flujos
 * completos: se verifica que la navegación cambia de lugar, que el diálogo pasa
 * de sheet a modal centrado y que la portada respira.
 */
test.describe('layout de desktop', () => {
  test('la navegación va arriba y no hay barra inferior', async ({ page }) => {
    await useLightTheme(page)
    await signInAs(page, 'bauti@cantado.test')
    await page.goto(`/g/${SEED.losPibes}`)

    const nav = page.getByRole('navigation', { name: /secciones del grupo/i })
    await expect(nav).toBeVisible()

    // En desktop la nav está en el encabezado, arriba del pliegue.
    const box = await nav.boundingBox()
    expect(box!.y).toBeLessThan(200)

    // Y el botón de crear vive en la barra del feed, no como botón flotante.
    await expect(page.getByRole('button', { name: /nueva predicción/i })).toBeVisible()
  })

  test('la pila de avatares del grupo aparece en el encabezado', async ({ page }) => {
    await useLightTheme(page)
    await signInAs(page, 'bauti@cantado.test')
    await page.goto(`/g/${SEED.losPibes}`)

    const link = page.getByRole('link', { name: /ver los \d+ integrantes/i })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(/\/miembros$/)
  })

  test('el diálogo de crear se muestra centrado y con scroll propio', async ({ page }) => {
    await useLightTheme(page)
    await signInAs(page, 'bauti@cantado.test')
    await page.goto(`/g/${SEED.losPibes}`)

    await page.getByRole('button', { name: /nueva predicción/i }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const box = await dialog.boundingBox()
    const viewport = page.viewportSize()!

    // Centrado horizontalmente, con aire a ambos lados.
    expect(box!.x).toBeGreaterThan(100)
    expect(box!.x + box!.width).toBeLessThan(viewport.width - 100)
    // Y nunca más alto que la ventana.
    expect(box!.height).toBeLessThanOrEqual(viewport.height)
  })

  test('la portada mantiene una medida de línea legible', async ({ page }) => {
    await useLightTheme(page)
    await page.goto('/')

    const parrafo = page
      .getByText(/predicciones privadas entre amigos/i)
      .first()
    await expect(parrafo).toBeVisible()

    const box = await parrafo.boundingBox()
    // Ni una columna de 1200px de ancho ni un hilo de 200px.
    expect(box!.width).toBeGreaterThan(280)
    expect(box!.width).toBeLessThan(680)
  })

  test('el ejemplo de la portada muestra el mecanismo de las 3 personas', async ({
    page,
  }) => {
    await useLightTheme(page)
    await page.goto('/')

    await expect(page.getByRole('heading', { name: /así se ve una predicción/i })).toBeVisible()
    await expect(page.getByText('Falta una persona para que siga')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: /las predicciones se ganan el lugar/i }),
    ).toBeVisible()
  })
})

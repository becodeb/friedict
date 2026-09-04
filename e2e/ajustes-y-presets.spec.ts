import { expect, test } from '@playwright/test'
import { SEED, signInAs, sql, useLightTheme } from './support'

/**
 * Escrito para `simpler-prediction-setup`, NO corrido: Playwright no tiene
 * navegadores instalados en este entorno. Cubre el flujo de presets del
 * formulario de creación y el de un admin prendiendo la calificación desde
 * los ajustes del grupo.
 */
test.describe('presets al crear una predicción', () => {
  test('el preset "A libro abierto" deja la predicción visible desde el primer voto', async ({
    page,
  }) => {
    await useLightTheme(page)
    await signInAs(page, 'juan@cantado.test')
    await page.goto(`/g/${SEED.futbol5}`)

    await page.getByRole('button', { name: /nueva predicción/i }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: /nueva predicción/i })).toBeVisible()

    await sheet.getByLabel('¿Qué va a pasar?').fill('¿Quién gana el próximo partido?')
    await sheet.getByPlaceholder('Sí').fill('Nosotros')
    await sheet.getByPlaceholder('No').fill('Ellos')

    // Por default arranca en "A ciegas". Elegir "A libro abierto" fija
    // votingMode=single, resultsVisibility=always, votesVisibility=visible y
    // voteChangeWindow=until_close, los cuatro de una.
    await sheet.getByRole('radio', { name: /a libro abierto/i }).click()
    await sheet.getByRole('button', { name: /crear predicción/i }).click()

    await expect(page.getByText('¿Quién gana el próximo partido?')).toBeVisible()

    // "A libro abierto" muestra los recuentos desde el primer voto, sin
    // esperar al cierre — el rasgo distintivo del preset frente a "A ciegas".
    await page.getByText('¿Quién gana el próximo partido?').click()
    await page.getByRole('radio', { name: 'Nosotros' }).click()
    await expect(page.getByText('%').first()).toBeVisible()
  })

  test('sobreescribir un campo del preset lo pasa a "A medida"', async ({ page }) => {
    await useLightTheme(page)
    await signInAs(page, 'juan@cantado.test')
    await page.goto(`/g/${SEED.futbol5}`)

    await page.getByRole('button', { name: /nueva predicción/i }).click()
    const sheet = page.getByRole('dialog')

    await sheet.getByRole('button', { name: 'Más opciones' }).click()
    await sheet
      .getByRole('group', { name: /ver los números/i })
      .getByRole('radio', { name: /^siempre$/i })
      .click()

    await expect(sheet.getByRole('radio', { name: /a medida/i })).toBeChecked()
  })
})

test.describe('un admin prende la calificación desde los ajustes del grupo', () => {
  test('con la calificación prendida, una predicción nueva nace "en prueba"', async ({ page }) => {
    await useLightTheme(page)
    // Juan es owner de «Fútbol 5», que arranca con la calificación apagada
    // (default de la columna) según el seed.
    await signInAs(page, 'juan@cantado.test')
    await page.goto(`/g/${SEED.futbol5}/ajustes`)

    await expect(page.getByRole('heading', { name: /cómo funciona este grupo/i })).toBeVisible()
    await page.getByRole('switch', { name: /calificación/i }).click()
    await page.getByRole('button', { name: /guardar ajustes del grupo/i }).click()

    const rows = (await sql(
      'select qualification_enabled from public.groups where id = $1',
      [SEED.futbol5],
    )) as Array<{ qualification_enabled: boolean }>
    expect(rows[0]!.qualification_enabled).toBe(true)

    // Con el toggle recién prendido, una predicción nueva nace "en prueba".
    await page.goto(`/g/${SEED.futbol5}`)
    await page.getByRole('button', { name: /nueva predicción/i }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('¿Qué va a pasar?').fill('¿Se suspende por lluvia?')
    await sheet.getByPlaceholder('Sí').fill('Sí')
    await sheet.getByPlaceholder('No').fill('No')
    await sheet.getByRole('button', { name: /crear predicción/i }).click()

    await expect(page.getByText('¿Se suspende por lluvia?')).toBeVisible()
    await expect(page.getByText('En prueba').first()).toBeVisible()
  })
})

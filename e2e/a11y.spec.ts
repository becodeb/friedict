import { expect, test } from '@playwright/test'
import { SEED, signInAs, useLightTheme } from './support'

/**
 * Accesibilidad y respeto por las preferencias del sistema.
 *
 * El proyecto `reduced-motion` de playwright.config.ts corre este archivo con
 * `prefers-reduced-motion: reduce`, así que las mismas aserciones se verifican
 * con y sin movimiento.
 */
test.describe('accesibilidad', () => {
  test('se puede votar entero con el teclado', async ({ page }) => {
    await useLightTheme(page)
    await signInAs(page, 'fran@cantado.test')
    await page.goto(`/g/${SEED.losPibes}/p/${SEED.enPrueba}`)

    const option = page.getByRole('radio', { name: 'No' })
    await option.focus()
    await expect(option).toBeFocused()

    // El foco tiene que verse, no sólo existir.
    const outline = await option.evaluate((el) => {
      el.classList.add('focus-visible')
      return getComputedStyle(el).outlineStyle
    })
    expect(outline).not.toBe('none')

    await page.keyboard.press('Enter')
    await expect(option).toHaveAttribute('aria-checked', 'true')
  })

  test('el link de saltar al contenido aparece al tabular', async ({ page }) => {
    await useLightTheme(page)
    await page.goto('/')

    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: /saltar al contenido/i })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()
  })

  test('las pestañas del feed se recorren con las flechas', async ({ page }) => {
    await useLightTheme(page)
    await signInAs(page, 'bauti@cantado.test')
    await page.goto(`/g/${SEED.losPibes}`)

    const abiertas = page.getByRole('tab', { name: /abiertas/i })
    await abiertas.focus()
    await expect(abiertas).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('tab', { name: /en prueba/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    await page.keyboard.press('End')
    await expect(page.getByRole('tab', { name: /cerradas/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('el diálogo atrapa el foco y cierra con Escape', async ({ page }) => {
    await useLightTheme(page)
    await signInAs(page, 'bauti@cantado.test')
    await page.goto(`/g/${SEED.losPibes}`)

    await page.getByRole('button', { name: /nueva predicción/i }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    // El foco arranca adentro.
    await expect(dialog.getByLabel('¿Qué va a pasar?')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('cada pantalla tiene un h1 y un main', async ({ page }) => {
    await useLightTheme(page)
    await signInAs(page, 'bauti@cantado.test')

    for (const path of [
      '/',
      `/g/${SEED.losPibes}`,
      `/g/${SEED.losPibes}/ranking`,
      `/g/${SEED.losPibes}/historial`,
      `/g/${SEED.losPibes}/miembros`,
      `/g/${SEED.losPibes}/ajustes`,
    ]) {
      await page.goto(path)
      await expect(page.locator('main')).toHaveCount(1)
      await expect(page.locator('h1')).toHaveCount(1)
    }
  })

  test('los controles interactivos llegan al objetivo táctil de 44px', async ({ page }) => {
    await useLightTheme(page)
    await signInAs(page, 'bauti@cantado.test')
    await page.goto(`/g/${SEED.losPibes}`)
    await page.waitForTimeout(600)

    const chicos = await page.evaluate(() => {
      const problemas: string[] = []
      const nodos = document.querySelectorAll<HTMLElement>(
        'button:not([tabindex="-1"]), a[href], [role="radio"], [role="tab"]',
      )
      for (const nodo of nodos) {
        const rect = nodo.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue
        // 43.5 y no 44: los altos calculados dan valores subpíxel (43.99) que
        // no son un problema real de accesibilidad.
        if (rect.height < 43.5) {
          problemas.push(
            `${nodo.tagName.toLowerCase()} "${(nodo.textContent ?? '').trim().slice(0, 30)}" → ${Math.round(rect.height)}px`,
          )
        }
      }
      return problemas
    })

    expect(chicos).toEqual([])
  })

  test('no hay desplazamiento horizontal en ninguna pantalla', async ({ page }) => {
    await useLightTheme(page)
    await signInAs(page, 'bauti@cantado.test')

    for (const path of [
      '/',
      '/entrar',
      `/g/${SEED.losPibes}`,
      `/g/${SEED.losPibes}/p/${SEED.evolutiva}`,
      `/g/${SEED.losPibes}/ranking`,
      `/g/${SEED.losPibes}/historial`,
    ]) {
      await page.goto(path)
      await page.waitForTimeout(400)

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      )
      expect(overflow, `overflow horizontal en ${path}`).toBeLessThanOrEqual(1)
    }
  })

  test('el tema oscuro mantiene el contenido legible', async ({ page }) => {
    await signInAs(page, 'bauti@cantado.test')
    await page.addInitScript(() => {
      window.localStorage.setItem('friedict.theme', 'dark')
    })
    await page.goto(`/g/${SEED.losPibes}`)

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByRole('heading', { name: '¿Qué va a pasar?' })).toBeVisible()

    const bodyBackground = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    )
    expect(bodyBackground).not.toBe('rgba(0, 0, 0, 0)')
  })
})

test.describe('layout responsive', () => {
  test('el contenido entra sin recortes en tablet', async ({ page }) => {
    await useLightTheme(page)
    await signInAs(page, 'bauti@cantado.test')
    await page.goto(`/g/${SEED.losPibes}`)

    await expect(page.getByRole('heading', { name: '¿Qué va a pasar?' })).toBeVisible()
    await expect(page.getByRole('tab', { name: /abiertas/i })).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})

import { expect, test } from '@playwright/test'
import {
  SEED,
  confirmResolutionAs,
  signInAs,
  sql,
  statusOf,
  timeTravel,
  useLightTheme,
  voteAs,
} from './support'

/**
 * Flujo de quien arma el grupo: entrar, crear el grupo, sacar el link de
 * invitación, crear una predicción y resolverla.
 */
test.describe('flujo del creador', () => {
  test('crea un grupo, obtiene un link para compartir y crea una predicción', async ({
    page,
  }) => {
    await useLightTheme(page)
    const email = `duenio-${Date.now()}@cantado.test`

    // Entrar
    await page.goto('/entrar')
    await page.getByRole('button', { name: /creá una/i }).click()
    await page.getByLabel('Tu email').fill(email)
    await page.getByLabel('Tu contraseña').fill('unaclavelarga123')
    await page.getByRole('button', { name: /crear cuenta/i }).click()

    // Crear el grupo
    await page.getByRole('button', { name: /crear un grupo/i }).click()
    await expect(page).toHaveURL(/\/crear-grupo/)

    await page.getByLabel('Nombre del grupo').fill('Fútbol 5')
    await page.getByLabel('Cómo te llamás').fill('Nico')
    await page.getByRole('radio', { name: 'verde' }).check()
    await page.getByRole('button', { name: /^crear grupo$/i }).click()

    await expect(page).toHaveURL(/\/g\/[0-9a-f-]+/)
    await expect(page.getByRole('button', { name: /fútbol 5/i })).toBeVisible()

    // Estado vacío con una salida clara
    await expect(page.getByRole('heading', { name: /todavía no hay nada acá/i })).toBeVisible()

    // Link de invitación
    await page.getByRole('button', { name: /opciones del grupo/i }).click()
    await page.getByRole('menuitem', { name: /invitar gente/i }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /compartir con el grupo/i })).toBeVisible()
    await expect(dialog.getByText(/\/join\//)).toBeVisible({ timeout: 15_000 })

    // Abrir el diálogo genera UN link, no dos. El efecto que lo crea corre en un
    // componente que re-renderiza varias veces mientras llega la respuesta.
    const groupId = /\/g\/([0-9a-f-]+)/.exec(page.url())![1]!
    const invites = (await sql(
      'select count(*)::int as n from public.group_invites where group_id = $1 and revoked_at is null',
      [groupId],
    )) as Array<{ n: number }>
    expect(invites[0]!.n).toBe(1)

    await dialog.getByRole('button', { name: /^cerrar$/i }).first().click()

    // Crear una predicción
    await page.getByRole('button', { name: /crear la primera/i }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: /nueva predicción/i })).toBeVisible()

    await sheet.getByLabel('¿Qué va a pasar?').fill('¿Llueve el jueves y se suspende?')
    await sheet.getByPlaceholder('Sí').fill('Sí, se suspende')
    await sheet.getByPlaceholder('No').fill('No, se juega igual')
    await sheet.getByRole('button', { name: /crear predicción/i }).click()

    // Un grupo NUEVO arranca con la calificación apagada (default de
    // `groups.qualification_enabled`): la predicción queda activa apenas se
    // crea, sin "En prueba" ni umbral de participación que juntar.
    await expect(page.getByText('¿Llueve el jueves y se suspende?')).toBeVisible()
    await expect(page.getByText('En prueba')).toHaveCount(0)
    await expect(page.getByText('Abierta').first()).toBeVisible()
  })

  test('resuelve una predicción cerrada con confirmación de otra persona', async ({
    page,
  }) => {
    await useLightTheme(page)
    // Agus creó «¿Quién cancela el plan del viernes?», que ya está cerrada.
    await signInAs(page, 'agus@cantado.test')
    await page.goto(`/g/${SEED.losPibes}/p/${SEED.cerrada}`)

    await expect(page.getByRole('heading', { name: /quién cancela el plan/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /resolver resultado/i })).toBeVisible()

    // Al estar cerrada, ya se ven los porcentajes de todas las opciones.
    await expect(page.getByText('50%')).toBeVisible()

    // Hay dos grupos de radios en la pantalla (las opciones para votar y las
    // del panel de resolución); se apunta al de resolución por su nombre.
    await page
      .getByRole('radiogroup', { name: 'Qué pasó' })
      .getByRole('radio', { name: 'Fran' })
      .click()
    await page.getByRole('button', { name: /proponer este resultado/i }).click()

    await expect(page.getByRole('heading', { name: /resultado propuesto/i })).toBeVisible()
    await expect(page.getByText(/lo propusiste vos/i)).toBeVisible()

    expect(await statusOf(SEED.cerrada)).toBe('resolving')

    // Otra persona confirma y se reparten los puntos.
    const resolutions = (await sql(
      "select id from public.prediction_resolutions where prediction_id = $1 and status = 'proposed'",
      [SEED.cerrada],
    )) as Array<{ id: string }>
    const resolutionId = resolutions[0]!.id

    await confirmResolutionAs('bauti@cantado.test', resolutionId)
    await confirmResolutionAs('juan@cantado.test', resolutionId)

    expect(await statusOf(SEED.cerrada)).toBe('resolved')

    await page.reload()
    await expect(page.getByRole('heading', { name: /cómo quedaron los puntos/i })).toBeVisible()
    await expect(page.getByText('pasó')).toBeVisible()
  })

  test('una predicción con 2 de 3 participantes se queda "en prueba" para siempre: nada expira', async ({
    page,
  }) => {
    await useLightTheme(page)
    // «Los pibes» tiene la calificación prendida (seed) al 60% de 5
    // integrantes: hacen falta 3. Con sólo 2 votos, se queda esperando.
    // El cierre se pone bien lejos (1000 días) para que, después de adelantar
    // el reloj 400 días más abajo, closes_at siga sin llegar — lo que se
    // prueba es la ausencia de expiración por participación, no el cierre.
    const predictionId = await (
      await import('./support')
    ).createPredictionAs(
      'bauti@cantado.test',
      SEED.losPibes,
      '¿Alguien se acuerda de traer hielo?',
      ['Sí', 'No'],
      24 * 1000,
    )

    await voteAs('bauti@cantado.test', predictionId, 'Sí')
    await voteAs('juan@cantado.test', predictionId, 'No')

    await signInAs(page, 'bauti@cantado.test')
    await page.goto(`/g/${SEED.losPibes}`)

    const enElFeed = page.getByRole('link', { name: '¿Alguien se acuerda de traer hielo?' })
    await expect(enElFeed).toBeVisible()
    await expect(page.getByText(/falta una persona para que siga/i)).toBeVisible()

    // Pasa mucho tiempo — antes de este cambio, esto la expiraba. Ahora se
    // queda exactamente donde estaba, en el feed, en prueba.
    await timeTravel(predictionId, '400 days')
    expect(await statusOf(predictionId)).toBe('proposed')

    await page.reload()
    await expect(enElFeed).toBeVisible()
    await expect(page.getByText(/falta una persona para que siga/i)).toBeVisible()
  })

  test('con el tercer voto la predicción queda confirmada', async ({ page }) => {
    await useLightTheme(page)
    const predictionId = await (
      await import('./support')
    ).createPredictionAs(
      'bauti@cantado.test',
      SEED.losPibes,
      '¿Se arma asado el domingo?',
      ['Seguro', 'Ni en pedo'],
      72,
    )

    await voteAs('juan@cantado.test', predictionId, 'Seguro')
    await voteAs('agus@cantado.test', predictionId, 'Ni en pedo')

    await signInAs(page, 'bauti@cantado.test')
    await page.goto(`/g/${SEED.losPibes}/p/${predictionId}`)

    await expect(page.getByText('En prueba')).toBeVisible()
    await expect(page.getByText(/falta una persona para que siga/i)).toBeVisible()

    // Bauti es la tercera persona.
    await page.getByRole('radio', { name: 'Seguro' }).click()

    await expect(page.getByText('Abierta')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/falta una persona/i)).toHaveCount(0)
    expect(await statusOf(predictionId)).toBe('active')
  })
})

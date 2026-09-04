import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CreatePredictionSheet } from './CreatePredictionSheet'
import { ToastContext } from '@/components/ui/toast-context'

function renderSheet() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastContext.Provider value={{ show: () => {}, dismiss: () => {} }}>
        <CreatePredictionSheet groupId="g1" open onClose={() => {}} />
      </ToastContext.Provider>
    </QueryClientProvider>,
  )
}

/** Un HelpTip visible cerca de un legend/label es un botón "Qué significa …". */
function helpTipFor(text: string | RegExp) {
  return screen.getByRole('button', { name: text })
}

async function openAdvanced() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Más opciones' }))
  return user
}

/**
 * Algunas descripciones de `Segmented` comparten palabras con la etiqueta de
 * OTRA opción del mismo grupo (p. ej. "Un voto" y "Un voto por ronda"), así
 * que el nombre accesible por regex a veces es ambiguo. Acá se apunta
 * directo al `<input value="...">`, sin pasar por el texto visible.
 */
function radioByValue(scope: HTMLElement, value: string): HTMLInputElement {
  const input = scope.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)
  if (!input) throw new Error(`No se encontró el radio con value="${value}"`)
  return input
}

describe('CreatePredictionSheet — ayuda en cada campo no evidente', () => {
  it('¿Cuándo cierra? tiene su HelpTip, siempre visible', () => {
    renderSheet()
    expect(helpTipFor(/qué significa cuándo cierra/i)).toBeInTheDocument()
  })

  it('en modo evolutiva, el intervalo tiene su HelpTip', async () => {
    renderSheet()
    const user = await openAdvanced()
    const modo = within(screen.getByRole('group', { name: /^modo/i }))
    await user.click(modo.getByRole('radio', { name: /evolutiva/i }))
    expect(
      helpTipFor(/qué significa cada cuántos días se vuelve a votar/i),
    ).toBeInTheDocument()
  })

  it('los tres HelpTip de calificación/quórum por predicción ya NO existen: "Más opciones" expone resultados, votos y ventana de voto', async () => {
    renderSheet()
    const user = await openAdvanced()
    await user.click(screen.getByRole('radio', { name: /cuando lo pida el grupo/i }))

    expect(
      screen.queryByRole('button', { name: /qué significa cuánta gente tiene que votar/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /qué significa cuánto tiempo tiene para juntar gente/i,
      }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: /qué significa cuánta gente tiene que pedir el cierre/i,
      }),
    ).not.toBeInTheDocument()

    expect(helpTipFor(/qué significa ver los números/i)).toBeInTheDocument()
    expect(helpTipFor(/qué significa ver quién eligió qué/i)).toBeInTheDocument()
    expect(
      helpTipFor(/qué significa hasta cuándo se puede corregir el voto/i),
    ).toBeInTheDocument()
  })

  it('el HelpTip de cada campo abre un panel con contenido no vacío', async () => {
    renderSheet()
    const trigger = helpTipFor(/qué significa cuándo cierra/i)
    const user = userEvent.setup()
    await user.click(trigger)
    const panel = screen.getByRole('note')
    expect(within(panel).getByText(/.+/)).toBeInTheDocument()
    expect(panel.textContent?.trim().length).toBeGreaterThan(0)
  })
})

describe('CreatePredictionSheet — presets', () => {
  it('la fila de presets muestra las cuatro opciones con la copy del dueño, y tiene su propio HelpTip', () => {
    renderSheet()
    const presets = within(screen.getByRole('group', { name: /cómo se juega/i }))
    expect(presets.getByRole('radio', { name: /a libro abierto/i })).toBeInTheDocument()
    expect(presets.getByRole('radio', { name: /a ciegas/i })).toBeInTheDocument()
    expect(presets.getByRole('radio', { name: /evolutiva/i })).toBeInTheDocument()
    expect(presets.getByRole('radio', { name: /a medida/i })).toBeInTheDocument()
    expect(helpTipFor(/qué significa cómo se juega/i)).toBeInTheDocument()
  })

  it('"A ciegas" está seleccionado por default', () => {
    renderSheet()
    expect(screen.getByRole('radio', { name: /a ciegas/i })).toBeChecked()
  })

  it('elegir "A libro abierto" fija los cuatro campos subyacentes a la vez', async () => {
    renderSheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: /a libro abierto/i }))
    await openAdvanced()

    const modo = screen.getByRole('group', { name: /^modo/i })
    expect(radioByValue(modo, 'single')).toBeChecked()
    const resultados = within(screen.getByRole('group', { name: /ver los números/i }))
    expect(resultados.getByRole('radio', { name: /^siempre$/i })).toBeChecked()
    const votos = within(screen.getByRole('group', { name: /ver quién eligió qué/i }))
    expect(votos.getByRole('radio', { name: /siempre visible/i })).toBeChecked()
    const ventana = within(
      screen.getByRole('group', { name: /hasta cuándo se puede corregir el voto/i }),
    )
    expect(ventana.getByRole('radio', { name: /hasta el cierre/i })).toBeChecked()
  })

  it('sobreescribir un campo avanzado pasa el preset a "A medida", y restaurarlo vuelve a seleccionar el original', async () => {
    renderSheet()
    await openAdvanced()

    expect(screen.getByRole('radio', { name: /a ciegas/i })).toBeChecked()

    const resultados = within(screen.getByRole('group', { name: /ver los números/i }))
    const user = userEvent.setup()
    await user.click(resultados.getByRole('radio', { name: /^siempre$/i }))
    expect(screen.getByRole('radio', { name: /a medida/i })).toBeChecked()

    await user.click(resultados.getByRole('radio', { name: /al cerrar/i }))
    expect(screen.getByRole('radio', { name: /a ciegas/i })).toBeChecked()
  })
})

describe('CreatePredictionSheet — cierre por pedido del grupo', () => {
  it('con "Cuando lo pida el grupo", muestra una línea fija sobre cuánta gente hace falta y que se cambia en los ajustes del grupo', async () => {
    renderSheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: /cuando lo pida el grupo/i }))
    expect(screen.getByText(/ajustes del grupo/i)).toBeInTheDocument()
  })

  it('muestra una línea de previsualización de puntos según la duración', () => {
    renderSheet()
    expect(screen.getByText(/×.*puntos|hasta 3×/i)).toBeInTheDocument()
  })
})

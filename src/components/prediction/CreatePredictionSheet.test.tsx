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

describe('CreatePredictionSheet — ayuda en cada campo no evidente', () => {
  it('¿Cuándo cierra? tiene su HelpTip, siempre visible', () => {
    renderSheet()
    expect(helpTipFor(/qué significa cuándo cierra/i)).toBeInTheDocument()
  })

  it('con cierre "Cuando lo pida el grupo", aparece el HelpTip del quórum de cierre', async () => {
    renderSheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: /cuando lo pida el grupo/i }))
    expect(
      helpTipFor(/qué significa cuánta gente tiene que pedir el cierre/i),
    ).toBeInTheDocument()
  })

  it('en modo evolutiva, el intervalo tiene su HelpTip', async () => {
    renderSheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: /evolutiva/i }))
    expect(
      helpTipFor(/qué significa cada cuántos días se vuelve a votar/i),
    ).toBeInTheDocument()
  })

  it('"Más opciones" expone HelpTip en quórum de calificación, plazo, resultados y votos', async () => {
    renderSheet()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Más opciones' }))

    expect(helpTipFor(/qué significa cuánta gente tiene que votar/i)).toBeInTheDocument()
    expect(
      helpTipFor(/qué significa cuánto tiempo tiene para juntar gente/i),
    ).toBeInTheDocument()
    expect(helpTipFor(/qué significa ver los números/i)).toBeInTheDocument()
    expect(helpTipFor(/qué significa ver quién eligió qué/i)).toBeInTheDocument()
  })

  it('el HelpTip de cada campo abre un panel con contenido no vacío', async () => {
    renderSheet()
    const user = userEvent.setup()
    const trigger = helpTipFor(/qué significa cuándo cierra/i)
    await user.click(trigger)
    const panel = screen.getByRole('note')
    expect(within(panel).getByText(/.+/)).toBeInTheDocument()
    expect(panel.textContent?.trim().length).toBeGreaterThan(0)
  })
})

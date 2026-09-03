import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelpTip } from './HelpTip'

function renderTip() {
  return render(
    <div>
      <HelpTip label="el quórum">Explicación de qué es el quórum.</HelpTip>
      <button type="button">otro control</button>
    </div>,
  )
}

describe('HelpTip', () => {
  it('el disparador es un <button> real, alcanzable con Tab', async () => {
    renderTip()
    const trigger = screen.getByRole('button', { name: /qué significa el quórum/i })
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger).toHaveAttribute('type', 'button')

    await userEvent.tab()
    expect(trigger).toHaveFocus()
  })

  it('arranca cerrado: aria-expanded=false y sin panel', () => {
    renderTip()
    const trigger = screen.getByRole('button', { name: /qué significa el quórum/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('un tap/click abre el panel y pone aria-expanded=true', async () => {
    const user = userEvent.setup()
    renderTip()
    const trigger = screen.getByRole('button', { name: /qué significa el quórum/i })

    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByRole('note')
    expect(panel).toHaveTextContent('Explicación de qué es el quórum.')
  })

  it('un segundo click cierra', async () => {
    const user = userEvent.setup()
    renderTip()
    const trigger = screen.getByRole('button', { name: /qué significa el quórum/i })

    await user.click(trigger)
    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('Enter y Space abren desde el teclado', async () => {
    const user = userEvent.setup()
    renderTip()
    const trigger = screen.getByRole('button', { name: /qué significa el quórum/i })

    trigger.focus()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.keyboard('{ }')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('Escape cierra y devuelve el foco al disparador', async () => {
    const user = userEvent.setup()
    renderTip()
    const trigger = screen.getByRole('button', { name: /qué significa el quórum/i })

    await user.click(trigger)
    expect(screen.getByRole('note')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('un pointerdown afuera cierra el panel', async () => {
    const user = userEvent.setup()
    renderTip()
    const trigger = screen.getByRole('button', { name: /qué significa el quórum/i })

    await user.click(trigger)
    expect(screen.getByRole('note')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'otro control' }))

    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('el panel no es una trampa de foco: Tab sigue moviéndose a lo que sigue en el DOM', async () => {
    const user = userEvent.setup()
    renderTip()
    const trigger = screen.getByRole('button', { name: /qué significa el quórum/i })

    await user.click(trigger)
    expect(trigger).toHaveFocus()

    await user.tab()
    // El foco no queda atrapado dentro del panel: se mueve al siguiente
    // elemento tabulable del documento, exactamente como si el panel no
    // existiera para el foco.
    expect(screen.getByRole('button', { name: 'otro control' })).toHaveFocus()
  })
})

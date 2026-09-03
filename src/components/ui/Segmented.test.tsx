import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Segmented } from './Segmented'

describe('Segmented — slot de ayuda', () => {
  it('renderiza el nodo `help` dentro del <legend>', () => {
    render(
      <Segmented
        legend="Modo"
        value="single"
        onChange={vi.fn()}
        options={[
          { value: 'single', label: 'Un voto' },
          { value: 'recurring', label: 'Evolutiva' },
        ]}
        help={<button type="button" aria-label="Qué significa Modo">?</button>}
      />,
    )

    const legend = screen.getByText('Modo').closest('legend')
    expect(legend).not.toBeNull()
    const helpButton = screen.getByRole('button', { name: 'Qué significa Modo' })
    expect(legend).toContainElement(helpButton)
  })

  it('sin `help` no rompe nada: sigue sin haber ningún botón extra', () => {
    render(
      <Segmented
        legend="Modo"
        value="single"
        onChange={vi.fn()}
        options={[
          { value: 'single', label: 'Un voto' },
          { value: 'recurring', label: 'Evolutiva' },
        ]}
      />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

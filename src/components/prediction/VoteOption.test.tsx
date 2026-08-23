import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VoteOption } from './VoteOption'
import { ParticipationThreshold } from './ParticipationThreshold'
import type { OptionWithTally } from '@/lib/types'

function makeOption(overrides: Partial<OptionWithTally> = {}): OptionWithTally {
  return {
    id: 'o1',
    prediction_id: 'p1',
    label: 'Sí',
    member_id: null,
    position: 0,
    created_by: 'u1',
    created_at: new Date().toISOString(),
    tally: null,
    ...overrides,
  }
}

describe('VoteOption', () => {
  it('se expone como radio y refleja si está elegida', () => {
    render(
      <VoteOption
        option={makeOption()}
        selected
        disabled={false}
        showResults={false}
        totalVotes={0}
        onSelect={vi.fn()}
      />,
    )

    const radio = screen.getByRole('radio', { name: /sí/i })
    expect(radio).toHaveAttribute('aria-checked', 'true')
  })

  it('avisa el voto al tocarla', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <VoteOption
        option={makeOption()}
        selected={false}
        disabled={false}
        showResults={false}
        totalVotes={0}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByRole('radio', { name: /sí/i }))
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('no vota si está deshabilitada', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <VoteOption
        option={makeOption()}
        selected={false}
        disabled
        showResults={false}
        totalVotes={0}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByRole('radio', { name: /sí/i }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('NO muestra números mientras los resultados están ocultos', () => {
    render(
      <VoteOption
        option={makeOption({ tally: { voteCount: 4, voterCount: 4 } })}
        selected={false}
        disabled={false}
        showResults={false}
        totalVotes={10}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    expect(screen.queryByText('(4)')).not.toBeInTheDocument()
  })

  it('muestra el porcentaje y el recuento cuando se revelan', () => {
    render(
      <VoteOption
        option={makeOption({ tally: { voteCount: 4, voterCount: 4 } })}
        selected={false}
        disabled
        showResults
        totalVotes={10}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText('(4)')).toBeInTheDocument()
  })

  it('marca la opción ganadora con texto, no sólo con color', () => {
    render(
      <VoteOption
        option={makeOption({ tally: { voteCount: 6, voterCount: 6 } })}
        selected={false}
        disabled
        showResults
        isWinner
        totalVotes={10}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('pasó')).toBeInTheDocument()
  })
})

describe('ParticipationThreshold', () => {
  it('dice cuánta gente falta, en singular', () => {
    render(
      <ParticipationThreshold
        participantCount={2}
        minimumParticipants={3}
        qualified={false}
      />,
    )
    expect(screen.getByText('Falta una persona para que siga')).toBeInTheDocument()
  })

  it('usa plural cuando falta más de una', () => {
    render(
      <ParticipationThreshold
        participantCount={0}
        minimumParticipants={3}
        qualified={false}
      />,
    )
    expect(screen.getByText('Faltan 3 personas para que siga')).toBeInTheDocument()
  })

  it('celebra cuando ya juntó la gente', () => {
    render(
      <ParticipationThreshold
        participantCount={3}
        minimumParticipants={3}
        qualified
      />,
    )
    expect(screen.getByText('Listo, esta predicción queda')).toBeInTheDocument()
  })

  it('expone el conteo a lectores de pantalla como una frase, no como dígitos sueltos', () => {
    const { container } = render(
      <ParticipationThreshold
        participantCount={2}
        minimumParticipants={3}
        qualified={false}
      />,
    )

    // Los dígitos animados son decorativos…
    expect(container.querySelector('.t-digit-group')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    // …y el dato viaja en una frase legible.
    expect(screen.getByText('2 de 3 personas')).toBeInTheDocument()
  })
})

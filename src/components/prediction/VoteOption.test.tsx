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
  it('se expone como radio y refleja si está elegida (comprometida)', () => {
    render(
      <VoteOption
        option={makeOption()}
        selected
        staged={false}
        disabled={false}
        showResults={false}
        totalVotes={0}
        onSelect={vi.fn()}
      />,
    )

    const radio = screen.getByRole('radio', { name: /sí/i })
    expect(radio).toHaveAttribute('aria-checked', 'true')
  })

  // Rewritten (strict TDD, high-risk item 4): antes esta prueba se llamaba
  // "avisa el voto al tocarla" y afirmaba que un solo tap COMETÍA el voto
  // (`onSelect` llamando directo a la mutación). Ahora `onSelect` sólo
  // ESTAGIA: la confirmación es un paso aparte, a cargo del consumidor.
  it('un tap SÓLO estagia: llama a onSelect pero no compromete nada por sí solo', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <VoteOption
        option={makeOption()}
        selected={false}
        staged={false}
        disabled={false}
        showResults={false}
        totalVotes={0}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByRole('radio', { name: /sí/i }))
    // El componente no sabe nada de "confirmar": eso lo decide quien lo usa.
    // Lo único que puede afirmar esta prueba es que se llamó una vez.
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('el estado estagiado se refleja en aria-checked y en data-staged, no en selected', () => {
    render(
      <VoteOption
        option={makeOption()}
        selected={false}
        staged
        disabled={false}
        showResults={false}
        totalVotes={0}
        onSelect={vi.fn()}
      />,
    )

    const radio = screen.getByRole('radio', { name: /sí/i })
    expect(radio).toHaveAttribute('aria-checked', 'true')
    expect(radio).toHaveAttribute('data-staged', 'true')
    expect(radio).toHaveAttribute('data-checked', 'false')
  })

  it('comprometida (selected) y NO estagiada: data-committed y sufijo sr-only', () => {
    render(
      <VoteOption
        option={makeOption()}
        selected
        staged={false}
        disabled={false}
        showResults={false}
        totalVotes={0}
        onSelect={vi.fn()}
      />,
    )

    const radio = screen.getByRole('radio', { name: /sí/i })
    expect(radio).toHaveAttribute('data-committed', 'true')
    expect(radio).toHaveTextContent('tu voto guardado')
  })

  it('no vota (ni estagia) si está deshabilitada', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <VoteOption
        option={makeOption()}
        selected={false}
        staged={false}
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
        staged={false}
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
        staged={false}
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
        staged={false}
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
        requiredParticipants={3}
        memberCount={5}
        qualified={false}
      />,
    )
    expect(screen.getByText('Falta una persona para que quede')).toBeInTheDocument()
  })

  it('usa plural cuando falta más de una', () => {
    render(
      <ParticipationThreshold
        participantCount={0}
        requiredParticipants={3}
        memberCount={5}
        qualified={false}
      />,
    )
    expect(screen.getByText('Faltan 3 personas para que quede')).toBeInTheDocument()
  })

  it('celebra cuando ya juntó la gente', () => {
    render(
      <ParticipationThreshold
        participantCount={3}
        requiredParticipants={3}
        memberCount={5}
        qualified
      />,
    )
    expect(screen.getByText('Listo, esta predicción queda')).toBeInTheDocument()
  })

  it('expone el conteo a lectores de pantalla como una frase, no como dígitos sueltos', () => {
    const { container } = render(
      <ParticipationThreshold
        participantCount={2}
        requiredParticipants={3}
        memberCount={5}
        qualified={false}
      />,
    )

    // Los dígitos animados son decorativos…
    expect(container.querySelector('.t-digit-group')).toHaveAttribute('aria-hidden', 'true')
    // …y el dato viaja en una frase legible, con el umbral dicho aparte.
    // `PopNumber` también rinde un `.sr-only` propio, así que se busca por
    // contenido y no por posición.
    const spoken = [...container.querySelectorAll('.sr-only')].map((n) => n.textContent)
    expect(spoken).toContain('Votaron 2 de 5 personas del grupo, necesita 3')
  })

  it('el denominador visible es el grupo, no el umbral', () => {
    const { container } = render(
      <ParticipationThreshold
        participantCount={2}
        requiredParticipants={3}
        memberCount={5}
        qualified={false}
      />,
    )
    // Era el reclamo original: un "de 3" que no era nadie. El denominador
    // tiene que ser la gente que existe en el grupo.
    expect(container.textContent).toContain('de 5')
    expect(container.textContent).not.toContain('de 3')
  })

  it('mientras no llegó el conteo de integrantes, cae al umbral y no muestra "de 0"', () => {
    const { container } = render(
      <ParticipationThreshold
        participantCount={0}
        requiredParticipants={3}
        memberCount={0}
        qualified={false}
      />,
    )
    expect(container.textContent).not.toContain('de 0')
    expect(container.textContent).toContain('de 3')
  })

  it('un grupo de 2 personas renderiza exactamente 2 caras, capadas por memberCount', () => {
    const { container } = render(
      <ParticipationThreshold
        participantCount={2}
        requiredParticipants={2}
        memberCount={2}
        qualified
      />,
    )
    // La fila de caras se dibuja contra el grupo: un grupo de 2 nunca dibuja
    // una tercera cara vacía. Es el PRIMER bloque `aria-hidden` del
    // componente, en orden de render.
    const faceRow = container.querySelectorAll('[aria-hidden="true"]')[0]!
    expect(faceRow.children).toHaveLength(2)
  })
})

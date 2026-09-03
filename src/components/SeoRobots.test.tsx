import { describe, expect, it } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom'
import { SeoRobots } from './SeoRobots'

function metaContent(): string | null {
  return document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null
}

function App() {
  return (
    <>
      <SeoRobots />
      <Routes>
        <Route path="/" element={<Link to="/g/x">ir al grupo</Link>} />
        <Route path="/g/:groupId" element={<Link to="/">volver</Link>} />
      </Routes>
    </>
  )
}

describe('SeoRobots', () => {
  it('pone el meta indexable en una ruta de la lista blanca', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(metaContent()).toBe('index, follow')
  })

  it('pone noindex en una ruta privada', () => {
    render(
      <MemoryRouter initialEntries={['/g/x']}>
        <App />
      </MemoryRouter>,
    )
    expect(metaContent()).toBe('noindex, nofollow')
  })

  it('actualiza el meta al navegar de una ruta privada a una indexable (ida)', async () => {
    const { findByText } = render(
      <MemoryRouter initialEntries={['/g/x']}>
        <App />
      </MemoryRouter>,
    )
    expect(metaContent()).toBe('noindex, nofollow')

    const link = await findByText('volver')
    fireEvent.click(link)

    expect(await findByText('ir al grupo')).toBeInTheDocument()
    expect(metaContent()).toBe('index, follow')
  })

  it('actualiza el meta al navegar de una ruta indexable a una privada (vuelta)', async () => {
    const { findByText } = render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(metaContent()).toBe('index, follow')

    const link = await findByText('ir al grupo')
    fireEvent.click(link)

    expect(await findByText('volver')).toBeInTheDocument()
    expect(metaContent()).toBe('noindex, nofollow')
  })
})

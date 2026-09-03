import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Landing } from './Landing'
import { AuthContext, type AuthState } from '@/auth/context'

const FAKE_AUTH: AuthState = {
  user: null,
  profile: null,
  loading: false,
  needsProfile: false,
  signIn: async () => {},
  signUp: async () => {},
  signInWithGoogle: () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
}

function renderLanding() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={FAKE_AUTH}>
        <MemoryRouter initialEntries={['/']}>
          <Landing />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

describe('Landing — canonical y Open Graph', () => {
  it('el canonical apunta exactamente a la raíz del sitio, sin path ni query', () => {
    renderLanding()
    const canonical = document.querySelector('link[rel="canonical"]')
    expect(canonical).not.toBeNull()
    expect(canonical!.getAttribute('href')).toBe(window.location.origin)
  })

  it('og:url también es exactamente la raíz, sin path ni query', () => {
    renderLanding()
    const ogUrl = document.querySelector('meta[property="og:url"]')
    expect(ogUrl).not.toBeNull()
    expect(ogUrl!.getAttribute('content')).toBe(window.location.origin)
  })

  it('trae og:title y og:type', () => {
    renderLanding()
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBeTruthy()
    expect(document.querySelector('meta[property="og:type"]')?.getAttribute('content')).toBe(
      'website',
    )
  })
})

describe('Landing — ejemplo de predicción con datos reales, no hardcode', () => {
  it('no usa el "3" hardcodeado ni el copy de "48 horas… tres personas"', () => {
    renderLanding()
    expect(screen.queryByText(/48 horas/)).not.toBeInTheDocument()
    expect(screen.queryByText(/al menos tres personas/)).not.toBeInTheDocument()
  })
})

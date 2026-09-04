import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GroupSettings } from './GroupSettings'
import { AuthContext, type AuthState } from '@/auth/context'
import { ToastContext } from '@/components/ui/toast-context'

const FAKE_AUTH: AuthState = {
  user: { id: 'u1', email: 'owner@cantado.test' },
  profile: { id: 'u1', display_name: 'Owner', avatar_seed: 'OW', accent: 0, created_at: '', updated_at: '' },
  loading: false,
  needsProfile: false,
  signIn: async () => {},
  signUp: async () => {},
  signInWithGoogle: () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
}

function GroupContextWrapper({ isAdmin }: { isAdmin: boolean }) {
  return <Outlet context={{ groupId: 'g1', isAdmin }} />
}

function renderSettings(isAdmin: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={FAKE_AUTH}>
        <ToastContext.Provider value={{ show: () => {}, dismiss: () => {} }}>
          <MemoryRouter initialEntries={['/g/g1/ajustes']}>
            <Routes>
              <Route element={<GroupContextWrapper isAdmin={isAdmin} />}>
                <Route path="/g/g1/ajustes" element={<GroupSettings />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </ToastContext.Provider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

describe('GroupSettings — "Cómo funciona este grupo", sólo para admins', () => {
  it('un admin ve el toggle de calificación, el input de quórum de cierre y un botón de guardar', () => {
    renderSettings(true)
    expect(screen.getByRole('switch', { name: /calificación/i })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /quórum de cierre/i })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /guardar ajustes del grupo/i }),
    ).toBeInTheDocument()
  })

  it('la calificación empieza apagada por default: el % de calificación NO aparece hasta prenderla', () => {
    renderSettings(true)
    expect(screen.queryByRole('spinbutton', { name: /porcentaje/i })).not.toBeInTheDocument()
  })

  it('un no-admin ve los tres valores como texto de sólo lectura, sin ningún control enfocable, y la leyenda de "sólo quien administra"', () => {
    renderSettings(false)
    expect(screen.queryByRole('switch', { name: /calificación/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /quórum de cierre/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /guardar ajustes del grupo/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/sólo quien administra/i)).toBeInTheDocument()
  })

  it('el input de quórum de cierre tiene piso 1', () => {
    renderSettings(true)
    const input = screen.getByRole('spinbutton', { name: /quórum de cierre/i })
    expect(input).toHaveAttribute('min', '1')
  })
})

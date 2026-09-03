import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import type { Profile } from '@/lib/types'
import { AuthContext, type AuthState, type SessionUser } from './context'

/**
 * Sesión y perfil.
 *
 * La sesión vive en una cookie `httpOnly` que este código no puede leer —ese
 * es justamente el punto: un XSS no se la puede llevar—. Por eso al arrancar
 * se le pregunta al servidor quién sos (`/api/auth/me`) en lugar de leer un
 * token de localStorage.
 *
 * El perfil (nombre visible y color) se crea recién en el onboarding, así que
 * puede haber sesión sin perfil: ese es el estado `needsProfile`, y es el
 * mismo sin importar si entraste con contraseña o con Google.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<SessionUser | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    try {
      return await apiGet<Profile | null>(`/profiles/${userId}`)
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const { user: session } = await apiGet<{ user: SessionUser | null }>('/auth/me')
        if (!active) return
        setUser(session)
        if (session) {
          const next = await loadProfile(session.id)
          if (active) setProfile(next)
        }
      } catch {
        // El servidor no contestó. Se sigue como anónimo: la pantalla de
        // ingreso es un lugar razonable donde caer.
        if (active) setUser(null)
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [loadProfile])

  /** Después de entrar hay que traer el perfil antes de soltar la pantalla. */
  const adopt = useCallback(
    async (session: SessionUser) => {
      setUser(session)
      setProfile(await loadProfile(session.id))
    },
    [loadProfile],
  )

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { user: session } = await apiPost<{ user: SessionUser }>('/auth/login', {
        email,
        password,
      })
      await adopt(session)
    },
    [adopt],
  )

  const signUp = useCallback(
    async (email: string, password: string) => {
      const { user: session } = await apiPost<{ user: SessionUser }>('/auth/register', {
        email,
        password,
      })
      await adopt(session)
    },
    [adopt],
  )

  // No es una promesa: OAuth es una navegación de verdad, el navegador se va a
  // Google y vuelve por el callback del servidor con la cookie ya puesta.
  const signInWithGoogle = useCallback((next?: string) => {
    const url = next
      ? `/api/auth/google?next=${encodeURIComponent(next)}`
      : '/api/auth/google'
    window.location.href = url
  }, [])

  const signOut = useCallback(async () => {
    await apiPost<void>('/auth/logout')
    setUser(null)
    setProfile(null)
    // El caché tiene datos de grupos privados: se tira entero.
    queryClient.clear()
  }, [queryClient])

  const refreshProfile = useCallback(async () => {
    if (!user) return
    setProfile(await loadProfile(user.id))
  }, [user, loadProfile])

  const value = useMemo<AuthState>(
    () => ({
      user,
      profile,
      loading,
      needsProfile: Boolean(user) && profile === null && !loading,
      signIn,
      signUp,
      signInWithGoogle,
      signOut,
      refreshProfile,
    }),
    [user, profile, loading, signIn, signUp, signInWithGoogle, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

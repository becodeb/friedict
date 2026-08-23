import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase, authRedirectTo } from '@/lib/supabase'
import type { Profile } from '@/lib/types'
import { AuthContext, type AuthState } from './context'

/**
 * Sesión y perfil.
 *
 * Autenticación por Magic Link: no le pedimos a nadie que invente una
 * contraseña para votar si Fran llega tarde. El perfil (nombre visible y color)
 * se crea recién en el onboarding, así que puede haber sesión sin perfil: ese
 * es el estado `needsProfile`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    if (error) return null
    return data
  }, [])

  useEffect(() => {
    let active = true

    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user) {
        const next = await loadProfile(data.session.user.id)
        if (active) setProfile(next)
      }
      if (active) setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        setSession(nextSession)

        if (event === 'SIGNED_OUT') {
          setProfile(null)
          queryClient.clear()
          return
        }

        // `onAuthStateChange` no admite callbacks async sin riesgo de deadlock
        // con el propio cliente, así que el trabajo se difiere.
        if (nextSession?.user) {
          setTimeout(() => {
            void loadProfile(nextSession.user.id).then((next) => {
              setProfile(next)
            })
          }, 0)
        }
      },
    )

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [loadProfile, queryClient])

  const signInWithEmail = useCallback(async (email: string, next?: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: authRedirectTo(next),
        shouldCreateUser: true,
      },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    queryClient.clear()
  }, [queryClient])

  const refreshProfile = useCallback(async () => {
    if (!session?.user) return
    setProfile(await loadProfile(session.user.id))
  }, [session, loadProfile])

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      needsProfile: Boolean(session?.user) && profile === null && !loading,
      signInWithEmail,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, signInWithEmail, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

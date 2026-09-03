import { createContext } from 'react'
import type { Profile } from '@/lib/types'

/** Lo que la app sabe de la cuenta. El hash de la contraseña nunca sale del servidor. */
export interface SessionUser {
  id: string
  email: string
}

export interface AuthState {
  user: SessionUser | null
  profile: Profile | null
  /** `true` hasta que se resolvió si hay sesión. Evita parpadeos de redirección. */
  loading: boolean
  /** Hay sesión pero todavía no completó el onboarding. */
  needsProfile: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  /** Se va del sitio: manda al flujo de Google y vuelve por /api/auth/google/callback. */
  signInWithGoogle: (next?: string) => void
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

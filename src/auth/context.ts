import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { Profile } from '@/lib/types'

export interface AuthState {
  session: Session | null
  user: User | null
  profile: Profile | null
  /** `true` hasta que se resolvió si hay sesión. Evita parpadeos de redirección. */
  loading: boolean
  /** Hay sesión pero todavía no completó el onboarding. */
  needsProfile: boolean
  signInWithEmail: (email: string, next?: string) => Promise<void>
  signInWithGoogle: (next?: string) => Promise<void>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

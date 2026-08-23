import { useContext } from 'react'
import { AuthContext, type AuthState } from './context'

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth se usó fuera de <AuthProvider>.')
  }
  return context
}

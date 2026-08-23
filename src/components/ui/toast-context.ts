import { createContext, useContext } from 'react'

export type ToastTone = 'neutral' | 'success' | 'error'

export interface ToastInput {
  message: string
  tone?: ToastTone
  /** Milisegundos en pantalla. Los errores se quedan más tiempo. */
  duration?: number
  action?: { label: string; onClick: () => void }
}

export interface ToastItem extends ToastInput {
  id: number
  tone: ToastTone
}

export interface ToastApi {
  show: (input: ToastInput) => void
  dismiss: (id: number) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast se usó fuera de <ToastProvider>.')
  return context
}

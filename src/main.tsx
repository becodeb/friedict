import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/auth/AuthProvider'
import { ToastProvider } from '@/components/ui/ToastProvider'
import { App } from './App'
import './styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Realtime ya empuja los cambios; refrescar al enfocar la ventana sólo
      // agregaría pedidos redundantes.
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Un 403 de RLS no mejora reintentando.
        const code = (error as { code?: string } | null)?.code
        if (code === '42501' || code === 'PGRST301') return false
        return failureCount < 2
      },
      staleTime: 10_000,
    },
    mutations: { retry: 0 },
  },
})

const container = document.getElementById('root')
if (!container) throw new Error('Falta #root en index.html')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

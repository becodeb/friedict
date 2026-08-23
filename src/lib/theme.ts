import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'cantado.theme'

function readStored(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Tema claro/oscuro.
 *
 * El valor inicial ya lo aplicó el script inline de index.html antes del primer
 * pintado, así que acá sólo se lee el atributo que ya está puesto: no hay
 * flash. Mientras no haya elección explícita, se sigue al sistema.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === 'undefined') return 'light'
    const current = document.documentElement.dataset.theme
    return current === 'dark' ? 'dark' : 'light'
  })

  useEffect(() => {
    if (readStored()) return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      const next = systemTheme()
      document.documentElement.dataset.theme = next
      setTheme(next)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Modo incógnito con storage bloqueado: el tema dura la sesión y ya.
      }
      return next
    })
  }, [])

  return { theme, toggle }
}

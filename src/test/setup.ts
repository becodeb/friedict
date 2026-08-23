import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Las variables de entorno de Supabase se inyectan acá para que importar el
// cliente en un test no explote. Los tests unitarios no llaman a la red.
process.env.VITE_SUPABASE_URL ??= 'http://127.0.0.1:54421'
process.env.VITE_SUPABASE_ANON_KEY ??= 'test-anon-key'

// jsdom no implementa matchMedia y la biblioteca de motion lo consulta para
// respetar prefers-reduced-motion.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}

afterEach(() => {
  cleanup()
})

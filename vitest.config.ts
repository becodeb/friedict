import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Los tests de integración hablan con el stack local de Supabase, así que
    // corren en su propio proyecto y no en cada `npm test`.
    exclude: ['node_modules', 'dist', 'e2e/**'],
    css: false,
  },
})

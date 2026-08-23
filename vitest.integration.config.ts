import { defineConfig } from 'vitest/config'

/**
 * Tests de integración. Requieren el stack local levantado:
 *
 *   npx supabase start && npx supabase db reset
 *   npm run test:integration
 *
 * Corren en serie (`singleThread`) porque comparten una única base de datos y
 * varios manipulan fechas de filas sembradas.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    fileParallelism: false,
  },
})

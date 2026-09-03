import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist',
      // Artefactos generados: el service worker del plugin de PWA y los
      // reportes de Playwright son código minificado que no se revisa.
      'dev-dist',
      'public/sw.js',
      'public/workbox-*.js',
      'test-results',
      'playwright-report',
      'blob-report',
      'screenshots',
      'node_modules',
      'coverage',
      // Artefactos internos del CLI de Supabase.
      'supabase/.temp',
      'supabase/.branches',
      // Generado por `supabase gen types`.
      'src/lib/database.types.ts',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Las respuestas de PostgREST se tipan a mano en la capa de datos; el
      // cast puntual es deliberado y está comentado donde ocurre.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.ts', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    // El servidor corre sin interfaz: sus logs SON su forma de contar qué está
    // pasando. Prohibirle console.log ahí no protege de nada.
    files: ['server/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['e2e/**/*.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx', 'src/test/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-console': 'off' },
  },
)

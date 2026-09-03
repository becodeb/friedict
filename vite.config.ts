import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'friedict — predicciones entre amigos',
        short_name: 'friedict',
        description:
          'Predicciones privadas entre amigos. Elegí qué va a pasar y descubrí quién tenía razón.',
        lang: 'es-AR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f1f0fa',
        theme_color: '#f1f0fa',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Sólo el app shell entra en precache. Nada de contenido de grupos.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/auth\//],
        // Regla explícita: las respuestas de Supabase NUNCA se cachean. Son
        // privadas y con sesión; dejarlas en CacheStorage sería filtrar el
        // contenido de un grupo a cualquiera que abra el navegador después.
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/rest/') ||
              url.pathname.startsWith('/auth/') ||
              url.pathname.startsWith('/realtime/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Puertos corridos respecto de los defaults de Vite para poder convivir con
  // otros proyectos levantados en la misma máquina.
  server: {
    port: 5183,
    strictPort: true,
    // En desarrollo el frontend lo sirve Vite y la API el servidor de
    // `server/`. El proxy hace que compartan origen igual que en producción,
    // que es lo que necesita la cookie de sesión para viajar.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8183',
        changeOrigin: false,
        // El realtime va por WebSocket sobre la misma ruta.
        ws: true,
      },
    },
  },
  preview: {
    port: 4183,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Se separan las dependencias que cambian a otro ritmo que la app: un
        // deploy con cambios de UI no invalida el caché de React ni el del
        // cliente de Supabase, y los chunks bajan en paralelo.
        //
        // La forma de función y no el objeto: con el objeto, Rollup sólo
        // agrupa el módulo de entrada del paquete y deja sus dependencias
        // internas (react-dom/client, scheduler) en el chunk principal.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          if (id.includes('@supabase')) return 'supabase'
          if (
            id.includes('react-dom') ||
            id.includes('react-router') ||
            id.includes('/scheduler/') ||
            /node_modules\/react\//.test(id)
          ) {
            return 'react'
          }
          if (id.includes('@tanstack')) return 'query'
          // Sólo llega con el detalle de una predicción evolutiva.
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('victory')) {
            return 'charts'
          }
          return undefined
        },
      },
    },
  },
})

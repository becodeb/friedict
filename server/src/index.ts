import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type NextFunction, type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import { adminPool, closePools } from './db.js'
import { env } from './env.js'
import { attachUser, authRouter } from './auth.js'
import { apiRouter } from './routes.js'
import { rpcRouter } from './rpc.js'
import { attachRealtime } from './realtime.js'
import { runMigrations, runSeed } from './migrate.js'
import { applyRobotsHeader } from './robots.js'

/**
 * El servidor de friedict.
 *
 * Un solo proceso sirve la API y los archivos estáticos del frontend. No es
 * pereza: al compartir origen no hay CORS que configurar, la cookie de sesión
 * es de primera parte (y por lo tanto sobrevive a las restricciones que los
 * navegadores le ponen a las de terceros), y el deploy es un contenedor en vez
 * de dos.
 */

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const app = express()

// Traefik (el proxy de Coolify) termina el TLS y pasa el pedido por HTTP. Sin
// esto, `req.protocol` diría "http" y el redirect_uri de Google saldría mal.
app.set('trust proxy', 1)
app.disable('x-powered-by')

app.use(express.json({ limit: '128kb' }))
app.use(cookieParser())
app.use(attachUser)

app.get('/api/health', async (_req, res) => {
  try {
    await adminPool.query('select 1')
    res.json({ ok: true })
  } catch {
    res.status(503).json({ ok: false, error: 'db_unreachable' })
  }
})

app.use('/api/auth', authRouter)
app.use('/api/rpc', rpcRouter)
app.use('/api', apiRouter)

// Una ruta /api que no existe devuelve JSON, no el index.html. Si cayera en el
// catch-all de la SPA, el cliente recibiría HTML donde espera JSON y el error
// sería incomprensible.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'Ese endpoint no existe.' })
})

// ---------------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------------
app.use(
  express.static(STATIC_DIR, {
    // Los assets llevan hash en el nombre: si cambia el contenido, cambia el
    // nombre. Se pueden cachear para siempre.
    setHeaders(res, filePath) {
      if (filePath.includes('assets')) {
        // Los assets llevan hash en el nombre: si cambia el contenido, cambia
        // el nombre. Se pueden cachear para siempre.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        // `no-cache` y NO `no-store`: la diferencia importa. `no-cache` obliga
        // a revalidar en cada carga, que es lo que se quiere para que un
        // service worker viejo no deje la app clavada en una versión anterior.
        // `no-store` va más allá y hace que Chrome directamente se niegue a
        // registrar el service worker, con un error que no dice por qué.
        res.setHeader('Cache-Control', 'no-cache')
      }
      res.setHeader('X-Content-Type-Options', 'nosniff')
      // Indexación selectiva y default-deny: ver server/src/robots.ts. Los
      // assets estáticos (imágenes, manifest, íconos) nunca están en la
      // lista blanca, así que siempre salen noindex acá.
      applyRobotsHeader(res, filePath.slice(STATIC_DIR.length) || '/')
    },
    index: false,
  }),
)

// Es una SPA: cualquier ruta que no sea un archivo real devuelve index.html,
// si no /g/<id>/ranking daría 404 al recargar.
app.get(/.*/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  applyRobotsHeader(res, req.path)
  res.sendFile(join(STATIC_DIR, 'index.html'))
})

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------
/**
 * Traduce los errores de Postgres a HTTP.
 *
 * Las funciones de dominio levantan excepciones con mensajes cortos y estables
 * (`auth_required`, `not_a_member`, `prediction_closed`…) que el frontend ya
 * sabe interpretar en `friendlyError`. Se pasan tal cual; lo que NO se pasa es
 * el detalle interno de Postgres, que puede incluir nombres de tablas y
 * fragmentos de consultas.
 */
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const pgError = error as { code?: string; message?: string }
  const code = pgError.code ?? ''
  const message = pgError.message ?? 'Algo salió mal.'

  // 28000 = la función pidió sesión y no había.
  if (code === '28000') {
    res.status(401).json({ error: 'auth_required', message: 'Necesitás iniciar sesión.' })
    return
  }
  // 42501 = insufficient_privilege, lo que levanta la RLS y los chequeos de rol.
  if (code === '42501') {
    res.status(403).json({ error: 'forbidden', message })
    return
  }
  // Violaciones de constraint y `raise exception` de las funciones de dominio.
  if (code.startsWith('23') || code === 'P0001' || code === '22023') {
    res.status(400).json({ error: 'invalid_request', message })
    return
  }

  console.error('[error]', error)
  res.status(500).json({ error: 'internal', message: 'Algo salió mal de este lado.' })
})

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await runMigrations()
  if (env.seedOnBoot) await runSeed()

  const server = createServer(app)
  attachRealtime(server)

  // Tercera vía del cierre automático de predicciones, además de pg_cron y de
  // las validaciones dentro de cast_vote. La imagen oficial de Postgres no
  // trae pg_cron, así que en la práctica ESTA es la que corre.
  const finalizer = setInterval(() => {
    adminPool
      .query('select public.finalize_predictions()')
      .catch((error: Error) => console.error('[finalize]', error.message))
  }, 60_000)

  server.listen(env.port, () => {
    console.log(`[server] friedict escuchando en :${env.port} (${env.nodeEnv})`)
    if (!env.google) {
      console.log('[server] Google sin configurar: sólo se puede entrar con contraseña')
    }
  })

  const shutdown = (signal: string): void => {
    console.log(`[server] ${signal}, cerrando`)
    clearInterval(finalizer)
    server.close(() => {
      void closePools().then(() => process.exit(0))
    })
    // Si algo queda colgado, no se espera para siempre.
    setTimeout(() => process.exit(1), 10_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((error: unknown) => {
  console.error('[server] no pudo arrancar:', error)
  process.exit(1)
})

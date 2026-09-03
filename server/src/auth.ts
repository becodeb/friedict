import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { pool } from './db.js'
import { env } from './env.js'

/**
 * Autenticación.
 *
 * Reemplaza a GoTrue. Dos caminos: contraseña y Google. El Magic Link quedó
 * afuera a propósito — necesita un proveedor de mail saliente, que hoy no hay,
 * y una app de amigos no puede depender de que el mail funcione para poder
 * entrar.
 *
 * La sesión es un JWT firmado, guardado en una cookie `httpOnly`. No se guarda
 * en localStorage: una cookie `httpOnly` no la puede leer el JavaScript de la
 * página, así que un XSS no se lleva la sesión. El precio es tener que pensar
 * en CSRF, que se cubre con `SameSite=Lax` (el navegador no manda la cookie en
 * peticiones POST que vengan de otro sitio).
 */

const COOKIE_NAME = 'friedict_session'
const BCRYPT_ROUNDS = 12

export interface SessionUser {
  id: string
  email: string
}

// Express no sabe de `userId`; se lo agregamos al tipo de Request.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string | null
    }
  }
}

function issueSession(res: Response, userId: string): void {
  const token = jwt.sign({ sub: userId }, env.jwtSecret, {
    expiresIn: Math.floor(env.sessionMaxAgeMs / 1000),
    jwtid: randomUUID(),
  })

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    // En desarrollo la app se sirve por http://localhost, donde una cookie
    // `secure` no viajaría nunca y no se podría iniciar sesión.
    secure: env.isProduction,
    sameSite: 'lax',
    maxAge: env.sessionMaxAgeMs,
    path: '/',
  })
}

function clearSession(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' })
}

/**
 * Lee la cookie y deja el usuario en `req.userId`. Nunca rechaza: hay
 * endpoints que funcionan sin sesión (la vista previa de una invitación, por
 * ejemplo). Rechazar es tarea de `requireAuth`.
 */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  req.userId = null

  const raw = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME]
  if (raw) {
    try {
      const payload = jwt.verify(raw, env.jwtSecret) as jwt.JwtPayload
      if (typeof payload.sub === 'string') req.userId = payload.sub
    } catch {
      // Token vencido, manipulado o firmado con otro secreto. Se ignora y la
      // petición sigue como anónima; el cliente va a recibir un 401 de
      // `requireAuth` y va a mandar a la persona a /entrar.
    }
  }
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.userId) {
    res.status(401).json({ error: 'auth_required', message: 'Necesitás iniciar sesión.' })
    return
  }
  next()
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

const credentialsSchema = z.object({
  email: z.string().trim().min(3).max(160).email('Ese email no parece válido.'),
  password: z.string().min(8, 'La contraseña necesita al menos 8 caracteres.').max(200),
})

export const authRouter = Router()

authRouter.post('/register', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid_input',
      message: parsed.error.issues[0]?.message ?? 'Revisá los datos.',
    })
    return
  }

  const hash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS)
  const { rows } = await pool.query<{ auth_register: string | null }>(
    'select public.auth_register($1, $2) as auth_register',
    [parsed.data.email, hash],
  )
  const userId = rows[0]?.auth_register ?? null

  if (!userId) {
    // El mail ya existe. Se dice tal cual: en una app donde te invitan por
    // link, esconder que la cuenta existe no protege de nada y sí confunde a
    // quien simplemente se olvidó de que ya se había registrado.
    res.status(409).json({
      error: 'email_taken',
      message: 'Ya hay una cuenta con ese mail. Probá iniciar sesión.',
    })
    return
  }

  issueSession(res, userId)
  res.status(201).json({ user: { id: userId, email: parsed.data.email } })
})

authRouter.post('/login', async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_input', message: 'Revisá el mail y la contraseña.' })
    return
  }

  const { rows } = await pool.query<{ id: string; email: string; password_hash: string | null }>(
    'select * from public.auth_find_by_email($1)',
    [parsed.data.email],
  )
  const user = rows[0]

  // Se compara SIEMPRE contra un hash, exista la cuenta o no. Si se saliera
  // antes cuando el mail no existe, el tiempo de respuesta diría cuáles mails
  // están registrados.
  const hash = user?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin'
  const ok = await bcrypt.compare(parsed.data.password, hash)

  if (!user || !user.password_hash || !ok) {
    res.status(401).json({ error: 'invalid_credentials', message: 'Mail o contraseña incorrectos.' })
    return
  }

  await pool.query('select public.auth_touch_sign_in($1)', [user.id])
  issueSession(res, user.id)
  res.json({ user: { id: user.id, email: user.email } })
})

authRouter.post('/logout', (_req, res) => {
  clearSession(res)
  res.status(204).end()
})

authRouter.get('/me', async (req, res) => {
  if (!req.userId) {
    res.json({ user: null })
    return
  }

  const { rows } = await pool.query<{ id: string; email: string }>(
    'select id, email from public.auth_session_user($1)',
    [req.userId],
  )
  const user = rows[0] ?? null

  // La cuenta se borró pero la cookie sigue viva: se limpia para que el
  // navegador deje de mandarla.
  if (!user) {
    clearSession(res)
    res.json({ user: null })
    return
  }

  res.json({ user })
})

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------
// Flujo de código de autorización. El intercambio del código por el token lo
// hace el servidor contra Google por HTTPS, así que el `id_token` que vuelve
// es confiable por venir de donde viene: se puede leer su payload sin
// verificar la firma. Lo que NUNCA se aceptaría es un `id_token` que mande el
// navegador.

function googleRedirectUri(req: Request): string {
  const origin = env.publicOrigin ?? `${req.protocol}://${req.get('host')}`
  return `${origin}/api/auth/google/callback`
}

/** El `next` sólo puede ser una ruta interna: si no, es un redirect abierto. */
function safeNext(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/'
}

authRouter.get('/google', (req, res) => {
  if (!env.google) {
    res.status(503).json({
      error: 'google_not_configured',
      message: 'El ingreso con Google todavía no está configurado en este servidor.',
    })
    return
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', env.google.clientId)
  url.searchParams.set('redirect_uri', googleRedirectUri(req))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email')
  url.searchParams.set('state', safeNext(req.query.next))
  // `select_account` evita el caso molesto de que entre siempre con la misma
  // cuenta sin preguntar, en una máquina con varias sesiones de Google.
  url.searchParams.set('prompt', 'select_account')

  res.redirect(url.toString())
})

authRouter.get('/google/callback', async (req, res) => {
  if (!env.google) {
    res.redirect('/entrar?error=google_no_configurado')
    return
  }

  const code = typeof req.query.code === 'string' ? req.query.code : null
  if (!code) {
    res.redirect('/entrar?error=google_cancelado')
    return
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.google.clientId,
        client_secret: env.google.clientSecret,
        redirect_uri: googleRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      throw new Error(`Google devolvió ${tokenResponse.status} al canjear el código`)
    }

    const body = (await tokenResponse.json()) as { id_token?: string }
    if (!body.id_token) throw new Error('Google no devolvió id_token')

    const payloadPart = body.id_token.split('.')[1]
    if (!payloadPart) throw new Error('id_token con formato inesperado')
    const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
      sub?: string
      email?: string
      email_verified?: boolean
    }

    if (!claims.sub || !claims.email) throw new Error('id_token sin sub o email')
    if (claims.email_verified === false) {
      throw new Error('la cuenta de Google no tiene el mail verificado')
    }

    const { rows } = await pool.query<{ auth_upsert_google: string }>(
      'select public.auth_upsert_google($1, $2) as auth_upsert_google',
      [claims.sub, claims.email],
    )
    const userId = rows[0]?.auth_upsert_google
    if (!userId) throw new Error('no se pudo resolver la cuenta')

    issueSession(res, userId)
    res.redirect(safeNext(req.query.state))
  } catch (error) {
    console.error('[auth] Google falló:', error instanceof Error ? error.message : error)
    res.redirect('/entrar?error=google_fallo')
  }
})

import { normalizePublicOrigin } from './public-origin.js'

/**
 * Configuración.
 *
 * Se lee UNA vez al arrancar y se valida ahí mismo: un servidor que arranca
 * con la mitad de la configuración y explota en la primera petición es mucho
 * peor que uno que no arranca y dice qué le falta.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(
      `Falta la variable de entorno ${name}. Mirá .env.example para saber qué va.`,
    )
  }
  return value
}

function optional(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim() !== '' ? value : undefined
}

const jwtSecret = required('JWT_SECRET')
if (jwtSecret.length < 32) {
  throw new Error(
    'JWT_SECRET tiene que tener al menos 32 caracteres. Generá uno con `openssl rand -base64 48`.',
  )
}

const googleClientId = optional('GOOGLE_CLIENT_ID')
const googleClientSecret = optional('GOOGLE_CLIENT_SECRET')

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 8183),

  /** Conexión de superusuario. Sólo para migraciones y para crear el rol de la app. */
  adminDatabaseUrl: required('ADMIN_DATABASE_URL'),
  /**
   * Conexión de la aplicación. Es un rol SIN privilegios de superusuario y que
   * NO es dueño de las tablas: si lo fuera, Postgres le saltearía la RLS
   * entera y toda la seguridad del producto quedaría en la nada.
   */
  databaseUrl: required('DATABASE_URL'),

  jwtSecret,
  /** Treinta días. La sesión de una app de amigos no tiene por qué durar poco. */
  sessionMaxAgeMs: 30 * 24 * 60 * 60 * 1000,

  /**
   * Origen público, para armar el redirect_uri de Google. Se normaliza a URL
   * absoluta: Coolify expone el dominio pelado en `SERVICE_FQDN_APP` y con
   * esquema en `SERVICE_URL_APP`, y un dominio sin `https://` rompe el flujo
   * de OAuth con un `redirect_uri_mismatch` que no dice por qué.
   */
  publicOrigin: normalizePublicOrigin(optional('PUBLIC_ORIGIN')),

  google:
    googleClientId && googleClientSecret
      ? { clientId: googleClientId, clientSecret: googleClientSecret }
      : null,

  /** Carga el seed después de migrar. Sólo para entornos de prueba. */
  seedOnBoot: process.env.SEED_ON_BOOT === '1',
} as const

export type Env = typeof env

/**
 * Normalización del origen público.
 *
 * `PUBLIC_ORIGIN` es lo único que se usa para armar el `redirect_uri` que se
 * le manda a Google, y Google exige una URL absoluta: un dominio pelado como
 * `friedict.becode.com.ar` hace que el flujo falle entero con
 * `redirect_uri_mismatch`, sin más pista que esa.
 *
 * Coolify expone las dos formas y son fáciles de confundir:
 *   · `SERVICE_FQDN_APP` = `friedict.becode.com.ar`          (pelado)
 *   · `SERVICE_URL_APP`  = `https://friedict.becode.com.ar`  (con esquema)
 *
 * El compose usa la segunda, pero esta función existe igual: es una variable
 * que se carga a mano en un panel, y el modo de fallar —una pantalla de error
 * de Google, lejos del lugar donde está el error— es demasiado feo como para
 * confiar en que siempre la escriban bien.
 */

/** `localhost` y loopback van por http; cualquier host real, por https. */
function schemeFor(host: string): string {
  const name = host.split(':')[0]?.toLowerCase() ?? ''
  const isLocal = name === 'localhost' || name === '127.0.0.1' || name === '::1'
  return isLocal ? 'http://' : 'https://'
}

/**
 * Devuelve un origen absoluto y sin barra final, o `undefined` si no había
 * nada que normalizar. No inventa dominio: si no hay valor, no hay origen.
 */
export function normalizePublicOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined

  const trimmed = value.trim().replace(/\/+$/, '')
  if (trimmed === '') return undefined

  if (/^https?:\/\//i.test(trimmed)) return trimmed

  // Un esquema que no es http(s) —`ftp://`, `ws://`— no sirve para un
  // redirect_uri de OAuth y taparlo con https sería inventar. Se devuelve tal
  // cual y que falle donde se usa, en vez de fallar disfrazado.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed

  return `${schemeFor(trimmed)}${trimmed}`
}

/**
 * Indexación selectiva por ruta — copia del lado del cliente.
 *
 * Default-deny: cualquier ruta que no esté en esta lista blanca recibe
 * `noindex, nofollow`. El `<meta name="robots">` que arma esta función es
 * apenas un MIRROR: la fuente de la verdad es el header `X-Robots-Tag` que
 * manda `server/src/robots.ts`, que no depende de JS. Los crawlers combinan
 * header y meta tomando la directiva MÁS restrictiva, así que una entrada mal
 * puesta acá nunca puede volver indexable una ruta privada — en el peor caso,
 * deja de mejorar una ruta que sí lo era.
 *
 * La lista tiene que ser EXACTAMENTE la misma que `server/src/robots.ts`
 * (mismo literal, mismo orden): un test de deriva compara los dos archivos
 * como texto — ver `src/lib/indexing.test.ts`.
 */
export const INDEXABLE_PATHS = new Set(['/', '/entrar'])

const NOINDEX = 'noindex, nofollow'
const INDEX = 'index, follow'

/**
 * Normaliza sacando UNA sola barra final (nunca más), sin tocar mayúsculas:
 * `/entrar/` es indexable, `/Entrar` y `/entrar/x` no lo son.
 */
function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }
  return pathname
}

/** El contenido exacto para `<meta name="robots" content="…">`. */
export function robotsFor(pathname: string): string {
  return INDEXABLE_PATHS.has(normalize(pathname)) ? INDEX : NOINDEX
}

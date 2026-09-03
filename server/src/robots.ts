/**
 * Indexación selectiva por ruta.
 *
 * Default-deny: TODA ruta manda `noindex, nofollow` salvo que esté en esta
 * lista blanca. Así una ruta nueva no puede volverse indexable por accidente
 * — hay que sumarla acá a propósito.
 *
 * `src/lib/indexing.ts` mantiene una copia idéntica para el meta del lado del
 * cliente. Las dos copias son deliberadas: el servidor de Express no importa
 * nada de `src/` (paquete y tsconfig separados), así que un import cruzado
 * para dos strings sería un cambio más grande y más riesgoso que la deriva
 * que evita. La deriva entre las dos copias la atrapa un test, no el
 * compilador (ver `src/lib/indexing.test.ts`).
 *
 * Quién manda: el header del servidor es autoritativo y no depende de JS —
 * los crawlers combinan `X-Robots-Tag` y el `<meta name="robots">` tomando la
 * directiva MÁS restrictiva, así que un meta permisivo nunca puede pisar un
 * header que dice `noindex`.
 */
export const INDEXABLE_PATHS = new Set(['/', '/entrar'])

const NOINDEX = 'noindex, nofollow'

/**
 * Normaliza sacando UNA sola barra final (nunca más), sin tocar mayúsculas:
 * `/entrar/` es indexable, pero `/Entrar` y `/entrar/x` no lo son. Ese es el
 * contrato completo, no un prefijo ni un case-fold.
 */
function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }
  return pathname
}

/** El valor exacto de `X-Robots-Tag` para una ruta dada. */
export function robotsFor(pathname: string): string {
  return INDEXABLE_PATHS.has(normalize(pathname)) ? '' : NOINDEX
}

/**
 * Aplica el header a una respuesta de Express, sólo cuando corresponde: para
 * las rutas indexables no se manda ningún `X-Robots-Tag`, en vez de mandar un
 * valor vacío o "index, follow" — ausencia de header es la postura menos
 * sorprendente para un crawler.
 */
export function applyRobotsHeader(res: { setHeader(name: string, value: string): void }, pathname: string): void {
  const value = robotsFor(pathname)
  if (value) res.setHeader('X-Robots-Tag', value)
}

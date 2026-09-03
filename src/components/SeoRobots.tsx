import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { robotsFor } from '@/lib/indexing'

/**
 * Meta `robots` por ruta, del lado del cliente.
 *
 * Es un MIRROR, nunca el control: el header `X-Robots-Tag` del servidor
 * (`server/src/robots.ts`) es autoritativo y no depende de JS. Los crawlers
 * combinan header y meta tomando la directiva MÁS restrictiva, así que una
 * entrada mal puesta acá nunca puede volver indexable una ruta privada — en
 * el peor caso, deja de mejorar una que sí lo era.
 *
 * Se monta una sola vez, DENTRO del Router y arriba de `<Routes>`, así que
 * observa cada navegación de la SPA — incluidos los `<Navigate>` de un
 * redirect — sin tener que montarse en cada pantalla.
 */
export function SeoRobots(): null {
  const { pathname } = useLocation()

  useEffect(() => {
    const content = robotsFor(pathname)
    let tag = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    if (!tag) {
      tag = document.createElement('meta')
      tag.name = 'robots'
      document.head.appendChild(tag)
    }
    tag.content = content
  }, [pathname])

  return null
}

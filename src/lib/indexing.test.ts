import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { robotsFor } from './indexing'

describe('robotsFor (cliente)', () => {
  it('la portada y /entrar son indexables', () => {
    expect(robotsFor('/')).toBe('index, follow')
    expect(robotsFor('/entrar')).toBe('index, follow')
  })

  it('un grupo, un link de invitación y crear-grupo son privados', () => {
    expect(robotsFor('/g/x')).toBe('noindex, nofollow')
    expect(robotsFor('/join/tok')).toBe('noindex, nofollow')
    expect(robotsFor('/crear-grupo')).toBe('noindex, nofollow')
  })

  it('una ruta desconocida es noindex por default-deny', () => {
    expect(robotsFor('/no-existe')).toBe('noindex, nofollow')
  })

  it('una variante con mayúscula NO hace match: sin case-folding', () => {
    expect(robotsFor('/Entrar')).toBe('noindex, nofollow')
  })

  it('una sola barra final normaliza, un sufijo extra no', () => {
    expect(robotsFor('/entrar/')).toBe('index, follow')
    expect(robotsFor('/entrar/extra')).toBe('noindex, nofollow')
  })

  it('la cadena vacía no es indexable', () => {
    expect(robotsFor('')).toBe('noindex, nofollow')
  })
})

/**
 * Deriva servidor/cliente — la misma técnica que ya usa
 * `integration/helpers.ts` con `db/rpc-functions.json`: dos copias
 * DELIBERADAS (el servidor Express no importa nada de `src/`), comparadas
 * como texto para que ningún cambio a una se olvide de la otra.
 */
describe('la lista blanca del cliente y la del servidor no divergen', () => {
  it('mismo literal de INDEXABLE_PATHS en los dos archivos', () => {
    const client = readFileSync(join(process.cwd(), 'src/lib/indexing.ts'), 'utf8')
    const server = readFileSync(join(process.cwd(), 'server/src/robots.ts'), 'utf8')

    const extract = (source: string): string => {
      const match = /INDEXABLE_PATHS\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(source)
      if (!match) throw new Error('No encontré INDEXABLE_PATHS en el archivo')
      return match[1]!.split(',').map((s) => s.trim()).filter(Boolean).sort().join(',')
    }

    expect(extract(client)).toBe(extract(server))
  })
})

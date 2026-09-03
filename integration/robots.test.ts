import { describe, expect, it } from 'vitest'
import { robotsFor } from '../server/src/robots'

/**
 * Indexación selectiva por ruta — el módulo real que corre en producción,
 * ejercitado directamente (sin levantar el servidor HTTP: el comportamiento
 * de los headers en sí es un e2e spec, escrito pero no corrido acá — ver
 * `e2e/indexing.spec.ts`).
 *
 * Default-deny: cualquier ruta que no esté en la lista blanca tiene que
 * devolver `noindex, nofollow`, incluidas las desconocidas.
 */
describe('robotsFor (servidor)', () => {
  it('la portada y el login son indexables: sin X-Robots-Tag', () => {
    expect(robotsFor('/')).toBe('')
    expect(robotsFor('/entrar')).toBe('')
  })

  it('un grupo, un link de invitación y crear grupo son privados', () => {
    expect(robotsFor('/g/x')).toBe('noindex, nofollow')
    expect(robotsFor('/join/tok')).toBe('noindex, nofollow')
    expect(robotsFor('/crear-grupo')).toBe('noindex, nofollow')
  })

  it('un asset estático no es indexable', () => {
    expect(robotsFor('/assets/index-abc123.js')).toBe('noindex, nofollow')
  })

  it('una ruta desconocida es noindex por default-deny', () => {
    expect(robotsFor('/no-existe')).toBe('noindex, nofollow')
  })

  it('una variante con mayúscula NO hace match: sin case-folding', () => {
    expect(robotsFor('/Entrar')).toBe('noindex, nofollow')
  })

  it('una sola barra final sí normaliza, pero un sufijo extra no', () => {
    expect(robotsFor('/entrar/')).toBe('')
    expect(robotsFor('/entrar/x')).toBe('noindex, nofollow')
    expect(robotsFor('/entrarahora')).toBe('noindex, nofollow')
  })
})

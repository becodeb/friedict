import { describe, expect, it } from 'vitest'
import { normalizePublicOrigin } from '../server/src/public-origin'

/**
 * El módulo real que corre en producción, ejercitado directo.
 *
 * Existe por un bug concreto: el compose pasaba `SERVICE_FQDN_APP`, que en
 * Coolify es el dominio PELADO, así que `PUBLIC_ORIGIN` quedaba sin `https://`
 * y el `redirect_uri` que se le mandaba a Google era relativo. Google lo
 * rechazaba, y el error aparecía en una pantalla de Google, lejísimos del
 * lugar donde estaba la causa.
 */
describe('normalizePublicOrigin', () => {
  it('le agrega https a un dominio pelado — el bug que rompía el ingreso con Google', () => {
    expect(normalizePublicOrigin('friedict.becode.com.ar')).toBe(
      'https://friedict.becode.com.ar',
    )
  })

  it('deja intacto un origen que ya viene con esquema', () => {
    expect(normalizePublicOrigin('https://friedict.becode.com.ar')).toBe(
      'https://friedict.becode.com.ar',
    )
    expect(normalizePublicOrigin('http://friedict.becode.com.ar')).toBe(
      'http://friedict.becode.com.ar',
    )
  })

  it('saca la barra final para que el redirect_uri no quede con doble barra', () => {
    expect(normalizePublicOrigin('https://friedict.becode.com.ar/')).toBe(
      'https://friedict.becode.com.ar',
    )
    expect(normalizePublicOrigin('friedict.becode.com.ar///')).toBe(
      'https://friedict.becode.com.ar',
    )
  })

  it('en desarrollo, localhost y loopback van por http', () => {
    expect(normalizePublicOrigin('localhost:8183')).toBe('http://localhost:8183')
    expect(normalizePublicOrigin('127.0.0.1:8183')).toBe('http://127.0.0.1:8183')
  })

  it('sin valor no inventa un origen', () => {
    expect(normalizePublicOrigin(undefined)).toBeUndefined()
    expect(normalizePublicOrigin('')).toBeUndefined()
    expect(normalizePublicOrigin('   ')).toBeUndefined()
  })

  it('no disfraza un esquema que no sirve para OAuth', () => {
    // Taparlo con https sería inventar: mejor que falle donde se usa.
    expect(normalizePublicOrigin('ftp://friedict.becode.com.ar')).toBe(
      'ftp://friedict.becode.com.ar',
    )
  })
})

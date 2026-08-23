import { describe, expect, it } from 'vitest'
import {
  formatCountdown,
  formatCountdownLong,
  fromDateTimeLocalValue,
  nextRoundHour,
  parsePgInterval,
  toDateTimeLocalValue,
  DAY,
  HOUR,
  MINUTE,
} from './time'

describe('parsePgInterval', () => {
  it('entiende los formatos que manda PostgREST', () => {
    expect(parsePgInterval('7 days')).toBe(7 * DAY)
    expect(parsePgInterval('1 day')).toBe(DAY)
    expect(parsePgInterval('01:00:00')).toBe(HOUR)
    expect(parsePgInterval('12:30:00')).toBe(12 * HOUR + 30 * MINUTE)
    expect(parsePgInterval('1 day 12:00:00')).toBe(DAY + 12 * HOUR)
  })

  it('devuelve null cuando no hay intervalo', () => {
    expect(parsePgInterval(null)).toBeNull()
    expect(parsePgInterval(undefined)).toBeNull()
    expect(parsePgInterval('')).toBeNull()
    expect(parsePgInterval('cualquier cosa')).toBeNull()
  })
})

describe('formatCountdown', () => {
  const now = new Date('2026-08-13T12:00:00.000Z')

  it('usa una sola unidad, la más grande que aplique', () => {
    expect(formatCountdown(new Date(now.getTime() + 3 * DAY), now)).toBe('3 d')
    expect(formatCountdown(new Date(now.getTime() + 7 * HOUR), now)).toBe('7 h')
    expect(formatCountdown(new Date(now.getTime() + 34 * MINUTE), now)).toBe('34 min')
  })

  it('nunca muestra 0 min: redondea a 1 hasta que efectivamente venció', () => {
    expect(formatCountdown(new Date(now.getTime() + 20_000), now)).toBe('1 min')
  })

  it('dice «ya» cuando el plazo pasó', () => {
    expect(formatCountdown(new Date(now.getTime() - 1), now)).toBe('ya')
    expect(formatCountdown(now, now)).toBe('ya')
  })

  it('la versión larga concuerda en número y singular/plural', () => {
    expect(formatCountdownLong(new Date(now.getTime() + DAY), now)).toBe('queda 1 día')
    expect(formatCountdownLong(new Date(now.getTime() + 3 * DAY), now)).toBe('quedan 3 días')
    expect(formatCountdownLong(new Date(now.getTime() + HOUR), now)).toBe('queda 1 hora')
    expect(formatCountdownLong(new Date(now.getTime() - HOUR), now)).toBe(
      'el plazo ya venció',
    )
  })
})

describe('zonas horarias', () => {
  it('interpreta correctamente un timestamptz con offset distinto al local', () => {
    // El mismo instante, escrito en tres husos. Las tres cadenas tienen que
    // producir exactamente el mismo momento.
    const utc = new Date('2026-08-13T22:30:00.000Z')
    const buenosAires = new Date('2026-08-13T19:30:00-03:00')
    const tokio = new Date('2026-08-14T07:30:00+09:00')

    expect(buenosAires.getTime()).toBe(utc.getTime())
    expect(tokio.getTime()).toBe(utc.getTime())
  })

  it('un cierre expresado en otro huso se compara bien contra el reloj local', () => {
    // Cierra a las 22:30 de Buenos Aires. Son las 21:00 de Buenos Aires.
    const closesAt = '2026-08-13T22:30:00-03:00'
    const now = new Date('2026-08-14T00:00:00.000Z') // 21:00 en Buenos Aires

    expect(new Date(closesAt).getTime()).toBeGreaterThan(now.getTime())
    expect(formatCountdown(closesAt, now)).toBe('1 h')
  })

  it('un cierre que cruza el cambio de día no adelanta ni atrasa un día', () => {
    // 23:30 en Buenos Aires del 13 = 02:30 UTC del 14.
    const closesAt = '2026-08-13T23:30:00-03:00'
    expect(new Date(closesAt).toISOString()).toBe('2026-08-14T02:30:00.000Z')
  })

  it('el ida y vuelta de datetime-local conserva el instante local', () => {
    const original = new Date(2026, 7, 20, 22, 30, 0, 0) // hora local del dispositivo
    const value = toDateTimeLocalValue(original)

    expect(value).toBe('2026-08-20T22:30')

    const parsed = fromDateTimeLocalValue(value)
    expect(parsed?.getTime()).toBe(original.getTime())
    expect(parsed?.getHours()).toBe(22)
    expect(parsed?.getMinutes()).toBe(30)
  })

  it('rechaza una fecha inválida en vez de devolver un Invalid Date', () => {
    expect(fromDateTimeLocalValue('')).toBeNull()
    expect(fromDateTimeLocalValue('no-es-una-fecha')).toBeNull()
  })
})

describe('nextRoundHour', () => {
  it('cae siempre en punto y en el futuro', () => {
    const from = new Date(2026, 7, 13, 12, 37, 42, 123)
    const result = nextRoundHour(from, 48)

    expect(result.getMinutes()).toBe(0)
    expect(result.getSeconds()).toBe(0)
    expect(result.getMilliseconds()).toBe(0)
    expect(result.getTime()).toBeGreaterThan(from.getTime())
  })
})

/**
 * Tiempo.
 *
 * Regla: el reloj del navegador se usa SÓLO para mostrar y para estimar. Toda
 * decisión que importe (si se puede votar, si expiró, en qué ciclo estamos al
 * momento de guardar) la toma PostgreSQL con `now()` sobre `timestamptz`.
 *
 * Los timestamps llegan de PostgREST en ISO 8601 con offset, así que `new Date()`
 * los interpreta bien en cualquier zona horaria. El formateo usa la zona del
 * dispositivo a propósito: "cierra a las 22:30" tiene que significar las 22:30
 * de quien está mirando.
 */

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * Convierte un `interval` de PostgreSQL a milisegundos.
 * PostgREST lo serializa como texto: "7 days", "01:00:00", "1 day 12:30:00".
 * Meses y años se aproximan (30 y 365 días) porque sólo se usan para estimar
 * el próximo ciclo en pantalla; el ciclo real lo calcula el servidor.
 */
export function parsePgInterval(value: string | null | undefined): number | null {
  if (!value) return null

  let ms = 0
  let matched = false

  const units: Array<[RegExp, number]> = [
    [/(-?\d+)\s+years?/i, 365 * DAY],
    [/(-?\d+)\s+mons?/i, 30 * DAY],
    [/(-?\d+)\s+days?/i, DAY],
  ]
  for (const [re, factor] of units) {
    const m = re.exec(value)
    if (m?.[1]) {
      ms += Number(m[1]) * factor
      matched = true
    }
  }

  const clock = /(-?)(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(value)
  if (clock) {
    const sign = clock[1] === '-' ? -1 : 1
    ms +=
      sign *
      (Number(clock[2]) * HOUR + Number(clock[3]) * MINUTE + Number(clock[4]) * 1000)
    matched = true
  }

  return matched ? ms : null
}

/**
 * Cuenta regresiva corta y legible: "3 d", "7 h", "12 min", "ya".
 * Se queda en una sola unidad a propósito — es un dato de un vistazo, no un
 * cronómetro.
 */
export function formatCountdown(target: string | Date, now: Date = new Date()): string {
  const diff = toDate(target).getTime() - now.getTime()
  if (diff <= 0) return 'ya'

  if (diff >= DAY) {
    const d = Math.floor(diff / DAY)
    return `${d} d`
  }
  if (diff >= HOUR) {
    const h = Math.floor(diff / HOUR)
    return `${h} h`
  }
  const m = Math.max(1, Math.floor(diff / MINUTE))
  return `${m} min`
}

/** Versión larga para lectores de pantalla y tooltips. */
export function formatCountdownLong(
  target: string | Date,
  now: Date = new Date(),
): string {
  const diff = toDate(target).getTime() - now.getTime()
  if (diff <= 0) return 'el plazo ya venció'

  if (diff >= DAY) {
    const d = Math.floor(diff / DAY)
    return d === 1 ? 'queda 1 día' : `quedan ${d} días`
  }
  if (diff >= HOUR) {
    const h = Math.floor(diff / HOUR)
    return h === 1 ? 'queda 1 hora' : `quedan ${h} horas`
  }
  const m = Math.max(1, Math.floor(diff / MINUTE))
  return m === 1 ? 'queda 1 minuto' : `quedan ${m} minutos`
}

const rtf = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' })

/** "hace 3 días", "hace 2 horas". */
export function formatRelative(value: string | Date, now: Date = new Date()): string {
  const diff = toDate(value).getTime() - now.getTime()
  const abs = Math.abs(diff)

  if (abs >= DAY) return rtf.format(Math.round(diff / DAY), 'day')
  if (abs >= HOUR) return rtf.format(Math.round(diff / HOUR), 'hour')
  if (abs >= MINUTE) return rtf.format(Math.round(diff / MINUTE), 'minute')
  return 'recién'
}

const dateTimeFmt = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const dateFmt = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export function formatDateTime(value: string | Date): string {
  return dateTimeFmt.format(toDate(value))
}

export function formatDate(value: string | Date): string {
  return dateFmt.format(toDate(value))
}

/** Para <time dateTime="…">. */
export function isoAttr(value: string | Date): string {
  return toDate(value).toISOString()
}

/**
 * Redondea hacia adelante a la próxima hora en punto. Se usa como valor por
 * defecto del selector de cierre para que nadie tenga que pelear con minutos.
 */
export function nextRoundHour(from: Date = new Date(), hoursAhead = 24): Date {
  const d = new Date(from.getTime() + hoursAhead * HOUR)
  d.setMinutes(0, 0, 0)
  return d
}

/** Formatea una fecha para un <input type="datetime-local"> en hora local. */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/**
 * Lee un <input type="datetime-local">, que no tiene zona horaria, y lo
 * interpreta en la zona del dispositivo. `new Date("2026-08-20T22:30")` ya hace
 * exactamente eso; la función existe para dejarlo explícito y testeable.
 */
export function fromDateTimeLocalValue(value: string): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

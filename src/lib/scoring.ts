/**
 * Cálculo de puntos de friedict.
 *
 * Los puntos son sólo gamificación: no se apuestan, no se pierden, no se
 * compran y no valen plata. Sólo se ganan acertando.
 *
 * ┌─ 100 puntos base por acertar
 * ├─ × rareza      1.00 … 1.80  cuanto menos gente eligió la opción correcta
 * ├─ × anticipación 1.00 … 1.25  cuanto antes la elegiste dentro de la ventana
 * └─ × convicción   0.50 … 1.00  qué parte de tus votos le pusiste a esa opción
 *
 * Techo: 225. Piso de un acierto: 50. Nunca negativo.
 *
 * La rareza necesita una muestra mínima de 4 votos. Sin ese piso, una opción
 * con 1 voto sobre 2 daría un multiplicador alto por puro ruido.
 *
 * ⚠️ Esta función es el espejo exacto de `public.calculate_points()` en
 * supabase/migrations/20260813000200_functions.sql. La autoridad es el SQL —
 * es la que reparte los puntos de verdad. Esta copia sirve para los tests y
 * para explicar el puntaje en la UI. El test de integración `scoring-parity`
 * compara ambas sobre una grilla de casos para que no se separen nunca.
 */

export const BASE_POINTS = 100

/** Muestra mínima para que la rareza empiece a contar. */
export const RARITY_MIN_SAMPLE = 4

export const MAX_RARITY = 1.8
export const MAX_EARLY = 1.25
export const MIN_CONVICTION = 0.5

const clamp01 = (n: number): number => {
  if (Number.isNaN(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * @param winnerShare votos a la opción ganadora / votos totales, en [0,1]
 * @param sampleSize  votos totales al cierre
 */
export function rarityMultiplier(winnerShare: number, sampleSize: number): number {
  if (sampleSize < RARITY_MIN_SAMPLE) return 1
  return Math.min(MAX_RARITY, 1 + (1 - clamp01(winnerShare)) * 0.8)
}

/** @param earlyRatio 1 = votaste apenas abrió, 0 = votaste sobre el cierre. */
export function earlyMultiplier(earlyRatio: number): number {
  return 1 + 0.25 * clamp01(earlyRatio)
}

/** @param convictionRatio votos propios en la ganadora / votos propios totales. */
export function convictionMultiplier(convictionRatio: number): number {
  return MIN_CONVICTION + 0.5 * clamp01(convictionRatio)
}

export interface ScoreInput {
  /** Puntos base. Por defecto 100. */
  base?: number
  winnerShare: number
  sampleSize: number
  earlyRatio: number
  convictionRatio: number
}

export function calculatePoints({
  base = BASE_POINTS,
  winnerShare,
  sampleSize,
  earlyRatio,
  convictionRatio,
}: ScoreInput): number {
  const raw =
    base *
    rarityMultiplier(winnerShare, sampleSize) *
    earlyMultiplier(earlyRatio) *
    convictionMultiplier(convictionRatio)

  // Se recorta el ruido de punto flotante antes de redondear, para que el
  // resultado coincida con la aritmética `numeric` de PostgreSQL.
  const trimmed = Math.round(raw * 1e6) / 1e6
  return Math.max(0, Math.round(trimmed))
}

/** Desglose para mostrarle a la persona por qué sacó esos puntos. */
export interface ScoreBreakdown {
  base: number
  rarity: number
  early: number
  conviction: number
  total: number
}

export function explainScore(input: ScoreInput): ScoreBreakdown {
  const base = input.base ?? BASE_POINTS
  return {
    base,
    rarity: rarityMultiplier(input.winnerShare, input.sampleSize),
    early: earlyMultiplier(input.earlyRatio),
    conviction: convictionMultiplier(input.convictionRatio),
    total: calculatePoints(input),
  }
}

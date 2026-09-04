/**
 * Cálculo de puntos de friedict.
 *
 * Los puntos son sólo gamificación: no se apuestan, no se pierden, no se
 * compran y no valen plata. Sólo se ganan acertando.
 *
 * ┌─ base × duración   1.00 … 3.00  cuánto duró REALMENTE la predicción
 * ├─ × rareza      1.00 … 1.80  cuanto menos gente eligió la opción correcta
 * ├─ × anticipación 1.00 … 1.25  cuanto antes la elegiste dentro de la ventana
 * └─ × convicción   0.50 … 1.00  qué parte de tus votos le pusiste a esa opción
 *
 * Techo a la base de 100: 225 (`calculatePoints` sin `durationDays`). Techo
 * real, con la duración en su tope de 3×: 675. Piso de un acierto: 50 (a
 * base 100). Nunca negativo.
 *
 * La rareza necesita una muestra mínima de 4 votos. Sin ese piso, una opción
 * con 1 voto sobre 2 daría un multiplicador alto por puro ruido.
 *
 * ⚠️ `calculatePoints` es el espejo exacto de `public.calculate_points()` en
 * `db/migrations/200_functions.sql` — la autoridad es el SQL, es la que
 * reparte los puntos de verdad, y NO cambia con la duración: recibe la base
 * ya escalada como parámetro. `durationMultiplier` es el espejo de
 * `public.duration_multiplier()` en `db/migrations/705_vote_window_and_scoring.sql`,
 * una función aparte a propósito — ver design.md § E. El test de integración
 * `scoring-parity` compara las dos parejas sobre sendas grillas de casos para
 * que no se separen nunca.
 */

export const BASE_POINTS = 100

/** Techo del multiplicador de duración: ~un año satura la curva. */
export const MAX_DURATION = 3

/**
 * Curva logarítmica de 1.00× (≤1 día) a `MAX_DURATION`× (techo), sobre
 * cuánto duró REALMENTE la predicción (`closed_at`/`resolved_at` − `opens_at`).
 * Espejo de `public.duration_multiplier(interval)`: recibe días en vez de un
 * interval, y recorta el ruido de punto flotante antes de redondear a dos
 * decimales, igual que `calculatePoints` ya hace más abajo.
 */
export function durationMultiplier(days: number): number {
  const d = Number.isFinite(days) ? Math.max(1, days) : 1
  const raw = Math.min(MAX_DURATION, Math.max(1, 1 + 0.75 * Math.log10(d)))
  const trimmed = Math.round(raw * 1e6) / 1e6
  return Math.round(trimmed * 100) / 100
}

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
  /**
   * Cuánto duró REALMENTE la predicción, en días. `undefined` = sin
   * multiplicador de duración (equivale a 1.00×) — así `calculatePoints`
   * sigue exactamente igual para todo caller que no lo mande, incluida la
   * grilla de paridad con SQL.
   */
  durationDays?: number
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
  /** 1.00 cuando no se mandó `durationDays` — sin efecto sobre `total`. */
  duration: number
  total: number
}

export function explainScore(input: ScoreInput): ScoreBreakdown {
  const base = input.base ?? BASE_POINTS
  const duration = input.durationDays === undefined ? 1 : durationMultiplier(input.durationDays)
  // La base que de verdad reparte los puntos ya viene escalada — el mismo
  // orden de operaciones que `score_prediction()`: escalar primero,
  // calculate_points() después, sin tocar su fórmula.
  const scaledBase = Math.round(base * duration)

  return {
    base,
    rarity: rarityMultiplier(input.winnerShare, input.sampleSize),
    early: earlyMultiplier(input.earlyRatio),
    conviction: convictionMultiplier(input.convictionRatio),
    duration,
    total: calculatePoints({ ...input, base: scaledBase }),
  }
}

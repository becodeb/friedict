/** Lee un token de motion del :root y lo devuelve en milisegundos. */
export function cssMs(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!raw) return fallback

  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return fallback
  return raw.endsWith('ms') ? value : raw.endsWith('s') ? value * 1000 : value
}

/** Lee un token numérico del :root (sin unidad o en px). */
export function cssNumber(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  )
  return Number.isFinite(value) ? value : fallback
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

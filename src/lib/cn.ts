type ClassValue = string | number | false | null | undefined | ClassValue[]

/** Concatena clases ignorando falsy. Suficiente para este proyecto. */
export function cn(...values: ClassValue[]): string {
  const out: string[] = []
  const walk = (v: ClassValue): void => {
    if (!v && v !== 0) return
    if (Array.isArray(v)) {
      v.forEach(walk)
      return
    }
    out.push(String(v))
  }
  values.forEach(walk)
  return out.join(' ')
}

/** Iniciales para el avatar. Nunca más de dos caracteres. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase()
  return `${(parts[0] ?? '')[0] ?? ''}${(parts[1] ?? '')[0] ?? ''}`.toUpperCase()
}

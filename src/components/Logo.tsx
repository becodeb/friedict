import { cn } from '@/lib/cn'

/**
 * Marca.
 *
 * "Cantado" es lo que se dice en el Río de la Plata cuando algo era
 * absolutamente previsible: *estaba cantado que llegaba tarde*. Es exactamente
 * lo que hace la app, y funciona además como reacción cuando se resuelve una
 * predicción.
 *
 * El logotipo es la palabra en minúscula con un punto en acento. Nada de
 * isotipos genéricos ni SVG improvisados.
 */
export function Logo({
  className,
  size = 'md',
}: {
  className?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <span
      className={cn(
        'inline-flex select-none items-baseline font-semibold tracking-[-0.045em]',
        size === 'sm' && 'text-[1.0625rem]',
        size === 'md' && 'text-[1.375rem]',
        size === 'lg' && 'text-[2rem]',
        className,
      )}
    >
      cantado
      <span className="text-[var(--accent)]">.</span>
    </span>
  )
}

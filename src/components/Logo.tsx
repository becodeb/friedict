import { cn } from '@/lib/cn'

/**
 * Marca.
 *
 * «friedict» es friends + predict: predicciones entre amigos. El logotipo es
 * la palabra en Bricolage Grotesque, pesada y apretada, con un sticker redondo
 * de chicle al final: la misma bolita con contorno que marca tu voto en las
 * opciones. Nada de isotipos genéricos ni SVG improvisados.
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
        'inline-flex select-none items-center gap-[0.18em] font-display font-extrabold tracking-[-0.045em]',
        size === 'sm' && 'text-[1.125rem]',
        size === 'md' && 'text-[1.5rem]',
        size === 'lg' && 'text-[2.25rem]',
        className,
      )}
    >
      friedict
      <span
        aria-hidden="true"
        className="mt-[0.2em] inline-block size-[0.4em] rounded-full border-[0.09em] border-[var(--line-strong)] bg-[var(--accent)]"
      />
    </span>
  )
}

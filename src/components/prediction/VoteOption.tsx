import { cn } from '@/lib/cn'
import type { OptionWithTally } from '@/lib/types'

/**
 * Una opción votable.
 *
 * Marca de selección: transitions-dev-react-css/checkbox-check/checkbox-check.txt
 * — el tilde se DIBUJA con stroke-dashoffset en lugar de aparecer. Es la
 * diferencia entre "se marcó algo" y "elegiste esto".
 *
 * Cuando los resultados son visibles, la proporción se muestra como una barra
 * de fondo dentro de la propia fila. No hace falta un gráfico aparte: la fila
 * ES el gráfico.
 *
 * Semántica: `role="radio"` dentro de un `radiogroup`. Se elige una sola opción
 * y las flechas del teclado recorren el grupo.
 */
export function VoteOption({
  option,
  selected,
  disabled,
  showResults,
  totalVotes,
  isWinner,
  pending,
  onSelect,
}: {
  option: OptionWithTally
  selected: boolean
  disabled: boolean
  showResults: boolean
  totalVotes: number
  isWinner?: boolean
  pending?: boolean
  onSelect: () => void
}) {
  const count = option.tally?.voteCount ?? 0
  const share = showResults && totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      data-checked={selected}
      className={cn(
        't-check group relative flex min-h-[48px] w-full items-center gap-3',
        'overflow-hidden rounded-[var(--r-sm)] border px-3 py-2 text-left',
        'motion-reduce:transition-none',
        selected
          ? 'border-[var(--accent)] bg-[var(--accent-wash)]'
          : 'border-[var(--line-strong)] bg-[var(--surface)]',
        !disabled && !selected && 'hover:border-[var(--ink-3)] hover:bg-[var(--surface-2)]',
        !disabled && 'active:translate-y-px motion-reduce:active:translate-y-0',
        disabled && 'cursor-not-allowed',
        disabled && !selected && 'opacity-70',
        isWinner && 'border-[var(--status-resolved)] bg-[var(--status-resolved-wash)]',
        pending && 'opacity-80',
      )}
    >
      {/* Barra de proporción: una línea de 3px apoyada en el borde inferior.
          Rellenar la fila entera se leía como un estado de selección — un 13%
          quedaba como un manchón gris detrás del indicador. Como línea, es
          evidentemente un dato y se compara igual de bien entre filas. */}
      {showResults && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[3px]"
        >
          <span
            className={cn(
              'block h-full',
              'transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-standard)]',
              'motion-reduce:transition-none',
              isWinner
                ? 'bg-[var(--status-resolved)]'
                : selected
                  ? 'bg-[var(--accent)]'
                  : 'bg-[var(--line-strong)]',
            )}
            style={{ width: `${share}%` }}
          />
        </span>
      )}

      {/* Indicador de elección: círculo + tilde dibujado. */}
      <span
        aria-hidden="true"
        className={cn(
          'relative z-10 grid size-5 shrink-0 place-items-center rounded-full border-2',
          'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
          selected
            ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
            : 'border-[var(--line-strong)] text-transparent',
          isWinner && 'border-[var(--status-resolved)] bg-[var(--status-resolved)] text-white',
        )}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path
            d="M3.5 8.5l3 3 6-6.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      <span
        className={cn(
          'relative z-10 min-w-0 flex-1 text-[0.9375rem] leading-snug',
          selected && 'font-medium',
          'text-[var(--ink)]',
        )}
      >
        {option.label}
        {isWinner && (
          <span className="ml-2 type-meta text-[var(--status-resolved)]">
            pasó
          </span>
        )}
      </span>

      {showResults && (
        <span className="relative z-10 flex shrink-0 items-baseline gap-1.5">
          <span className="type-meta tabular text-[var(--ink-2)]">{share}%</span>
          <span className="type-micro tabular text-[var(--ink-3)]">({count})</span>
        </span>
      )}
    </button>
  )
}

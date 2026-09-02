import { cn } from '@/lib/cn'
import type { OptionWithTally } from '@/lib/types'

/**
 * Una opción votable: una píldora con contorno de tinta.
 *
 * Marca de selección: transitions-dev-react-css/checkbox-check/checkbox-check.txt
 * — el tilde se DIBUJA con stroke-dashoffset en lugar de aparecer. Es la
 * diferencia entre "se marcó algo" y "elegiste esto".
 *
 * La píldora elegida se rellena de chicle y se levanta sobre su sombra dura;
 * la que pasó, de lima. Cuando los resultados son visibles, la proporción se
 * pinta como un relleno de cielo que crece desde la izquierda dentro de la
 * propia píldora: la fila ES el gráfico.
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
  const filled = selected || Boolean(isWinner)

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      data-checked={selected}
      className={cn(
        't-check opt-pill group',
        'transition-[background-color,transform,box-shadow] duration-[var(--motion-fast)]',
        'ease-[var(--ease-standard)] motion-reduce:transition-none',
        selected && 'bg-[var(--accent)] shadow-[var(--shadow-1)]',
        isWinner && 'bg-[var(--status-resolved-wash)] shadow-[var(--shadow-1)]',
        !disabled && !filled && 'hover:bg-[var(--surface-2)]',
        !disabled &&
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ' +
            'motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0',
        disabled && 'cursor-not-allowed',
        disabled && !filled && 'opacity-70',
        pending && 'opacity-80',
      )}
    >
      {/* Proporción: relleno que crece desde la izquierda. Sobre la píldora
          elegida o ganadora va en tinta translúcida para no pelear con el
          chicle o la lima; sobre las demás, en cielo. */}
      {showResults && (
        <span aria-hidden="true" className="absolute inset-y-0 left-0 z-0 w-full">
          <span
            className={cn(
              'block h-full rounded-r-[var(--r-pill)]',
              'transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-standard)]',
              'motion-reduce:transition-none',
              filled ? 'bg-[var(--ink)] opacity-[0.12]' : 'bg-[var(--status-closed)] opacity-55',
            )}
            style={{ width: `${share}%` }}
          />
        </span>
      )}

      {/* Indicador de elección: círculo + tilde dibujado. */}
      <span
        aria-hidden="true"
        className={cn(
          'relative z-10 grid size-[18px] shrink-0 place-items-center rounded-full border-2',
          'border-[var(--line-strong)]',
          'transition-colors duration-[var(--motion-fast)] motion-reduce:transition-none',
          filled ? 'bg-[var(--ink)] text-[var(--bg)]' : 'bg-transparent text-transparent',
        )}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
          <path
            d="M3.5 8.5l3 3 6-6.5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>

      <span
        className={cn(
          'relative z-10 min-w-0 flex-1 text-[0.9375rem] leading-snug',
          filled ? 'font-semibold text-[var(--on-candy)]' : 'font-medium text-[var(--ink)]',
        )}
      >
        {option.label}
        {isWinner && (
          <span className="ml-2 type-meta text-[var(--on-candy)] opacity-80">pasó</span>
        )}
      </span>

      {showResults && (
        <span
          className={cn(
            'relative z-10 flex shrink-0 items-baseline gap-1.5',
            filled ? 'text-[var(--on-candy)]' : 'text-[var(--ink)]',
          )}
        >
          <span className="font-display text-[1.0625rem] font-extrabold tracking-[-0.02em] tabular">
            {share}%
          </span>
          <span className="type-micro tabular opacity-70">({count})</span>
        </span>
      )}
    </button>
  )
}

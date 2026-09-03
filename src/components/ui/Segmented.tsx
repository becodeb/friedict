import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  description?: string
}

/**
 * Grupo de radios presentado como segmentos. Se usa un `<fieldset>` con radios
 * reales en vez de botones con `aria-pressed`: así las flechas del teclado
 * navegan el grupo sin escribir una sola línea de JS.
 *
 * Cada segmento es una tarjetita con contorno; la elegida se rellena de chicle
 * y se levanta sobre su sombra.
 */
export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  columns = 2,
  help,
}: {
  legend: string
  options: SegmentedOption<T>[]
  value: T
  onChange: (next: T) => void
  columns?: 1 | 2 | 3
  /** `<HelpTip>` u otro disparador de ayuda, mostrado junto al legend. */
  help?: ReactNode
}) {
  const name = useId()

  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-1.5 flex items-center gap-1.5 text-[0.8125rem] font-semibold text-[var(--ink-2)]">
        {legend}
        {help}
      </legend>
      <div
        className={cn(
          'grid gap-2',
          columns === 1 && 'grid-cols-1',
          columns === 2 && 'grid-cols-2',
          columns === 3 && 'grid-cols-3',
        )}
      >
        {options.map((option) => {
          const selected = option.value === value
          return (
            <label
              key={option.value}
              className={cn(
                'relative flex min-h-[var(--tap)] cursor-pointer flex-col justify-center',
                'rounded-[var(--r-md)] border-2 border-[var(--line-strong)] px-3 py-2',
                'transition-[background-color,box-shadow,transform] duration-[var(--motion-fast)]',
                'ease-[var(--ease-standard)] motion-reduce:transition-none',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                'has-[:focus-visible]:outline-[var(--ink)]',
                selected
                  ? 'bg-[var(--accent)] text-[var(--on-candy)] shadow-[var(--shadow-1)]'
                  : 'bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)]',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span className="text-[0.875rem] font-semibold">{option.label}</span>
              {option.description && (
                <span
                  className={cn(
                    'mt-0.5 type-micro',
                    selected ? 'opacity-80' : 'text-[var(--ink-3)]',
                  )}
                >
                  {option.description}
                </span>
              )}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

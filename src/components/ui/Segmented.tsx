import { useId } from 'react'
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
 */
export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  columns = 2,
}: {
  legend: string
  options: SegmentedOption<T>[]
  value: T
  onChange: (next: T) => void
  columns?: 1 | 2 | 3
}) {
  const name = useId()

  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-1.5 text-[0.8125rem] font-medium text-[var(--ink-2)]">
        {legend}
      </legend>
      <div
        className={cn(
          'grid gap-1.5',
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
                'rounded-[var(--r-sm)] border px-3 py-2',
                'transition-[border-color,background-color] duration-[var(--motion-fast)]',
                'ease-[var(--ease-standard)] motion-reduce:transition-none',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                'has-[:focus-visible]:outline-[var(--accent)]',
                selected
                  ? 'border-[var(--accent)] bg-[var(--accent-wash)]'
                  : 'border-[var(--line-strong)] hover:border-[var(--ink-3)]',
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
              <span
                className={cn(
                  'text-[0.875rem] font-medium',
                  selected ? 'text-[var(--accent-ink)]' : 'text-[var(--ink)]',
                )}
              >
                {option.label}
              </span>
              {option.description && (
                <span className="mt-0.5 type-micro text-[var(--ink-3)]">
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

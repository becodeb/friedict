import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * transitions-dev-react-css/toggle/toggle.txt
 *
 * El thumb viaja con un overshoot de 1px al 55% del recorrido, que es lo que le
 * da la sensación física. `.is-init` se agrega recién después del primer render
 * para que un toggle que arranca encendido no se anime al montar.
 *
 * La pista tiene contorno de tinta y se rellena de chicle al encender; el
 * thumb es una bolita de tinta.
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  const [initialised, setInitialised] = useState(false)
  const mounted = useRef(false)

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    setInitialised(true)
  }, [checked])

  return (
    <label
      className={cn(
        'flex min-h-[var(--tap)] cursor-pointer items-center justify-between gap-4 py-1',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="min-w-0">
        <span className="block text-[0.9375rem] font-medium text-[var(--ink)]">{label}</span>
        {description && (
          <span className="mt-0.5 block type-micro text-[var(--ink-3)]">
            {description}
          </span>
        )}
      </span>

      <span className="relative shrink-0">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 size-full cursor-pointer opacity-0"
        />
        <span
          data-on={checked}
          className={cn(
            't-toggle block h-[28px] w-[50px] rounded-full border-2 border-[var(--line-strong)] p-[2px]',
            'transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)]',
            'motion-reduce:transition-none',
            'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
            'peer-focus-visible:outline-[var(--ink)]',
            checked ? 'bg-[var(--accent)]' : 'bg-[var(--surface)]',
            initialised && 'is-init',
          )}
          aria-hidden="true"
        >
          <span className="t-toggle-thumb block size-5 rounded-full bg-[var(--ink)]" />
        </span>
      </span>
    </label>
  )
}

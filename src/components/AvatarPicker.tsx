import { useId } from 'react'
import { cn, initials } from '@/lib/cn'

/**
 * Elección de color de avatar. Ocho opciones, cero subida de fotos.
 *
 * Es un `radiogroup` real, así que las flechas del teclado funcionan solas y
 * cada color tiene nombre accesible: el color nunca es el único identificador.
 */
const COLOR_NAMES = [
  'tomate',
  'verde',
  'azul',
  'mostaza',
  'magenta',
  'celeste',
  'naranja',
  'violeta',
] as const

export function AvatarPicker({
  value,
  onChange,
  name,
}: {
  value: number
  onChange: (next: number) => void
  name: string
}) {
  const groupName = useId()
  const preview = initials(name || '?')

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-full text-base font-semibold uppercase text-white"
          style={{ background: `var(--avatar-${value})` }}
          aria-hidden="true"
        >
          {preview.slice(0, 2)}
        </span>
        <span className="text-[0.8125rem] text-[var(--ink-2)]">
          Así te van a ver en el grupo.
        </span>
      </div>

      <fieldset className="border-0 p-0">
        <legend className="mb-1.5 text-[0.8125rem] font-medium text-[var(--ink-2)]">
          Tu color
        </legend>
        <div className="flex flex-wrap gap-1">
          {COLOR_NAMES.map((colorName, index) => {
            const selected = index === value
            return (
              <label
                key={colorName}
                className={cn(
                  'relative grid size-[var(--tap)] cursor-pointer place-items-center rounded-full',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                  'has-[:focus-visible]:outline-[var(--accent)]',
                )}
              >
                {/* Transparente y del tamaño completo, no `sr-only`: así el
                    área que recibe el toque son los 44px del label y no un
                    punto de 1px en una esquina. */}
                <input
                  type="radio"
                  name={groupName}
                  value={index}
                  checked={selected}
                  onChange={() => onChange(index)}
                  aria-label={colorName}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
                <span
                  className={cn(
                    // `pointer-events-none`: la muestra de color se pinta encima
                    // del input transparente, y sin esto sería ella la que
                    // recibiría el toque en lugar del control real.
                    'pointer-events-none block size-7 rounded-full',
                    'transition-transform duration-[var(--motion-base)]',
                    'ease-[var(--ease-emphasized)] motion-reduce:transition-none',
                    selected
                      ? 'scale-100 ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--bg)]'
                      : 'scale-90 hover:scale-100',
                  )}
                  style={{ background: `var(--avatar-${index})` }}
                  aria-hidden="true"
                />
              </label>
            )
          })}
        </div>
      </fieldset>
    </div>
  )
}

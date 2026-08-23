import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/cn'
import { cssMs } from '@/lib/css'

/**
 * transitions-dev-react-css/error-state-shake/error-state-shake.txt
 *
 * Cuando aparece un error, el campo se sacude una vez y el mensaje se revela.
 * La receta original repite la animación desde una base limpia (quitar clase,
 * reflow, volver a ponerla) y limpia su propio timeout, que es exactamente lo
 * que hace el efecto de abajo.
 *
 * El ancho del borde no cambia entre estados: si cambiara, el contenido interno
 * se movería un pixel al aparecer el error.
 */
function useShakeOnError(error: string | undefined) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node || !error) return

    node.classList.remove('is-shaking')
    void node.offsetWidth // reflow: reinicia la animación
    node.classList.add('is-shaking')

    const total = cssMs('--shake-dur-a', 80) * 2 + cssMs('--shake-dur-b', 60) * 2
    const timer = window.setTimeout(() => node.classList.remove('is-shaking'), total + 20)
    return () => window.clearTimeout(timer)
  }, [error])

  return ref
}

const CONTROL_BASE = cn(
  't-input w-full rounded-[var(--r-sm)] border bg-[var(--surface)]',
  'px-3.5 py-3 text-[0.9375rem] text-[var(--ink)]',
  'placeholder:text-[var(--ink-3)]',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
  'disabled:cursor-not-allowed disabled:bg-[var(--surface-2)] disabled:text-[var(--ink-3)]',
)

interface FieldShellProps {
  label: string
  hint?: string
  error?: string | undefined
  /** Etiqueta visible sólo para lectores de pantalla. */
  hideLabel?: boolean
  children: (ids: { inputId: string; describedBy: string | undefined }) => ReactNode
  trailing?: ReactNode
}

export function FieldShell({
  label,
  hint,
  error,
  hideLabel,
  children,
  trailing,
}: FieldShellProps) {
  const inputId = useId()
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label
          htmlFor={inputId}
          className={cn(
            'text-[0.8125rem] font-medium text-[var(--ink-2)]',
            hideLabel && 'sr-only',
          )}
        >
          {label}
        </label>
        {trailing}
      </div>

      {children({ inputId, describedBy: describedBy || undefined })}

      {hint && !error && (
        <p id={hintId} className="mt-1.5 type-micro text-[var(--ink-3)]">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={errorId}
          className="mt-1.5 type-micro font-medium text-[var(--danger)]"
        >
          {error}
        </p>
      )}
    </div>
  )
}

export interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  hint?: string
  error?: string | undefined
  hideLabel?: boolean
  trailing?: ReactNode
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField({ label, hint, error, hideLabel, trailing, className, ...rest }, ref) {
    const shakeRef = useShakeOnError(error)

    return (
      <FieldShell
        label={label}
        hint={hint}
        error={error}
        hideLabel={hideLabel}
        trailing={trailing}
      >
        {({ inputId, describedBy }) => (
          <input
            {...rest}
            id={inputId}
            ref={(node) => {
              ;(shakeRef as React.MutableRefObject<HTMLElement | null>).current = node
              if (typeof ref === 'function') ref(node)
              else if (ref) ref.current = node
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(
              CONTROL_BASE,
              error
                ? 'border-[var(--danger)]'
                : 'border-[var(--line-strong)] hover:border-[var(--ink-3)]',
              className,
            )}
          />
        )}
      </FieldShell>
    )
  },
)

export interface TextAreaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string
  hint?: string
  error?: string | undefined
  trailing?: ReactNode
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField({ label, hint, error, trailing, className, ...rest }, ref) {
    const shakeRef = useShakeOnError(error)

    return (
      <FieldShell label={label} hint={hint} error={error} trailing={trailing}>
        {({ inputId, describedBy }) => (
          <textarea
            {...rest}
            id={inputId}
            ref={(node) => {
              ;(shakeRef as React.MutableRefObject<HTMLElement | null>).current = node
              if (typeof ref === 'function') ref(node)
              else if (ref) ref.current = node
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(
              CONTROL_BASE,
              'min-h-[5.5rem] resize-y',
              error
                ? 'border-[var(--danger)]'
                : 'border-[var(--line-strong)] hover:border-[var(--ink-3)]',
              className,
            )}
          />
        )}
      </FieldShell>
    )
  },
)

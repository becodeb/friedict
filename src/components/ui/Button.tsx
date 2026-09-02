import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Spinner } from './Spinner'
import { SuccessCheck } from './SuccessCheck'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  /** Muestra el check de "listo" en lugar del contenido, por unos instantes. */
  succeeded?: boolean
  block?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

/**
 * Botón: píldora con contorno de tinta y sombra dura. Al apretarlo se hunde
 * sobre su sombra (se desplaza 2px y la sombra desaparece), que es lo que lo
 * hace sentir impreso y no dibujado.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'border-[var(--line-strong)] bg-[var(--accent)] text-[var(--on-candy)] shadow-[var(--shadow-2)] ' +
    'hover:bg-[var(--accent-hover)] ' +
    'disabled:border-[var(--line)] disabled:bg-[var(--bg-sunken)] disabled:text-[var(--ink-3)] disabled:shadow-none',
  secondary:
    'border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-2)] ' +
    'hover:bg-[var(--surface-2)] ' +
    'disabled:border-[var(--line)] disabled:text-[var(--ink-3)] disabled:shadow-none',
  ghost:
    'border-transparent bg-transparent text-[var(--ink-2)] ' +
    'hover:bg-[var(--bg-sunken)] hover:text-[var(--ink)] disabled:text-[var(--ink-3)]',
  danger:
    'border-[var(--line-strong)] bg-[var(--surface)] text-[var(--danger)] shadow-[var(--shadow-2)] ' +
    'hover:bg-[var(--danger-wash)] disabled:border-[var(--line)] disabled:shadow-none',
}

// Todos los tamaños respetan el objetivo táctil de 44px: `sm` compensa con
// padding vertical aunque el texto sea chico.
const SIZES: Record<Size, string> = {
  sm: 'min-h-[var(--tap)] px-3.5 text-[0.8125rem] gap-1.5',
  md: 'min-h-[var(--tap)] px-4.5 text-[0.9375rem] gap-2',
  lg: 'min-h-[52px] px-6 text-base gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    succeeded = false,
    block = false,
    iconLeft,
    iconRight,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isBusy = loading || succeeded
  const pressable = variant !== 'ghost'

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex items-center justify-center rounded-[var(--r-pill)] border-2',
        'font-semibold tracking-[-0.01em] select-none',
        'transition-[background-color,border-color,color,transform,box-shadow]',
        'duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        pressable &&
          'active:translate-x-[2px] active:translate-y-[2px] active:shadow-none',
        'disabled:cursor-not-allowed disabled:active:translate-x-0 disabled:active:translate-y-0',
        'motion-reduce:transition-none motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {/* El contenido se atenúa en lugar de desmontarse: el ancho del botón no
          cambia y no salta el layout. */}
      <span
        className={cn(
          'inline-flex items-center justify-center gap-[inherit]',
          'transition-opacity duration-[var(--motion-fast)] motion-reduce:transition-none',
          isBusy && 'opacity-0',
        )}
      >
        {iconLeft}
        {children}
        {iconRight}
      </span>

      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner />
        </span>
      )}
      {succeeded && !loading && (
        <span className="absolute inset-0 grid place-items-center">
          <SuccessCheck show />
        </span>
      )}
    </button>
  )
})

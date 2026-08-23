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

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] ' +
    'active:translate-y-px disabled:bg-[var(--line-strong)] disabled:text-[var(--ink-3)]',
  secondary:
    'bg-[var(--surface)] text-[var(--ink)] border border-[var(--line-strong)] ' +
    'hover:border-[var(--ink-3)] hover:bg-[var(--surface-2)] active:translate-y-px ' +
    'disabled:text-[var(--ink-3)] disabled:border-[var(--line)]',
  ghost:
    'bg-transparent text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] ' +
    'active:translate-y-px disabled:text-[var(--ink-3)]',
  danger:
    'bg-transparent text-[var(--danger)] border border-[var(--line-strong)] ' +
    'hover:bg-[var(--danger-wash)] hover:border-[var(--danger)] active:translate-y-px',
}

// Todos los tamaños respetan el objetivo táctil de 44px: `sm` compensa con
// padding vertical aunque el texto sea chico.
const SIZES: Record<Size, string> = {
  sm: 'min-h-[var(--tap)] px-3 text-[0.8125rem] gap-1.5',
  md: 'min-h-[var(--tap)] px-4 text-[0.9375rem] gap-2',
  lg: 'min-h-[52px] px-5 text-base gap-2',
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

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex items-center justify-center rounded-[var(--r-sm)]',
        'font-medium tracking-[-0.01em] select-none',
        'transition-[background-color,border-color,color,transform,box-shadow]',
        'duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        'disabled:cursor-not-allowed disabled:active:translate-y-0',
        'motion-reduce:transition-none motion-reduce:active:translate-y-0',
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

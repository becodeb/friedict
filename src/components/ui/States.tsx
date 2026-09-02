import type { ReactNode } from 'react'
import { ArrowClockwise, WifiSlash } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import { Button } from './Button'
import { Reveal, RevealLine } from './Reveal'

/**
 * Estados vacíos, de error y sin conexión.
 *
 * Nada de un icono gigante y una frase triste: el estado vacío tiene un título
 * con carácter, una acción principal clara y, cuando corresponde, contenido
 * sugerido debajo. La entrada usa `texts-reveal`.
 */
export function EmptyState({
  title,
  body,
  action,
  children,
}: {
  title: string
  body?: string
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="py-10">
      <Reveal>
        <RevealLine as="h2" index={1} className="type-title max-w-[18ch]">
          {title}
        </RevealLine>
        {body && (
          <RevealLine
            as="p"
            index={2}
            className="mt-3 max-w-[36ch] text-[var(--ink-2)]"
          >
            {body}
          </RevealLine>
        )}
        {action && (
          <RevealLine index={3} className="mt-5">
            {action}
          </RevealLine>
        )}
      </Reveal>
      {children}
    </div>
  )
}

export function ErrorState({
  title = 'No pudimos cargar esto',
  body = 'Puede ser un problema de conexión. Probá de nuevo.',
  onRetry,
}: {
  title?: string
  body?: string
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="card-pop px-5 py-6">
      <h2 className="type-title text-[1.25rem]">{title}</h2>
      <p className="mt-2 text-[0.9375rem] text-[var(--ink-2)]">{body}</p>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={onRetry}
          iconLeft={<ArrowClockwise size={16} weight="bold" />}
        >
          Probar otra vez
        </Button>
      )}
    </div>
  )
}

export function OfflineBanner() {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center justify-center gap-2 border-b-2 border-[var(--line-strong)]',
        'bg-[var(--status-testing)] px-4 py-2 type-micro font-semibold text-[var(--on-candy)]',
      )}
    >
      <WifiSlash size={14} weight="bold" aria-hidden="true" />
      Sin conexión. Vas a poder votar cuando vuelva.
    </div>
  )
}

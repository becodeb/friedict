import { cn } from '@/lib/cn'

/**
 * transitions-dev-react-css/skeleton-reveal/skeleton-reveal.txt
 *
 * El pulso va sobre los hijos, no sobre el contenedor, para que la opacidad del
 * contenedor quede libre para el cross-fade de entrada del contenido real.
 *
 * Las geometrías replican las del componente real. Un esqueleto que no coincide
 * produce exactamente el salto de layout que venía a evitar.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      className={cn('block rounded-[var(--r-xs)] bg-[var(--surface-2)]', className)}
    />
  )
}

export function SkeletonPredictionCard() {
  return (
    <li
      className="relative border-t border-[var(--line)] py-5 pl-4"
      aria-hidden="true"
    >
      <div className="t-skel-pulse space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-5 w-[85%]" />
        <Skeleton className="h-5 w-[60%]" />
        <div className="space-y-2 pt-1.5">
          <Skeleton className="h-11 w-full rounded-[var(--r-sm)]" />
          <Skeleton className="h-11 w-full rounded-[var(--r-sm)]" />
          <Skeleton className="h-11 w-[92%] rounded-[var(--r-sm)]" />
        </div>
      </div>
    </li>
  )
}

export function SkeletonFeed({ count = 3 }: { count?: number }) {
  return (
    <ul aria-busy="true" aria-label="Cargando predicciones">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonPredictionCard key={i} />
      ))}
    </ul>
  )
}

export function SkeletonLeaderboard({ count = 5 }: { count?: number }) {
  return (
    <ul aria-busy="true" aria-label="Cargando ranking" className="t-skel-pulse">
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="flex min-h-[64px] items-center gap-3 border-t border-[var(--line)] px-1"
        >
          <Skeleton className="size-5 w-6" />
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <Skeleton className="h-4 flex-1 max-w-[9rem]" />
          <Skeleton className="h-5 w-12" />
        </li>
      ))}
    </ul>
  )
}

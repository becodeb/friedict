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
      className={cn('block rounded-[var(--r-sm)] bg-[var(--bg-sunken)]', className)}
    />
  )
}

export function SkeletonPredictionCard() {
  return (
    <li className="card-pop relative mt-7 px-4 pb-4 pt-6 sm:px-5" aria-hidden="true">
      <div className="t-skel-pulse space-y-3">
        <Skeleton className="absolute -top-[15px] left-4 h-[26px] w-24 rounded-[var(--r-pill)]" />
        <Skeleton className="h-6 w-[85%]" />
        <Skeleton className="h-6 w-[60%]" />
        <div className="space-y-2 pt-2">
          <Skeleton className="h-[46px] w-full rounded-[var(--r-pill)]" />
          <Skeleton className="h-[46px] w-full rounded-[var(--r-pill)]" />
          <Skeleton className="h-[46px] w-[92%] rounded-[var(--r-pill)]" />
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

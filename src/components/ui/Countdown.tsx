import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { formatCountdown, formatCountdownLong, isoAttr, MINUTE } from '@/lib/time'

/**
 * Cuenta regresiva.
 *
 * El tick es de un minuto, no de un segundo: la unidad más chica que se muestra
 * son minutos, así que refrescar más seguido sería trabajo tirado. El intervalo
 * se limpia al desmontar.
 *
 * Nunca decide nada: si esto muestra "ya", igual es el servidor el que rechaza
 * el voto.
 */
export function Countdown({
  target,
  className,
  prefix,
}: {
  target: string
  className?: string
  prefix?: string
}) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), MINUTE)
    return () => window.clearInterval(id)
  }, [])

  const short = formatCountdown(target, now)

  return (
    <time dateTime={isoAttr(target)} className={cn('tabular', className)}>
      <span aria-hidden="true">
        {prefix ? `${prefix} ` : ''}
        {short}
      </span>
      <span className="sr-only">
        {prefix ? `${prefix} ` : ''}
        {formatCountdownLong(target, now)}
      </span>
    </time>
  )
}

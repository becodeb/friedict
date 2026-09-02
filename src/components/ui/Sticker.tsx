import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type StickerTone = 'sun' | 'lime' | 'sky' | 'pink' | 'ink' | 'grey' | 'white'

/**
 * Sticker: la etiqueta de friedict.
 *
 * Contorno de tinta, relleno de golosina y texto siempre. Cuando va pegado
 * sobre el borde de una tarjeta lleva `cut`: un filete del color de la
 * superficie alrededor, como si estuviera troquelado. `tilt` lo inclina unos
 * grados; nunca más de cinco, que a partir de ahí deja de parecer pegado y
 * empieza a parecer caído.
 */
export function Sticker({
  tone = 'white',
  cut = false,
  tilt = 0,
  className,
  style,
  children,
  ...rest
}: {
  tone?: StickerTone
  cut?: boolean
  tilt?: number
  children: ReactNode
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('sticker', className)}
      data-tone={tone}
      data-cut={cut ? '' : undefined}
      style={tilt ? { transform: `rotate(${tilt}deg)`, ...style } : style}
      {...rest}
    >
      {children}
    </span>
  )
}

/**
 * La explosión «¡Estaba cantado!». Decorativa: el estado ya lo dice el sticker
 * de al lado, así que va oculta para lectores de pantalla.
 */
export function Burst({
  className,
  tilt = 9,
  children = (
    <>
      ¡Estaba
      <br />
      cantado!
    </>
  ),
}: {
  className?: string
  tilt?: number
  children?: ReactNode
}) {
  return (
    <span
      className={cn('pointer-events-none absolute z-[2]', className)}
      style={{ transform: `rotate(${tilt}deg)` }}
      aria-hidden="true"
    >
      <span className="burst-back" />
      <span className="burst">{children}</span>
    </span>
  )
}

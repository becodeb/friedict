import { useId, type ReactElement, cloneElement } from 'react'

/**
 * transitions-dev-react-css/tooltip/tooltip.txt
 *
 * El delay de entrada vive SÓLO en la regla de hover: al salir, el delay vuelve
 * a 0 y el tooltip desaparece enseguida en lugar de quedar colgado.
 *
 * Sólo para iconos sin etiqueta visible, y siempre acompañado de `aria-label`
 * en el disparador: un tooltip no es un nombre accesible.
 */
export function Tooltip({
  label,
  children,
}: {
  label: string
  children: ReactElement<{ className?: string; 'aria-describedby'?: string }>
}) {
  const id = useId()

  return (
    <span className="t-tt-wrap">
      {cloneElement(children, {
        className: `${children.props.className ?? ''} t-tt-trigger`.trim(),
        'aria-describedby': id,
      })}
      <span id={id} role="tooltip" className="t-tt">
        {label}
      </span>
    </span>
  )
}

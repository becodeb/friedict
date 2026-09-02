import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { OptionWithTally, TimelinePoint } from '@/lib/types'
import { formatDate } from '@/lib/time'

/**
 * Evolución de la opinión del grupo en una predicción evolutiva.
 *
 * Responde una sola pregunta: ¿cuándo empezó el grupo a cambiar de opinión? Por
 * eso son votos ACUMULADOS por opción y no votos por ronda: lo que interesa es
 * la tendencia, no el ruido semana a semana.
 *
 * Sólo se dibuja cuando hay al menos dos rondas con datos. Un gráfico de un
 * punto no informa nada y ocupa media pantalla.
 *
 * Los datos llegan de la RPC `vote_timeline`, que aplica las reglas de
 * visibilidad en el servidor: acá nunca aparece nada que no se pueda ver.
 */
const SERIES_COLORS = [
  'var(--series-0)',
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
]

export function PredictionTimelineChart({
  points,
  options,
}: {
  points: TimelinePoint[]
  options: OptionWithTally[]
}) {
  const { rows, series } = useMemo(() => {
    const cycles = [...new Set(points.map((point) => point.cycle))].sort((a, b) => a - b)

    // Sólo las opciones que recibieron al menos un voto: dibujar cinco líneas
    // planas en cero convierte el gráfico en ruido.
    const activeOptions = options.filter((option) =>
      points.some((point) => point.option_id === option.id && point.votes > 0),
    )

    const running = new Map<string, number>()
    const built = cycles.map((cycle) => {
      const bucket = points.find((point) => point.cycle === cycle)
      const row: Record<string, number | string> = {
        cycle,
        label: bucket ? formatDate(bucket.bucket_at) : `Ronda ${cycle + 1}`,
      }

      for (const option of activeOptions) {
        const point = points.find(
          (candidate) => candidate.cycle === cycle && candidate.option_id === option.id,
        )
        running.set(option.id, (running.get(option.id) ?? 0) + (point?.votes ?? 0))
        row[option.id] = running.get(option.id) ?? 0
      }
      return row
    })

    return { rows: built, series: activeOptions }
  }, [points, options])

  if (rows.length < 2 || series.length === 0) return null

  return (
    <section aria-labelledby="evolucion-titulo" className="card-pop p-5">
      <h2 id="evolucion-titulo" className="type-meta text-[var(--ink-3)]">
        Cómo fue cambiando
      </h2>

      {/* Altura reservada para que el gráfico no empuje el contenido de abajo
          al montarse, y `overflow-hidden` + `min-w-0` porque ResponsiveContainer
          mide el padre y, mientras se estabiliza, puede pedir unos píxeles de
          más y provocar scroll horizontal en mobile. */}
      <div className="mt-3 h-[220px] w-full min-w-0 overflow-hidden">
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <LineChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'var(--ink-3)', fontSize: 11, fontWeight: 600 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--line-strong)', strokeWidth: 2 }}
              minTickGap={24}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'var(--ink-3)', fontSize: 11, fontWeight: 600 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface)',
                border: '2px solid var(--line-strong)',
                borderRadius: 'var(--r-md)',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--ink)',
                boxShadow: 'var(--shadow-1)',
              }}
              labelStyle={{ color: 'var(--ink-3)', fontSize: 11, fontWeight: 600 }}
              formatter={(value, name) => {
                const option = series.find((candidate) => candidate.id === name)
                return [`${String(value)} votos`, option?.label ?? String(name)]
              }}
            />
            {series.map((option, index) => (
              <Line
                key={option.id}
                type="monotone"
                dataKey={option.id}
                name={option.id}
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--ink)' }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Leyenda propia: la de Recharts no se puede alinear al sistema tipográfico. */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((option, index) => (
          <li key={option.id} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full border-2 border-[var(--line-strong)]"
              style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }}
            />
            <span className="type-micro font-medium text-[var(--ink-2)]">{option.label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

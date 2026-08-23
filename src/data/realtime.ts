import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from './keys'
import type { PredictionRow } from '@/lib/types'

/**
 * Realtime.
 *
 * Qué se escucha y qué NO:
 *
 *   · `prediction_votes` queda deliberadamente afuera. Sus filas son privadas
 *     hasta el cierre, así que Realtime —que aplica RLS— nunca entregaría los
 *     votos ajenos y los contadores quedarían congelados. En su lugar se
 *     escucha `predictions` (participant_count, status) y
 *     `prediction_option_tallies`, que el trigger de votos mantiene al día.
 *     Resultado: la participación se ve en vivo y la elección de cada persona
 *     sigue siendo secreta.
 *
 *   · Los payloads NO se aplican al caché a mano, salvo la fila de `predictions`
 *     que es barata y exacta. Para todo lo demás se invalida la query que
 *     corresponde: es más difícil de romper que reconstruir estado desde
 *     eventos sueltos, y evita quedar desincronizado si se pierde un mensaje.
 *
 *   · Un canal por grupo, montado en el layout del grupo. Crear el canal dentro
 *     de un componente que re-renderiza genera suscripciones duplicadas; por eso
 *     el efecto depende sólo de `groupId` y los callbacks viven en un ref.
 */

export interface GroupRealtimeHandlers {
  /** Una predicción "En prueba" alcanzó la participación mínima. */
  onQualified?: (prediction: PredictionRow) => void
  /** Se confirmó un resultado. */
  onResolved?: (prediction: PredictionRow) => void
  /** Entró alguien al grupo. */
  onMemberJoined?: () => void
  /** Apareció una predicción nueva que no creaste vos. */
  onNewPrediction?: (prediction: PredictionRow) => void
}

export function useGroupRealtime(
  groupId: string | undefined,
  handlers: GroupRealtimeHandlers = {},
): void {
  const queryClient = useQueryClient()

  // Los handlers cambian en cada render; el canal no debe. El ref se actualiza
  // en un efecto y no durante el render: escribir un ref mientras se renderiza
  // rompe el modo concurrente, donde un render puede descartarse.
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    if (!groupId) return

    const channel = supabase
      .channel(`group:${groupId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'predictions',
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          const next = payload.new as PredictionRow | undefined
          const previous = payload.eventType === 'UPDATE'
            ? (payload.old as Partial<PredictionRow> | undefined)
            : undefined

          if (next?.id) {
            // Esta fila sí se aplica directo: viene completa y es la que hace
            // que el contador de participantes se mueva en vivo.
            queryClient.setQueryData<PredictionRow[]>(
              qk.predictions(groupId),
              (current) =>
                current?.map((p) => (p.id === next.id ? { ...p, ...next } : p)),
            )
          }

          if (payload.eventType === 'INSERT' && next) {
            handlersRef.current.onNewPrediction?.(next)
          }

          if (previous && next) {
            if (previous.status === 'proposed' && next.status === 'active') {
              handlersRef.current.onQualified?.(next)
            }
            if (previous.status !== 'resolved' && next.status === 'resolved') {
              handlersRef.current.onResolved?.(next)
            }
          }

          void queryClient.invalidateQueries({ queryKey: qk.predictions(groupId) })
          if (next?.id) {
            void queryClient.invalidateQueries({ queryKey: qk.prediction(next.id) })
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_members',
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') handlersRef.current.onMemberJoined?.()
          void queryClient.invalidateQueries({ queryKey: qk.members(groupId) })
          void queryClient.invalidateQueries({ queryKey: qk.leaderboard(groupId) })
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_events',
          filter: `group_id=eq.${groupId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: qk.activity(groupId) })
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'prediction_scores',
          filter: `group_id=eq.${groupId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: qk.leaderboard(groupId) })
        },
      )
      .subscribe()

    return () => {
      // removeChannel desuscribe y libera el canal del cliente. Sin esto, cada
      // cambio de grupo dejaría un canal huérfano abierto.
      void supabase.removeChannel(channel)
    }
  }, [groupId, queryClient])
}

/**
 * Canal del detalle. Escucha los recuentos por opción, que es lo único que
 * cambia en vivo dentro de una predicción abierta con resultados visibles.
 */
export function usePredictionRealtime(
  predictionId: string | undefined,
  groupId: string | undefined,
): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!predictionId) return

    const channel = supabase
      .channel(`prediction:${predictionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'prediction_option_tallies',
          filter: `prediction_id=eq.${predictionId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: qk.prediction(predictionId) })
          void queryClient.invalidateQueries({ queryKey: qk.timeline(predictionId) })
          if (groupId) {
            void queryClient.invalidateQueries({ queryKey: qk.predictions(groupId) })
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'predictions',
          filter: `id=eq.${predictionId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: qk.prediction(predictionId) })
          void queryClient.invalidateQueries({ queryKey: qk.resolution(predictionId) })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [predictionId, groupId, queryClient])
}

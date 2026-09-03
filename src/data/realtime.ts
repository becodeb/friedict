import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from './keys'
import type { PredictionRow } from '@/lib/types'

/**
 * Realtime.
 *
 * Un WebSocket contra el propio servidor, alimentado por LISTEN/NOTIFY de
 * Postgres. Reemplaza a Supabase Realtime conservando exactamente el mismo
 * criterio de qué se escucha y qué no:
 *
 *   · `prediction_votes` queda deliberadamente afuera. Sus filas son privadas
 *     hasta el cierre. Se escucha `predictions` (participant_count, status) y
 *     `prediction_option_tallies`, que el trigger de votos mantiene al día.
 *     Resultado: la participación se ve en vivo y la elección de cada persona
 *     sigue siendo secreta.
 *
 *   · Los avisos NO traen datos: traen "cambió esto". Lo que se hace con
 *     ellos es invalidar la query que corresponde y volver a pedirla por HTTP,
 *     donde la RLS decide otra vez qué se puede ver. Es más difícil de romper
 *     que reconstruir estado desde eventos sueltos, y evita quedar
 *     desincronizado si se pierde un mensaje.
 *
 *   · Una sola conexión para toda la app, compartida entre los hooks. Abrir un
 *     socket por componente generaría conexiones duplicadas en cada
 *     re-render.
 */

interface ChangeEvent {
  table: string
  event: 'insert' | 'update' | 'delete'
  group_id: string
  prediction_id?: string
  title?: string
  status?: PredictionRow['status']
  previous_status?: PredictionRow['status'] | null
  minimum_participants?: number
  participant_count?: number
  created_by?: string
}

type Listener = (event: ChangeEvent) => void

/**
 * La conexión compartida.
 *
 * Se abre con el primer suscriptor y se cierra con el último. Se reconecta
 * sola con una espera creciente: sin eso, un servidor que se reinicia dejaría
 * la app muda para siempre, que es la peor forma de fallar porque nadie la
 * nota — la pantalla sigue mostrando datos, sólo que viejos.
 */
class RealtimeConnection {
  private socket: WebSocket | null = null
  private listeners = new Set<Listener>()
  private groups = new Set<string>()
  private retries = 0
  private reconnectTimer: number | undefined

  subscribe(groupId: string, listener: Listener): () => void {
    this.listeners.add(listener)
    this.groups.add(groupId)
    this.connect()
    this.sendSubscribe(groupId)

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.groups.clear()
        this.close()
      }
    }
  }

  private sendSubscribe(groupId: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'subscribe', groupId }))
    }
  }

  private connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime`)
    this.socket = socket

    socket.addEventListener('open', () => {
      this.retries = 0
      // Al reconectar hay que volver a decir qué grupos se estaban mirando: el
      // servidor no guarda nada de la conexión anterior.
      for (const groupId of this.groups) this.sendSubscribe(groupId)
    })

    socket.addEventListener('message', (message) => {
      try {
        const event = JSON.parse(String(message.data)) as ChangeEvent
        for (const listener of this.listeners) listener(event)
      } catch {
        // Un mensaje ilegible no debería tirar abajo la conexión.
      }
    })

    socket.addEventListener('close', () => {
      this.socket = null
      if (this.listeners.size > 0) this.scheduleReconnect()
    })

    socket.addEventListener('error', () => socket.close())
  }

  private scheduleReconnect(): void {
    window.clearTimeout(this.reconnectTimer)
    // Espera creciente hasta 15s: reintentar cada 100ms contra un servidor
    // caído sólo lo empeora.
    const delay = Math.min(1000 * 2 ** this.retries, 15_000)
    this.retries += 1
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay)
  }

  private close(): void {
    window.clearTimeout(this.reconnectTimer)
    this.socket?.close()
    this.socket = null
  }
}

const connection = new RealtimeConnection()

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

/**
 * El aviso trae sólo unos pocos campos, pero los handlers reciben algo con
 * forma de `PredictionRow` porque es lo que usan para armar el texto del
 * toast (título y mínimo de participantes). No es la fila completa y no se
 * usa para pintar: para eso se invalida y se vuelve a pedir.
 */
function asPredictionRow(event: ChangeEvent): PredictionRow {
  return {
    id: event.prediction_id,
    title: event.title,
    status: event.status,
    minimum_participants: event.minimum_participants,
    participant_count: event.participant_count,
    created_by: event.created_by,
  } as unknown as PredictionRow
}

export function useGroupRealtime(
  groupId: string | undefined,
  handlers: GroupRealtimeHandlers = {},
): void {
  const queryClient = useQueryClient()

  // Los handlers cambian en cada render; la suscripción no debe. El ref se
  // actualiza en un efecto y no durante el render: escribir un ref mientras se
  // renderiza rompe el modo concurrente, donde un render puede descartarse.
  const handlersRef = useRef(handlers)
  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    if (!groupId) return

    return connection.subscribe(groupId, (event) => {
      if (event.group_id !== groupId) return

      if (event.table === 'predictions') {
        if (event.event === 'insert') {
          handlersRef.current.onNewPrediction?.(asPredictionRow(event))
        }
        if (event.event === 'update' && event.previous_status && event.status) {
          if (event.previous_status === 'proposed' && event.status === 'active') {
            handlersRef.current.onQualified?.(asPredictionRow(event))
          }
          if (event.previous_status !== 'resolved' && event.status === 'resolved') {
            handlersRef.current.onResolved?.(asPredictionRow(event))
          }
        }

        void queryClient.invalidateQueries({ queryKey: qk.predictions(groupId) })
        if (event.prediction_id) {
          void queryClient.invalidateQueries({ queryKey: qk.prediction(event.prediction_id) })
        }
        return
      }

      if (event.table === 'group_members') {
        if (event.event === 'insert') handlersRef.current.onMemberJoined?.()
        void queryClient.invalidateQueries({ queryKey: qk.members(groupId) })
        void queryClient.invalidateQueries({ queryKey: qk.leaderboard(groupId) })
        return
      }

      if (event.table === 'activity_events') {
        void queryClient.invalidateQueries({ queryKey: qk.activity(groupId) })
        return
      }

      if (event.table === 'prediction_scores') {
        void queryClient.invalidateQueries({ queryKey: qk.leaderboard(groupId) })
        return
      }

      if (event.table === 'prediction_option_tallies') {
        void queryClient.invalidateQueries({ queryKey: qk.predictions(groupId) })
        if (event.prediction_id) {
          void queryClient.invalidateQueries({ queryKey: qk.prediction(event.prediction_id) })
        }
      }
    })
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
    if (!predictionId || !groupId) return

    return connection.subscribe(groupId, (event) => {
      if (event.prediction_id !== predictionId) return

      if (event.table === 'prediction_option_tallies') {
        void queryClient.invalidateQueries({ queryKey: qk.prediction(predictionId) })
        void queryClient.invalidateQueries({ queryKey: qk.timeline(predictionId) })
        void queryClient.invalidateQueries({ queryKey: qk.predictions(groupId) })
        return
      }

      if (event.table === 'predictions') {
        void queryClient.invalidateQueries({ queryKey: qk.prediction(predictionId) })
        void queryClient.invalidateQueries({ queryKey: qk.resolution(predictionId) })
      }
    })
  }, [predictionId, groupId, queryClient])
}

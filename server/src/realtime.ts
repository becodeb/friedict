import type { Server } from 'node:http'
import pg from 'pg'
import { WebSocketServer, type WebSocket } from 'ws'
import jwt from 'jsonwebtoken'
import { env } from './env.js'
import { pool } from './db.js'

/**
 * Realtime.
 *
 * Reemplaza a Supabase Realtime con las dos piezas que Postgres ya trae:
 * `LISTEN/NOTIFY` del lado de la base y un WebSocket del lado del navegador.
 *
 * Una SOLA conexión dedicada escucha el canal `friedict` (no sale del pool: una
 * conexión con `LISTEN` no se puede devolver ni reutilizar para consultas). De
 * ahí cada aviso se reparte a los sockets suscriptos a ese grupo.
 *
 * Lo importante en seguridad: al suscribirse a un grupo se verifica la
 * membresía contra la base, no se cree lo que dice el cliente. Y lo que se
 * emite no contiene nada secreto — ni votos ni recuentos —, así que aunque un
 * aviso llegara de más, no filtraría nada: el cliente lo usa sólo para saber
 * QUÉ volver a pedir por HTTP, donde la RLS decide de nuevo.
 */

interface ChangePayload {
  table: string
  event: string
  group_id: string
  prediction_id?: string
  title?: string
  status?: string
  previous_status?: string | null
  required_participants?: number
  participant_count?: number
  created_by?: string
}

interface Client {
  socket: WebSocket
  userId: string
  /** Grupos que este socket pidió mirar y para los que se verificó membresía. */
  groups: Set<string>
}

const clients = new Set<Client>()

/** ¿Esta persona es parte del grupo? Lo decide la base, no el cliente. */
async function isMember(userId: string, groupId: string): Promise<boolean> {
  const { rows } = await pool.query(
    'select 1 from public.group_members where user_id = $1 and group_id = $2',
    [userId, groupId],
  )
  return rows.length > 0
}

function broadcast(payload: ChangePayload): void {
  const message = JSON.stringify(payload)
  for (const client of clients) {
    if (!client.groups.has(payload.group_id)) continue
    if (client.socket.readyState !== client.socket.OPEN) continue
    client.socket.send(message)
  }
}

/**
 * La conexión que escucha. Si se cae —reinicio de Postgres, corte de red—, se
 * vuelve a conectar sola: sin esto la app seguiría andando pero se quedaría
 * muda, que es la peor forma de fallar porque no se nota.
 */
function startListener(): void {
  const client = new pg.Client({ connectionString: env.adminDatabaseUrl })

  const reconnect = (reason: string): void => {
    console.error(`[realtime] escucha caída (${reason}), reintentando en 2s`)
    setTimeout(startListener, 2000)
  }

  client.on('notification', (message) => {
    if (!message.payload) return
    try {
      broadcast(JSON.parse(message.payload) as ChangePayload)
    } catch (error) {
      console.error('[realtime] payload ilegible:', error)
    }
  })

  client.on('error', (error) => {
    client.end().catch(() => {})
    reconnect(error.message)
  })

  client
    .connect()
    .then(() => client.query('listen friedict'))
    .then(() => console.log('[realtime] escuchando el canal friedict'))
    .catch((error: Error) => reconnect(error.message))
}

/** El WebSocket viaja con la misma cookie de sesión que el resto de la app. */
function userFromCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  const match = /(?:^|;\s*)friedict_session=([^;]+)/.exec(cookieHeader)
  if (!match?.[1]) return null

  try {
    const payload = jwt.verify(decodeURIComponent(match[1]), env.jwtSecret) as jwt.JwtPayload
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

export function attachRealtime(server: Server): void {
  startListener()

  const wss = new WebSocketServer({ server, path: '/api/realtime' })

  wss.on('connection', (socket, request) => {
    const userId = userFromCookie(request.headers.cookie)
    if (!userId) {
      socket.close(4001, 'sin sesión')
      return
    }

    const client: Client = { socket, userId, groups: new Set() }
    clients.add(client)

    socket.on('message', (raw) => {
      void (async () => {
        try {
          const message = JSON.parse(String(raw)) as { type?: string; groupId?: string }
          if (message.type !== 'subscribe' || typeof message.groupId !== 'string') return

          if (await isMember(userId, message.groupId)) {
            client.groups.add(message.groupId)
          }
        } catch {
          // Un mensaje que no es JSON no merece tirar la conexión abajo.
        }
      })()
    })

    socket.on('close', () => clients.delete(client))
    socket.on('error', () => clients.delete(client))
  })

  // Un socket que quedó colgado (el cliente se fue sin cerrar) se detecta con
  // ping/pong: si no contesta en dos rondas, se descarta.
  const alive = new WeakSet<WebSocket>()
  wss.on('connection', (socket) => {
    alive.add(socket)
    socket.on('pong', () => alive.add(socket))
  })

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!alive.has(socket)) {
        socket.terminate()
        continue
      }
      alive.delete(socket)
      socket.ping()
    }
  }, 30_000)

  wss.on('close', () => clearInterval(heartbeat))

  console.log('[realtime] WebSocket montado en /api/realtime')
}

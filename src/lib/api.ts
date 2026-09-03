/**
 * Cliente de la API.
 *
 * Reemplaza a supabase-js. Toda petición viaja al mismo origen que sirve la
 * app, con la cookie de sesión incluida: no hay token en localStorage que un
 * XSS pueda robar, y tampoco hay CORS que configurar.
 *
 * Los errores se levantan como `ApiError`, con el mensaje del servidor tal
 * cual. Eso no es casual: las funciones SQL levantan códigos de dominio
 * (`not_a_member`, `voting_closed`, …) que `friendlyError` ya sabe traducir, y
 * conservar el mensaje intacto es lo que hace que esa traducción siga
 * funcionando sin tocar una línea.
 */

/** Igual que antes, la sesión vive en una cookie; nunca se manda un token. */
const BASE = '/api'

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

interface ErrorBody {
  error?: string
  message?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      // La cookie es de primera parte, pero `fetch` no la manda si no se le
      // pide explícitamente.
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    // Falla de red: ni siquiera hubo respuesta. `friendlyError` detecta el
    // caso sin conexión por su cuenta.
    throw new ApiError('network_error', 0, 'network_error')
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  const body: unknown = text ? JSON.parse(text) : null

  if (!response.ok) {
    const error = (body ?? {}) as ErrorBody
    throw new ApiError(
      error.message ?? `Error ${response.status}`,
      response.status,
      error.error,
    )
  }

  return body as T
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  })
}

/**
 * Llama a una función de dominio en Postgres.
 *
 * Es el equivalente exacto de `supabase.rpc(...)`, incluida la parte que
 * importa: los parámetros que no se mandan NO viajan como null, así que la
 * función aplica su propio default. Por eso `undefined` se filtra acá.
 */
export function rpc<T>(fn: string, params: Record<string, unknown> = {}): Promise<T> {
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) clean[key] = value
  }
  return apiPost<T>(`/rpc/${fn}`, clean)
}

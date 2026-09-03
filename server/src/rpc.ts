import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router } from 'express'
import { withUser } from './db.js'

/**
 * Llamadas a las funciones de dominio.
 *
 * Toda la lógica de friedict —quién puede votar, cuándo cierra una predicción,
 * cómo se reparten los puntos— vive en funciones SECURITY DEFINER en Postgres,
 * y ahí se queda. Este archivo es apenas el pasamanos entre HTTP y esas
 * funciones. No valida reglas de negocio: si lo hiciera, habría dos fuentes de
 * verdad y tarde o temprano dirían cosas distintas.
 *
 * Lo que sí hace, y es lo único que le toca:
 *
 *   · LISTA BLANCA. Sólo se puede llamar a lo que está en
 *     `db/rpc-functions.json`. Sin eso, el endpoint sería "ejecutá cualquier
 *     función de mi base" — incluidas las internas como `score_prediction` o
 *     las de auth.
 *   · Los argumentos van SIEMPRE por nombre y con su tipo declarado. Por
 *     nombre, para que los parámetros que no se mandan tomen el default de la
 *     función en lugar de un null (que significa otra cosa). Con el tipo,
 *     porque Postgres no puede inferir el tipo de un parámetro suelto cuando
 *     el argumento es un enum o un interval.
 *
 * La lista vive en un JSON y no acá para que el arnés de tests use exactamente
 * la misma: una sola lista blanca, un solo lugar donde equivocarse.
 */

/** Cómo se devuelve el resultado. */
type Shape =
  /** Escalar o jsonb: viaja tal cual. */
  | 'scalar'
  /** Tipo compuesto (una fila de una tabla): se convierte a JSON. */
  | 'row'
  /** `returns table`: se consulta con `select * from`. */
  | 'table'
  /** `returns void`: no hay nada que devolver. */
  | 'void'

interface FunctionSpec {
  /** Nombre del parámetro en SQL -> tipo con el que se castea. */
  params: Record<string, string>
  shape: Shape
  /** Si se puede llamar sin sesión. Sólo la vista previa de una invitación. */
  allowAnonymous?: boolean
}

const HERE = dirname(fileURLToPath(import.meta.url))
const SPEC_FILE = [
  join(HERE, '..', 'db', 'rpc-functions.json'),
  join(HERE, '..', '..', 'db', 'rpc-functions.json'),
].find((candidate) => existsSync(candidate))

if (!SPEC_FILE) {
  throw new Error('No encontré db/rpc-functions.json, que es la lista blanca de funciones.')
}

const FUNCTIONS = (
  JSON.parse(readFileSync(SPEC_FILE, 'utf8')) as { functions: Record<string, FunctionSpec> }
).functions

export const rpcRouter = Router()

rpcRouter.post('/:fn', async (req, res, next) => {
  const name = req.params.fn
  const spec = FUNCTIONS[name]

  if (!spec) {
    res.status(404).json({ error: 'unknown_function', message: `No existe la función ${name}.` })
    return
  }
  if (!spec.allowAnonymous && !req.userId) {
    res.status(401).json({ error: 'auth_required', message: 'Necesitás iniciar sesión.' })
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>

  // Sólo los parámetros que la función declara, y sólo los que vinieron. Un
  // parámetro ausente NO se manda como null: se omite, para que la función
  // aplique su propio default.
  const names: string[] = []
  const values: unknown[] = []
  for (const [param, type] of Object.entries(spec.params)) {
    if (!(param in body) || body[param] === undefined) continue
    values.push(body[param])
    names.push(`${param} => $${values.length}::${type}`)
  }

  const call = `public.${name}(${names.join(', ')})`
  const sql =
    spec.shape === 'table' ? `select * from ${call}` : `select to_jsonb(${call}) as result`

  try {
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(sql, values)
      return result.rows
    })

    if (spec.shape === 'void') {
      res.status(204).end()
      return
    }
    if (spec.shape === 'table') {
      res.json(rows)
      return
    }
    res.json((rows[0] as { result: unknown } | undefined)?.result ?? null)
  } catch (error) {
    next(error)
  }
})

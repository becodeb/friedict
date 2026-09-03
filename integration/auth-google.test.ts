import { describe, expect, it } from 'vitest'
import { sql } from './helpers'

/**
 * Ingreso con Google sobre cuentas que ya existen.
 *
 * El caso que importa: alguien se registró con mail y contraseña y la segunda
 * vez entra con Google. Tiene que caer en LA MISMA cuenta —con su historial,
 * sus grupos y sus puntos— y no en una cuenta nueva vacía que resulta tener el
 * mismo mail. `auth_upsert_google` resuelve por `google_sub` primero y por
 * mail después, y esa segunda rama es la que se prueba acá.
 *
 * Tanto el mail COMO el sub llevan sello de tiempo: la base no se limpia
 * entre corridas, y un sub constante haría que la segunda vez el primer
 * camino (por sub) resolviera la cuenta de la corrida anterior y el test
 * pasara o fallara según el orden.
 */
describe('auth_upsert_google', () => {
  it('vincula el sub de Google a una cuenta creada con contraseña, sin duplicarla', async () => {
    const stamp = Date.now()
    const email = `linkme-${stamp}@friedict.test`

    const [registered] = await sql<{ id: string }>(
      'select public.auth_register($1, $2) as id',
      [email, 'hash-que-no-importa'],
    )
    const passwordUserId = registered!.id
    expect(passwordUserId).toBeTruthy()

    const [linked] = await sql<{ id: string }>(
      'select public.auth_upsert_google($1, $2) as id',
      [`google-sub-linkme-${stamp}`, email],
    )

    // Misma cuenta, no una nueva.
    expect(linked!.id).toBe(passwordUserId)

    const rows = await sql<{ count: string }>(
      'select count(*)::text as count from public.users where lower(email) = lower($1)',
      [email],
    )
    expect(rows[0]!.count).toBe('1')

    // Y la contraseña sigue sirviendo: vincular no es reemplazar.
    const [user] = await sql<{ password_hash: string | null; google_sub: string | null }>(
      'select password_hash, google_sub from public.users where id = $1',
      [passwordUserId],
    )
    expect(user!.password_hash).toBe('hash-que-no-importa')
    expect(user!.google_sub).toBe(`google-sub-linkme-${stamp}`)
  })

  it('el mail se compara sin distinguir mayúsculas', async () => {
    const stamp = Date.now()
    const email = `MiXeD-${stamp}@Friedict.test`

    const [registered] = await sql<{ id: string }>(
      'select public.auth_register($1, $2) as id',
      [email, 'hash'],
    )

    const [linked] = await sql<{ id: string }>(
      'select public.auth_upsert_google($1, $2) as id',
      [`google-sub-mixed-${stamp}`, email.toLowerCase()],
    )
    expect(linked!.id).toBe(registered!.id)
  })

  it('entrar dos veces con Google usa siempre la misma cuenta', async () => {
    const stamp = Date.now()
    const email = `twice-${stamp}@friedict.test`

    const [first] = await sql<{ id: string }>(
      'select public.auth_upsert_google($1, $2) as id',
      [`google-sub-twice-${stamp}`, email],
    )
    const [second] = await sql<{ id: string }>(
      'select public.auth_upsert_google($1, $2) as id',
      [`google-sub-twice-${stamp}`, email],
    )
    expect(second!.id).toBe(first!.id)
  })
})

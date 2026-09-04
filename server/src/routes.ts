import { Router } from 'express'
import { queryAs } from './db.js'
import { requireAuth } from './auth.js'
import { PREDICTION_SELECT } from './prediction-select.js'

/**
 * Lecturas.
 *
 * Reemplazan lo que antes resolvía PostgREST. Cada consulta corre dentro de
 * `withUser`, así que las MISMAS políticas RLS que protegían la app con
 * Supabase siguen siendo las que deciden QUÉ SE PUEDE VER. Ninguna consulta de
 * acá filtra por usuario para proteger nada: si lo hiciera, habría dos reglas
 * de visibilidad —la de la base y la del servidor— y la del servidor sería la
 * que se olvide de actualizar.
 *
 * La única excepción es `/groups`, y no es de seguridad sino de significado:
 * ahí el `where` elige MI membresía entre las de todo el grupo, que la RLS
 * deja ver a propósito. Está explicado en su lugar.
 *
 * Todo lo anidado se arma con agregación JSON en una sola consulta. Los
 * "embeds" de PostgREST eran eso mismo por debajo, y traerlo en varios viajes
 * sería un N+1 disfrazado.
 */

export const apiRouter = Router()

// PREDICTION_SELECT (campos derivados de member_count, options, votes, author)
// vive en ./prediction-select.ts — ver el docblock ahí.

// ---------------------------------------------------------------------------
// Grupos
// ---------------------------------------------------------------------------

apiRouter.get('/groups', requireAuth, async (req, res, next) => {
  try {
    // El filtro por usuario acá NO es de seguridad —de eso se ocupa la RLS—
    // sino de significado: la política deja ver a todos los integrantes de mis
    // grupos (lo necesita la pantalla de integrantes), así que sin este
    // `where` cada grupo saldría repetido una vez por cada persona que lo
    // integra. Lo que se pide es MI membresía.
    const rows = await queryAs(
      req.userId,
      `select
         g.*,
         m.role,
         (select count(*) from public.group_members c where c.group_id = g.id)::int as member_count
       from public.group_members m
       join public.groups g on g.id = m.group_id
       where m.user_id = $1
       order by m.joined_at asc`,
      [req.userId],
    )
    res.json(rows)
  } catch (error) {
    next(error)
  }
})

apiRouter.get('/groups/:groupId', requireAuth, async (req, res, next) => {
  try {
    const rows = await queryAs(req.userId, 'select * from public.groups where id = $1', [
      req.params.groupId,
    ])
    // Sin fila puede ser "no existe" o "no sos parte". No se distinguen a
    // propósito: decir cuál es filtraría la existencia de grupos ajenos.
    if (rows.length === 0) {
      res.status(404).json({ error: 'not_found', message: 'No encontramos este grupo.' })
      return
    }
    res.json(rows[0])
  } catch (error) {
    next(error)
  }
})

apiRouter.get('/groups/:groupId/members', requireAuth, async (req, res, next) => {
  try {
    const rows = await queryAs(
      req.userId,
      `select m.*, to_jsonb(p) as profile
         from public.group_members m
         join public.profiles p on p.id = m.user_id
        where m.group_id = $1
        order by m.joined_at asc`,
      [req.params.groupId],
    )
    res.json(rows)
  } catch (error) {
    next(error)
  }
})

apiRouter.get('/groups/:groupId/invites', requireAuth, async (req, res, next) => {
  try {
    // La RLS de `group_invites` sólo deja leer a owner/admin. Un member recibe
    // una lista vacía, no un error que confirme que existen.
    const rows = await queryAs(
      req.userId,
      `select * from public.group_invites
        where group_id = $1
        order by created_at desc`,
      [req.params.groupId],
    )
    res.json(rows)
  } catch (error) {
    next(error)
  }
})

apiRouter.get('/groups/:groupId/leaderboard', requireAuth, async (req, res, next) => {
  try {
    const rows = await queryAs(
      req.userId,
      `select * from public.group_leaderboard
        where group_id = $1
        order by position asc, display_name asc`,
      [req.params.groupId],
    )
    res.json(rows)
  } catch (error) {
    next(error)
  }
})

apiRouter.get('/groups/:groupId/activity', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 40) || 40, 100)
    const rows = await queryAs(
      req.userId,
      `select
         a.*,
         (
           select jsonb_build_object(
             'id', pr.id,
             'display_name', pr.display_name,
             'avatar_seed', pr.avatar_seed,
             'accent', pr.accent
           )
           from public.profiles pr
           where pr.id = a.actor_id
         ) as actor
       from public.activity_events a
       where a.group_id = $1
       order by a.created_at desc
       limit $2`,
      [req.params.groupId, limit],
    )
    res.json(rows)
  } catch (error) {
    next(error)
  }
})

apiRouter.get('/groups/:groupId/predictions', requireAuth, async (req, res, next) => {
  try {
    const rows = await queryAs(
      req.userId,
      `${PREDICTION_SELECT} where p.group_id = $1 order by p.created_at desc`,
      [req.params.groupId],
    )
    res.json(rows)
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

apiRouter.get('/profiles/:userId', requireAuth, async (req, res, next) => {
  try {
    const rows = await queryAs(req.userId, 'select * from public.profiles where id = $1', [
      req.params.userId,
    ])
    // Devuelve null y no 404: el perfil ausente es un estado normal (hay
    // sesión pero todavía no se completó el onboarding).
    res.json(rows[0] ?? null)
  } catch (error) {
    next(error)
  }
})

// ---------------------------------------------------------------------------
// Predicciones
// ---------------------------------------------------------------------------

apiRouter.get('/predictions/:predictionId', requireAuth, async (req, res, next) => {
  try {
    const rows = await queryAs(req.userId, `${PREDICTION_SELECT} where p.id = $1`, [
      req.params.predictionId,
    ])
    if (rows.length === 0) {
      res.status(404).json({ error: 'not_found', message: 'No encontramos esta predicción.' })
      return
    }
    res.json(rows[0])
  } catch (error) {
    next(error)
  }
})

apiRouter.get('/predictions/:predictionId/resolution', requireAuth, async (req, res, next) => {
  try {
    const rows = await queryAs(
      req.userId,
      `select
         r.*,
         coalesce((
           select jsonb_agg(to_jsonb(c) order by c.created_at)
           from public.resolution_confirmations c
           where c.resolution_id = r.id
         ), '[]'::jsonb) as confirmations
       from public.prediction_resolutions r
       where r.prediction_id = $1
       order by r.created_at desc
       limit 1`,
      [req.params.predictionId],
    )
    res.json(rows[0] ?? null)
  } catch (error) {
    next(error)
  }
})

apiRouter.get('/predictions/:predictionId/scores', requireAuth, async (req, res, next) => {
  try {
    const rows = await queryAs(
      req.userId,
      `select
         s.user_id,
         s.points,
         s.correct,
         s.rarity_multiplier,
         s.early_multiplier,
         s.conviction_multiplier,
         s.duration_multiplier,
         (
           select jsonb_build_object(
             'id', pr.id,
             'display_name', pr.display_name,
             'avatar_seed', pr.avatar_seed,
             'accent', pr.accent
           )
           from public.profiles pr
           where pr.id = s.user_id
         ) as profile
       from public.prediction_scores s
       where s.prediction_id = $1
       order by s.points desc`,
      [req.params.predictionId],
    )
    res.json(rows)
  } catch (error) {
    next(error)
  }
})

apiRouter.get('/templates', requireAuth, async (req, res, next) => {
  try {
    const rows = await queryAs(
      req.userId,
      `select * from public.prediction_templates
        where is_active
        order by sort_order asc`,
    )
    res.json(rows)
  } catch (error) {
    next(error)
  }
})

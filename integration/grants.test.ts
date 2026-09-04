import { describe, expect, it } from 'vitest'
import { anonClient, sql } from './helpers'

/**
 * Superficie de la API.
 *
 * Postgres otorga EXECUTE a PUBLIC en cada función nueva, y `anon` y
 * `authenticated` heredan de PUBLIC. Revocar sólo de esos dos roles no hace
 * nada, y el resultado es que TODA función de `public` —incluidas las internas
 * y las SECURITY DEFINER, que corren saltándose RLS— queda expuesta como
 * endpoint de PostgREST.
 *
 * Este test mira los privilegios EFECTIVOS, no la intención del SQL, y es la
 * red que evita que un `create function` futuro reabra el agujero.
 */
const RPC_PUBLICA = new Set([
  // Operaciones que llama la app
  'upsert_profile',
  'create_group',
  'leave_group',
  'update_member_role',
  'remove_member',
  'create_invite',
  'revoke_invite',
  'join_group',
  'create_prediction',
  'create_prediction_from_template',
  'add_prediction_option',
  'cancel_prediction',
  'cast_vote',
  'propose_resolution',
  'confirm_resolution',
  'vote_timeline',
  'finalize_predictions',
  'request_close',
  'withdraw_close_request',
  'update_group_settings',
  // Helpers de autorización y cálculo, sin efectos ni datos ajenos
  'is_group_member',
  'group_role',
  'is_group_admin',
  'shares_group_with',
  'can_read_prediction',
  'can_see_results',
  'can_see_votes',
  'calculate_points',
  'current_cycle',
  'required_participants',
  'required_close_requests',
  // duration_multiplier es un cálculo puro (igual que calculate_points): el
  // cliente lo usa para previsualizar puntos antes de cerrar la predicción.
  'duration_multiplier',
  // Identidad: la lee cada política RLS, así que tiene que ser ejecutable.
  'current_user_id',
  // Autenticación. Viven acá y no en el servidor para que el rol de la app no
  // necesite ningún privilegio sobre `public.users`.
  'auth_find_by_email',
  'auth_register',
  'auth_upsert_google',
  'auth_session_user',
  'auth_touch_sign_in',
])

/** Lo único que tiene sentido llamar sin sesión: la vista previa de un link. */
const RPC_ANONIMA = new Set([
  'peek_invite',
  // Quien inicia sesión, por definición, todavía no tiene sesión.
  'current_user_id',
  'auth_find_by_email',
  'auth_register',
  'auth_upsert_google',
  'auth_session_user',
  'auth_touch_sign_in',
])

interface FunctionRow {
  proname: string
  args: string
  security_definer: boolean
  authenticated_puede: boolean
  anon_puede: boolean
}

async function functionPrivileges(): Promise<FunctionRow[]> {
  return (await sql(`
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args,
      p.prosecdef as security_definer,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_puede,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_puede
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname
  `)) as FunctionRow[]
}

describe('superficie de la API', () => {
  it('authenticated sólo ejecuta las funciones previstas', async () => {
    const rows = await functionPrivileges()
    const permitidas = new Set([...RPC_PUBLICA, ...RPC_ANONIMA])

    const inesperadas = rows
      .filter((row) => row.authenticated_puede && !permitidas.has(row.proname))
      .map((row) => `${row.proname}(${row.args})`)

    expect(inesperadas).toEqual([])
  })

  it('anon sólo ejecuta peek_invite', async () => {
    const rows = await functionPrivileges()

    const inesperadas = rows
      .filter((row) => row.anon_puede && !RPC_ANONIMA.has(row.proname))
      .map((row) => `${row.proname}(${row.args})`)

    expect(inesperadas).toEqual([])
  })

  it('las funciones internas y los triggers no son endpoints', async () => {
    const rows = await functionPrivileges()
    const internas = [
      'score_prediction',
      'refresh_prediction_counts',
      'enforce_rate_limit',
      'generate_invite_token',
      'require_auth',
      'touch_updated_at',
      'on_vote_changed',
      'on_option_created',
      'group_member_count',
      'vote_change_window_of',
      'add_member_option',
      'sync_member_options',
      'on_member_joined',
    ]

    for (const nombre of internas) {
      const row = rows.find((candidate) => candidate.proname === nombre)
      expect(row, `falta la función ${nombre}`).toBeDefined()
      expect(row!.authenticated_puede, `${nombre} es ejecutable por authenticated`).toBe(false)
      expect(row!.anon_puede, `${nombre} es ejecutable por anon`).toBe(false)
    }
  })

  it('sin sesión, llamar a una función interna por la API falla', async () => {
    const anon = anonClient()

    // `score_prediction` es SECURITY DEFINER y escribe la tabla de puntajes.
    const { error } = await anon.rpc(
      'score_prediction' as never,
      { p_prediction_id: '00000000-0000-4000-8000-000000000000' } as never,
    )
    expect(error).not.toBeNull()
  })

  it('las tablas sólo otorgan SELECT: no hay INSERT/UPDATE/DELETE directo', async () => {
    const rows = (await sql(`
      select table_name, privilege_type, grantee
        from information_schema.role_table_grants
       where table_schema = 'public'
         and grantee in ('anon', 'authenticated')
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    `)) as Array<{ table_name: string; privilege_type: string; grantee: string }>

    expect(
      rows.map((r) => `${r.grantee} ${r.privilege_type} ${r.table_name}`),
    ).toEqual([])
  })
})

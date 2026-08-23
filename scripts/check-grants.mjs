/**
 * ¿Qué funciones de `public` puede ejecutar realmente un usuario autenticado?
 *
 * Postgres otorga EXECUTE a PUBLIC por defecto en cada función nueva, y
 * `anon`/`authenticated` heredan de PUBLIC. Revocar sólo de esos dos roles no
 * alcanza: hay que revocar de PUBLIC. Este script lo comprueba consultando los
 * privilegios efectivos, no la intención del SQL.
 */
import { Client } from 'pg'

const db = new Client({
  connectionString: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres',
})
await db.connect()

const { rows } = await db.query(`
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
`)

const previstas = new Set([
  'is_group_member', 'group_role', 'is_group_admin', 'calculate_points',
  'current_cycle', 'finalize_predictions', 'upsert_profile', 'create_group',
  'leave_group', 'update_member_role', 'remove_member', 'create_invite',
  'revoke_invite', 'join_group', 'create_prediction',
  'create_prediction_from_template', 'add_prediction_option', 'cancel_prediction',
  'cast_vote', 'propose_resolution', 'confirm_resolution', 'vote_timeline',
  'shares_group_with', 'can_read_prediction', 'can_see_results', 'can_see_votes',
  'peek_invite',
])

const inesperadas = rows.filter((r) => r.authenticated_puede && !previstas.has(r.proname))
const anonInesperadas = rows.filter((r) => r.anon_puede && r.proname !== 'peek_invite')

console.log(`funciones en public: ${rows.length}`)
console.log(`ejecutables por authenticated: ${rows.filter((r) => r.authenticated_puede).length}`)
console.log(`ejecutables por anon: ${rows.filter((r) => r.anon_puede).length}`)

if (inesperadas.length) {
  console.log('\n⚠  authenticated puede ejecutar funciones NO previstas:')
  for (const r of inesperadas) {
    console.log(`   ${r.proname}(${r.args})${r.security_definer ? '  [SECURITY DEFINER]' : ''}`)
  }
} else {
  console.log('\n✓ authenticated sólo ejecuta las funciones previstas')
}

if (anonInesperadas.length) {
  console.log('\n⚠  anon puede ejecutar funciones NO previstas:')
  for (const r of anonInesperadas) {
    console.log(`   ${r.proname}(${r.args})${r.security_definer ? '  [SECURITY DEFINER]' : ''}`)
  }
} else {
  console.log('✓ anon sólo ejecuta peek_invite')
}

await db.end()
process.exitCode = inesperadas.length || anonInesperadas.length ? 1 : 0

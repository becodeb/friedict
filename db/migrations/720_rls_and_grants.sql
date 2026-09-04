-- ============================================================================
-- friedict — RLS y grants de ajustes de grupo, ventana de voto y puntos por
-- duración
-- ----------------------------------------------------------------------------
-- Toda función nueva arranca con el EXECUTE que Postgres le regala a PUBLIC
-- por defecto. `alter default privileges` de 200_functions.sql sólo alcanza a
-- lo creado DESPUÉS de esa sentencia dentro de la MISMA sesión/transacción de
-- migración; no cubre funciones creadas en archivos posteriores — el mismo
-- motivo por el que 300_rls.sql, 400_notify_and_cron.sql y 620_rls_and_grants.sql
-- revocan explícitamente las suyas en vez de confiar en el orden de los
-- archivos. Se revoca primero de los tres roles y recién después se concede lo
-- que corresponde: así ninguna función nueva queda alcanzable por accidente,
-- ni siquiera un instante.
--
-- Borrar create_prediction / create_prediction_from_template /
-- required_close_requests en 710_ también se llevó sus GRANTs viejos: las
-- firmas nuevas son funciones distintas y necesitan el suyo desde cero.
-- ----------------------------------------------------------------------------
revoke execute on function
  public.update_group_settings(uuid, smallint, boolean, smallint),
  public.required_close_requests(integer, smallint),
  public.duration_multiplier(interval),
  public.vote_change_window_of(text),
  public.add_member_option(uuid, uuid, uuid),
  public.sync_member_options(uuid, uuid),
  public.on_member_joined(),
  public.create_prediction(
    uuid, text, text[], timestamptz, text, public.option_source, public.voting_mode,
    interval, boolean, public.results_visibility, public.votes_visibility, text),
  public.create_prediction_from_template(uuid, uuid, timestamptz)
from public, anon, authenticated;

grant execute on function
  public.update_group_settings(uuid, smallint, boolean, smallint),
  -- required_close_requests no es un endpoint que llame el navegador: la
  -- necesita el propio read path, que la invoca dentro del SELECT de
  -- server/src/prediction-select.ts para devolver `close_required` junto con
  -- la predicción. Sin este grant se cae la lectura entera del feed.
  public.required_close_requests(integer, smallint),
  -- duration_multiplier es un cálculo puro, igual que calculate_points (ya en
  -- RPC_PUBLICA): el cliente lo usa para previsualizar puntos antes de cerrar
  -- la predicción, sin depender de ninguna fila real.
  public.duration_multiplier(interval),
  public.create_prediction(
    uuid, text, text[], timestamptz, text, public.option_source, public.voting_mode,
    interval, boolean, public.results_visibility, public.votes_visibility, text),
  public.create_prediction_from_template(uuid, uuid, timestamptz)
to authenticated;

-- vote_change_window_of, add_member_option, sync_member_options y
-- on_member_joined quedan revocadas para siempre de los tres roles: son
-- internas de SECURITY DEFINER (la última es además un trigger), igual que
-- group_member_count. Nunca se re-conceden más abajo.

-- ----------------------------------------------------------------------------
-- RLS: no hace falta ninguna política nueva
-- ----------------------------------------------------------------------------
-- `groups_select_members` (300_rls.sql:142-144) ya deja leer `g.*` a
-- cualquier integrante, así que las tres columnas nuevas de groups son
-- legibles por exactamente la gente correcta sin tocar la política. `groups`
-- no tiene política de escritura: el único escritor sigue siendo la función
-- SECURITY DEFINER de arriba, el mismo estilo de 100_schema.sql:372-404.
--
-- `prediction_votes_select_own_or_visible` (300_rls.sql:177-179) ya cubre
-- first_cast_at y option_selected_at igual que cubre el resto de la fila: el
-- voto propio siempre se ve, así que cada quien siempre conoce su propio
-- plazo; el de los demás es tan privado como el voto mismo ya lo era. Ninguna
-- columna nueva escapa esa regla porque no hay ningún SELECT explícito de
-- columnas en esa política — es la fila entera o nada.

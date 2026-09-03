-- ============================================================================
-- friedict — RLS y grants del quórum y el cierre opcional
-- ============================================================================

-- ----------------------------------------------------------------------------
-- RLS de prediction_close_requests
-- ----------------------------------------------------------------------------
-- Análoga a prediction_votes_select_own_or_visible (300_rls.sql:177-179): el
-- pedido propio siempre se ve; el ajeno sólo si la predicción ya dejaría ver
-- los votos. Sin esta política, una fila de solicitud legible por cualquiera
-- filtraría "quién ya votó" antes de tiempo — exactamente lo que
-- ParticipationThreshold promete no revelar.
create policy prediction_close_requests_select_own_or_visible
  on public.prediction_close_requests for select to authenticated
  using (user_id = (select public.current_user_id()) or public.can_see_votes(prediction_id));

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
-- Toda función nueva arranca con el EXECUTE que Postgres le regala a PUBLIC
-- por defecto (el `alter default privileges` de 200_functions.sql no alcanza
-- a archivos posteriores — el mismo motivo por el que 300_rls.sql y
-- 400_notify_and_cron.sql revocan explícitamente las suyas en vez de confiar
-- en el orden de las migraciones). Se revoca primero de los tres roles y
-- recién después se concede lo que corresponde: así ninguna función nueva
-- queda alcanzable por accidente, ni siquiera un instante.
--
-- Borrar la vieja create_prediction en 610 también se llevó su GRANT viejo:
-- la firma nueva es una función distinta y necesita el suyo desde cero.
revoke execute on function
  public.required_participants(integer, smallint),
  public.required_close_requests(integer, smallint),
  public.group_member_count(uuid),
  public.request_close(uuid),
  public.withdraw_close_request(uuid),
  public.create_prediction(
    uuid, text, text[], timestamptz, text, public.option_source, public.voting_mode,
    interval, boolean, public.results_visibility, public.votes_visibility,
    smallint, smallint, integer)
from public, anon, authenticated;

grant execute on function
  public.required_participants(integer, smallint),
  public.required_close_requests(integer, smallint),
  public.request_close(uuid),
  public.withdraw_close_request(uuid),
  public.create_prediction(
    uuid, text, text[], timestamptz, text, public.option_source, public.voting_mode,
    interval, boolean, public.results_visibility, public.votes_visibility,
    smallint, smallint, integer)
to authenticated;

-- group_member_count es SECURITY DEFINER y sólo la llaman otras funciones
-- definer y el trigger de notify: igual que group_role/notify_change, no
-- tiene que quedar invocable como endpoint de la API. Queda revocada de los
-- tres roles arriba y nunca se re-concede.

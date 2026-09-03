-- ============================================================================
-- friedict — avisos en vivo y tareas programadas
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Realtime
-- ----------------------------------------------------------------------------
-- Donde antes había una publicación lógica que leía Supabase Realtime, ahora
-- hay triggers que emiten `pg_notify`. El servidor mantiene una conexión
-- dedicada con `LISTEN friedict` y reenvía cada aviso por WebSocket a quienes
-- estén mirando ese grupo.
--
-- El payload es CHICO a propósito: `pg_notify` corta en 8000 bytes y el
-- cliente no necesita la fila entera. Viaja lo mínimo para decidir qué
-- refrescar y qué avisar por pantalla; el resto se pide por HTTP, donde la RLS
-- vuelve a filtrar. Nada de lo que viaja por acá es secreto: ni votos, ni
-- recuentos.
--
-- `prediction_votes` sigue deliberadamente afuera: sus filas son privadas
-- hasta el cierre. Se avisa por `predictions` (participant_count) y por
-- `prediction_option_tallies`, cuya visibilidad respeta `results_visibility`.
--
-- La fila se lee como jsonb y NO por campo: de las cinco tablas que disparan
-- esto, tres tienen clave compuesta y no tienen columna `id`
-- (`group_members`, `prediction_scores`, `prediction_option_tallies`).
-- Con `to_jsonb` el campo ausente sale null en vez de romper el trigger, y un
-- trigger que rompe acá abortaría la transacción que lo disparó — o sea, que
-- alguien no podría entrar a un grupo porque falló un aviso de UI.
create or replace function public.notify_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_json  jsonb := to_jsonb(coalesce(new, old));
  v_group uuid;
  v_payload jsonb;
begin
  -- Cada tabla llega a su grupo por un camino distinto.
  if tg_table_name = 'prediction_option_tallies' then
    select p.group_id into v_group
      from public.predictions p
     where p.id = (v_json->>'prediction_id')::uuid;
  else
    v_group := (v_json->>'group_id')::uuid;
  end if;

  if v_group is null then
    return null;
  end if;

  v_payload := jsonb_build_object(
    'table', tg_table_name,
    'event', lower(tg_op),
    'group_id', v_group
  );

  if tg_table_name = 'predictions' then
    -- Los únicos campos extra que viajan: son los que el cliente usa para
    -- decidir si mostrar «juntó la gente» o «se resolvió» sin ir a buscar nada.
    v_payload := v_payload || jsonb_build_object(
      'prediction_id', v_json->>'id',
      'title', v_json->>'title',
      'status', v_json->>'status',
      'minimum_participants', v_json->'minimum_participants',
      'participant_count', v_json->'participant_count',
      'created_by', v_json->>'created_by',
      'previous_status', case when tg_op = 'UPDATE' then to_jsonb(old)->>'status' else null end
    );
  elsif tg_table_name = 'prediction_option_tallies' then
    v_payload := v_payload || jsonb_build_object('prediction_id', v_json->>'prediction_id');
  end if;

  perform pg_notify('friedict', v_payload::text);
  return null;
end;
$$;

-- Postgres le regala EXECUTE a PUBLIC a toda función nueva, y esta se crea
-- DESPUÉS del revoke masivo de 200_functions.sql, así que hay que revocarla a
-- mano. Es SECURITY DEFINER: dejarla invocable sería exponer como endpoint una
-- función que corre saltándose la RLS.
revoke execute on function public.notify_change() from public, anon, authenticated;

-- `after`: el aviso sale recién cuando el cambio está confirmado.
drop trigger if exists notify_predictions on public.predictions;
create trigger notify_predictions
  after insert or update or delete on public.predictions
  for each row execute function public.notify_change();

drop trigger if exists notify_group_members on public.group_members;
create trigger notify_group_members
  after insert or update or delete on public.group_members
  for each row execute function public.notify_change();

drop trigger if exists notify_activity_events on public.activity_events;
create trigger notify_activity_events
  after insert on public.activity_events
  for each row execute function public.notify_change();

drop trigger if exists notify_prediction_scores on public.prediction_scores;
create trigger notify_prediction_scores
  after insert or update or delete on public.prediction_scores
  for each row execute function public.notify_change();

drop trigger if exists notify_tallies on public.prediction_option_tallies;
create trigger notify_tallies
  after insert or update or delete on public.prediction_option_tallies
  for each row execute function public.notify_change();

-- ----------------------------------------------------------------------------
-- Expiración y cierre automáticos
-- ----------------------------------------------------------------------------
-- `finalize_predictions()` es idempotente y se invoca desde tres lugares para
-- que el estado sea confiable aunque falle cualquiera:
--   1. acá, por pg_cron, cada minuto (si la extensión está disponible);
--   2. `cast_vote()` y `propose_resolution()`, antes de aceptar la operación;
--   3. el servidor, con un intervalo propio y al abrir el feed de un grupo.
--
-- El punto 3 es el que garantiza que esto funcione en la imagen oficial de
-- Postgres, que no trae pg_cron.
do $$
begin
  create extension if not exists pg_cron;

  perform cron.schedule(
    'friedict-finalize-predictions',
    '* * * * *',
    $cron$ select public.finalize_predictions(); $cron$
  );
exception
  when others then
    raise notice 'pg_cron no disponible (%). El servidor lo llama por intervalo igual.', sqlerrm;
end;
$$;

-- ============================================================================
-- Cantado — Realtime + tareas programadas
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Realtime
-- ----------------------------------------------------------------------------
-- Se publican sólo las tablas cuyos cambios el cliente necesita ver en vivo.
--
-- `prediction_votes` queda deliberadamente FUERA: sus filas son privadas hasta
-- el cierre, así que los eventos de votos ajenos nunca llegarían igual (Realtime
-- aplica RLS) y los recuentos quedarían desactualizados. En su lugar el cliente
-- escucha `predictions` (participant_count) y `prediction_option_tallies`, que
-- el trigger de votos mantiene al día y cuya RLS respeta results_visibility.
alter publication supabase_realtime add table public.predictions;
alter publication supabase_realtime add table public.prediction_option_tallies;
alter publication supabase_realtime add table public.group_members;
alter publication supabase_realtime add table public.activity_events;
alter publication supabase_realtime add table public.prediction_scores;

-- REPLICA IDENTITY FULL para que los filtros por columna (group_id, prediction_id)
-- funcionen también en UPDATE y DELETE, no sólo en INSERT.
alter table public.predictions               replica identity full;
alter table public.prediction_option_tallies replica identity full;
alter table public.group_members             replica identity full;
alter table public.prediction_scores         replica identity full;

-- ----------------------------------------------------------------------------
-- Expiración y cierre automáticos
-- ----------------------------------------------------------------------------
-- `finalize_predictions()` es idempotente y se invoca desde tres lugares para que
-- el estado sea confiable aunque falle cualquiera de ellos:
--   1. pg_cron, cada minuto (acá);
--   2. `cast_vote()` y `propose_resolution()`, antes de aceptar la operación;
--   3. el cliente, al abrir el feed de un grupo.
-- pg_cron no es relocalizable: siempre se instala en su propio schema `cron`.
do $$
begin
  create extension if not exists pg_cron;

  perform cron.schedule(
    'cantado-finalize-predictions',
    '* * * * *',
    $cron$ select public.finalize_predictions(); $cron$
  );
exception
  when others then
    -- Algunos entornos (self-hosted mínimos) no traen pg_cron. No es fatal:
    -- los puntos 2 y 3 mantienen el estado correcto igual.
    raise notice 'pg_cron no disponible (%). finalize_predictions() sigue corriendo bajo demanda.', sqlerrm;
end;
$$;

-- ============================================================================
-- friedict — quórum de calificación, cierre colaborativo y cierre opcional
-- ----------------------------------------------------------------------------
-- Archivo NUEVO, aditivo. `minimum_participants` se conserva (deja de leerse,
-- pero no se borra: el rollback de esta propuesta es un revert de código puro)
-- y se agregan las columnas de porcentaje que lo reemplazan.
--
-- `closes_at` deja de ser obligatoria: una predicción puede quedar abierta
-- hasta que el grupo pida cerrarla. `qualification_deadline` sigue siendo el
-- único vencimiento automático quando no hay fecha de cierre.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Columnas nuevas
-- ----------------------------------------------------------------------------
alter table public.predictions
  add column qualification_percent smallint not null default 60
    check (qualification_percent between 1 and 100),
  add column close_percent smallint not null default 50
    check (close_percent between 1 and 100),
  add column close_request_count integer not null default 0
    check (close_request_count >= 0),
  add column closed_at timestamptz;

comment on column public.predictions.minimum_participants is
  'Retenida sin uso: la reemplaza qualification_percent. Se conserva sólo para que el rollback de esta migración sea un revert de código, no de esquema.';
comment on column public.predictions.qualification_percent is
  'Porcentaje del conteo VIVO de integrantes que hace falta para calificar. required_participants() lo traduce a una cantidad, acotada entre 1 y el conteo actual.';
comment on column public.predictions.close_percent is
  'Porcentaje de integrantes que tienen que pedir el cierre para cerrar una predicción sin fecha, vía prediction_close_requests.';
comment on column public.predictions.closed_at is
  'Momento del cierre efectivo, sea por fecha o por quórum de pedidos. Usado por score_prediction cuando closes_at es NULL.';

-- Backfill: las filas ya existentes conservan el requisito EFECTIVO que
-- tenían con minimum_participants, expresado ahora como porcentaje del
-- conteo vivo de su grupo. Sólo toca proposed/active: el resto ya no lee
-- ningún requisito de calificación.
update public.predictions p
   set qualification_percent = least(100, greatest(1,
         ceil(p.minimum_participants::numeric * 100
              / greatest(1, (select count(*) from public.group_members g where g.group_id = p.group_id)))::int))
 where p.status in ('proposed', 'active');

-- ----------------------------------------------------------------------------
-- closes_at pasa a ser opcional
-- ----------------------------------------------------------------------------
alter table public.predictions alter column closes_at drop not null;

alter table public.predictions drop constraint predictions_window;
alter table public.predictions add constraint predictions_window
  check (closes_at is null or closes_at > opens_at);

alter table public.predictions drop constraint predictions_qualification_within_window;
alter table public.predictions add constraint predictions_qualification_within_window
  check (qualification_deadline > opens_at
         and (closes_at is null or qualification_deadline <= closes_at));

-- ----------------------------------------------------------------------------
-- Cómputo del requisito: función pura, no una columna generada ni un trigger.
-- ----------------------------------------------------------------------------
-- Una columna generada no puede leer group_members (no es immutable), y un
-- trigger que recalculara en cada alta/baja de integrante escribiría la fila
-- de la predicción en cada join/leave, disparando notify_predictions de
-- sobra. En cambio, esta función toma el conteo como ARGUMENTO: es immutable,
-- se puede inlinear, y el conteo se agrega una sola vez por grupo, no una vez
-- por predicción.
--
-- El `least(p_member_count, …)` es la corrección del bug: es lo que permite
-- que un grupo de 2 personas pueda calificar una predicción. No se debe
-- quitar en ningún refactor futuro.
create or replace function public.required_participants(p_member_count integer, p_percent smallint)
returns integer language sql immutable set search_path = '' as $$
  select greatest(1, least(
    greatest(0, coalesce(p_member_count, 0)),
    ceil(greatest(0, coalesce(p_member_count, 0))::numeric * coalesce(p_percent, 60) / 100)::integer
  ));
$$;

comment on function public.required_participants(integer, smallint) is
  'Cantidad de participantes que hace falta para calificar: percent% del conteo vivo, piso 1, techo el propio conteo. El least(member_count, …) es el fix del bug de los grupos chicos.';

create or replace function public.required_close_requests(p_member_count integer, p_percent smallint)
returns integer language sql immutable set search_path = '' as $$
  select greatest(2, least(
    greatest(0, coalesce(p_member_count, 0)),
    ceil(greatest(0, coalesce(p_member_count, 0))::numeric * coalesce(p_percent, 50) / 100)::integer
  ));
$$;

comment on function public.required_close_requests(integer, smallint) is
  'Cantidad de pedidos de cierre que hacen falta para cerrar sin fecha: percent% del conteo vivo, piso 2, techo el propio conteo.';

-- Conteo estable de integrantes de un grupo, para los llamadores de una sola
-- fila (refresh_prediction_counts, cast_vote, request_close). `security
-- definer` porque también la usa notify_change() desde un trigger, que no
-- puede depender de la RLS de quien la disparó.
create or replace function public.group_member_count(p_group_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.group_members where group_id = p_group_id;
$$;

-- ----------------------------------------------------------------------------
-- prediction_close_requests
-- ----------------------------------------------------------------------------
-- Composite PK, sólo SELECT concedido, sin política de insert/update/delete:
-- toda escritura pasa por request_close()/withdraw_close_request() (estilo
-- de 100_schema.sql y 300_rls.sql).
create table public.prediction_close_requests (
  prediction_id uuid not null references public.predictions (id) on delete cascade,
  user_id       uuid not null references public.profiles (id)    on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (prediction_id, user_id)
);

create index prediction_close_requests_prediction_idx
  on public.prediction_close_requests (prediction_id);

comment on table public.prediction_close_requests is
  'Pedidos de cierre anticipado para predicciones sin fecha. Sólo puede pedir quien ya votó: pedir sin haber votado revelaría intención de voto antes de tiempo.';

grant select on public.prediction_close_requests to authenticated;
alter table public.prediction_close_requests enable row level security;

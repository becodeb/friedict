-- ============================================================================
-- friedict — funciones re-declaradas para ajustes de grupo, "los del grupo" en
-- vivo, la ventana de cambio de voto y los puntos por duración
-- ----------------------------------------------------------------------------
-- `create or replace function` con una lista de argumentos distinta crea un
-- OVERLOAD, no un reemplazo. Tres funciones cambian de firma acá
-- (`create_prediction`, `create_prediction_from_template`,
-- `required_close_requests`), así que primero se borran las tres con su lista
-- EXACTA de argumentos actual, y recién después se declaran las nuevas.
-- ============================================================================
drop function if exists public.create_prediction(
  uuid, text, text[], timestamptz, text, public.option_source, public.voting_mode,
  interval, boolean, public.results_visibility, public.votes_visibility,
  smallint, smallint, integer);
drop function if exists public.create_prediction_from_template(uuid, uuid, timestamptz, integer);
drop function if exists public.required_close_requests(integer, smallint);

-- ----------------------------------------------------------------------------
-- required_close_requests — de porcentaje-por-predicción a quórum-del-grupo
-- ----------------------------------------------------------------------------
-- El piso de 1 es intencional y es el pedido central del dueño: "con solo uno
-- alcance si confías en el grupo". No subir a 2 en ningún refactor futuro.
create or replace function public.required_close_requests(p_member_count integer, p_quorum smallint)
returns integer language sql immutable set search_path = '' as $$
  select greatest(1, least(
    greatest(1, coalesce(p_member_count, 0)),
    coalesce(p_quorum, 1)
  ));
$$;

comment on function public.required_close_requests(integer, smallint) is
  'Cantidad de pedidos de cierre que hacen falta: el quórum configurado en groups.close_request_quorum, acotado al conteo vivo de integrantes. Piso 1 en ambos extremos — nunca 2, a propósito.';

-- ----------------------------------------------------------------------------
-- "Los del grupo" en vivo
-- ----------------------------------------------------------------------------
-- Une un integrante a una predicción de tipo 'members' como una opción más.
-- Reutilizada por create_prediction, create_prediction_from_template y
-- sync_member_options: la regla de la etiqueta existe en un solo lugar.
create or replace function public.add_member_option(
  p_prediction_id uuid,
  p_member_id     uuid,
  p_created_by    uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display  text;
  v_base     text;
  v_label    text;
  v_position smallint;
  v_suffix   integer := 2;
begin
  select display_name into v_display from public.profiles where id = p_member_id;
  if v_display is null then
    return;
  end if;

  v_base  := left(btrim(v_display), 56);
  v_label := v_base;

  -- Dos integrantes con el mismo nombre no pueden violar `unique
  -- (prediction_id, label)`: se prueba "(2)".."(12)" hasta encontrar una
  -- etiqueta libre. Un re-join nunca llega acá: el on conflict de abajo lo
  -- corta antes por (prediction_id, member_id).
  while exists (
    select 1 from public.prediction_options
     where prediction_id = p_prediction_id and label = v_label
  ) and v_suffix <= 12 loop
    v_label := v_base || ' (' || v_suffix || ')';
    v_suffix := v_suffix + 1;
  end loop;

  select coalesce(max(position), -1) + 1 into v_position
    from public.prediction_options where prediction_id = p_prediction_id;

  -- Un re-join nunca crea una segunda opción: lo garantiza el índice parcial
  -- (prediction_id, member_id) de 700_, no un chequeo de aplicación.
  -- Un cambio de nombre posterior (upsert_profile) NUNCA reescribe una
  -- etiqueta ya creada: relabelearía una opción por la que ya se votó. La
  -- etiqueta es una foto del nombre al momento en que se creó la opción.
  insert into public.prediction_options (prediction_id, label, member_id, position, created_by)
  values (p_prediction_id, v_label, p_member_id, v_position, p_created_by)
  on conflict (prediction_id, member_id) where member_id is not null do nothing;
end;
$$;

comment on function public.add_member_option(uuid, uuid, uuid) is
  'Agrega a p_member_id como opción de una predicción "los del grupo". p_created_by es quién queda como autor de la fila: el creador de la predicción cuando se llama desde create_prediction*, el propio integrante cuando lo dispara su alta al grupo.';

-- Recorre las predicciones 'members' todavía abiertas del grupo y le da a
-- p_member_id una opción en cada una. Cubre tanto el alta original como un
-- re-join: en ambos casos, add_member_option() ya es idempotente por su cuenta.
create or replace function public.sync_member_options(p_group_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select id from public.predictions
     where group_id = p_group_id
       and option_type = 'members'
       and status in ('proposed', 'active')
  loop
    perform public.add_member_option(r.id, p_member_id, p_member_id);
  end loop;
end;
$$;

comment on function public.sync_member_options(uuid, uuid) is
  'Le da a p_member_id una opción en cada predicción "los del grupo" todavía abierta de p_group_id. Idempotente: llamarla de nuevo para el mismo integrante no crea opciones repetidas.';

-- Trigger y no una llamada explícita dentro de join_group(): así ningún
-- futuro camino de alta (un script de admin, db/seed.sql, un segundo flujo de
-- invitación que se agregue más adelante) puede olvidarse de darle una opción
-- al integrante nuevo. Cuesta una pasada extra por las predicciones abiertas
-- del grupo, pero un create_group() no tiene ninguna predicción todavía, así
-- que en el caso más común el loop de arriba no encuentra nada que hacer.
create or replace function public.on_member_joined()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_member_options(new.group_id, new.user_id);
  return null;
end;
$$;

drop trigger if exists group_members_sync_options on public.group_members;
create trigger group_members_sync_options
  after insert on public.group_members
  for each row execute function public.on_member_joined();

-- ----------------------------------------------------------------------------
-- update_group_settings — el único escritor de las tres columnas nuevas
-- ----------------------------------------------------------------------------
create or replace function public.update_group_settings(
  p_group_id               uuid,
  p_close_request_quorum   smallint default null,
  p_qualification_enabled  boolean  default null,
  p_qualification_percent  smallint default null
)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.groups;
  v_was boolean;
begin
  perform public.require_auth();
  -- is_group_admin() ya devuelve false para quien no es integrante
  -- (coalesce(...) en 200_functions.sql), así que un no-integrante recibe el
  -- mismo admin_only que un integrante común y no aprende nada del grupo.
  if not public.is_group_admin(p_group_id) then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  perform public.enforce_rate_limit('update_group_settings', 30, interval '1 hour');

  select qualification_enabled into v_was from public.groups where id = p_group_id;

  -- NULL-significa-sin-cambios: cada parámetro omitido conserva el valor
  -- actual de su columna.
  update public.groups
     set close_request_quorum  = coalesce(p_close_request_quorum, close_request_quorum),
         qualification_enabled = coalesce(p_qualification_enabled, qualification_enabled),
         qualification_percent = coalesce(p_qualification_percent, qualification_percent)
   where id = p_group_id
  returning * into v_row;

  -- El toggle pasó de prendido a apagado en esta misma llamada: ninguna
  -- predicción se queda esperando una puerta que ya no existe. Es UNA
  -- decisión de grupo, no N eventos "prediction_qualified" repartidos entre
  -- las predicciones liberadas.
  if v_was and not v_row.qualification_enabled then
    update public.predictions
       set status = 'active'
     where group_id = p_group_id and status = 'proposed';
  end if;

  return v_row;
end;
$$;

comment on function public.update_group_settings(uuid, smallint, boolean, smallint) is
  'Único escritor de groups.close_request_quorum / qualification_enabled / qualification_percent. admin_only. Apagar la calificación libera de inmediato toda predicción "en prueba" del grupo.';

-- ----------------------------------------------------------------------------
-- Contadores desnormalizados + auto-calificación, ahora contra el grupo
-- ----------------------------------------------------------------------------
create or replace function public.refresh_prediction_counts(p_prediction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pred         public.predictions;
  v_group        public.groups;
  v_participants integer;
  v_votes        integer;
  v_required     integer;
begin
  select * into v_pred from public.predictions where id = p_prediction_id for update;
  if not found then
    return;
  end if;
  select * into v_group from public.groups where id = v_pred.group_id;

  select count(distinct user_id), count(*)
    into v_participants, v_votes
    from public.prediction_votes
   where prediction_id = p_prediction_id;

  insert into public.prediction_option_tallies (option_id, prediction_id, vote_count, voter_count, updated_at)
  select o.id,
         o.prediction_id,
         coalesce(count(v.id), 0)::integer,
         coalesce(count(distinct v.user_id), 0)::integer,
         now()
    from public.prediction_options o
    left join public.prediction_votes v on v.option_id = o.id
   where o.prediction_id = p_prediction_id
   group by o.id, o.prediction_id
  on conflict (option_id) do update
    set vote_count  = excluded.vote_count,
        voter_count = excluded.voter_count,
        updated_at  = now();

  -- Con la calificación apagada, el requisito es 0: cualquier conteo (incluido
  -- cero) lo cumple, así que la predicción pasa a activa apenas se evalúa acá.
  v_required := case
    when not v_group.qualification_enabled then 0
    else public.required_participants(public.group_member_count(v_pred.group_id), v_group.qualification_percent)
  end;

  update public.predictions
     set participant_count = v_participants,
         vote_count        = v_votes,
         status = case
                    when status = 'proposed'
                     and (v_participants >= v_required or is_default)
                    then 'active'::public.prediction_status
                    else status
                  end
   where id = p_prediction_id;

  if v_pred.status = 'proposed'
     and not v_pred.is_default
     and v_group.qualification_enabled
     and v_participants >= v_required then
    insert into public.activity_events (group_id, prediction_id, type, payload)
    values (
      v_pred.group_id,
      p_prediction_id,
      'prediction_qualified',
      jsonb_build_object('title', v_pred.title, 'participants', v_participants)
    );
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- finalize_predictions — sin el paso de expiración. Nada vence más.
-- ----------------------------------------------------------------------------
create or replace function public.finalize_predictions(p_group_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer := 0;
  r         record;
begin
  -- 1) alcanzó el umbral del grupo, o el grupo no pide calificar, o es del
  -- sistema -> active. El paso de "venció el plazo sin gente -> expired" que
  -- vivía acá se borró entero: qualification_deadline ya no se lee.
  with counts as (
    select group_id, count(*)::integer as member_count
      from public.group_members
     where (p_group_id is null or group_id = p_group_id)
     group by group_id
  )
  update public.predictions p
     set status = 'active'
    from counts c
    join public.groups g on g.id = c.group_id
   where p.status = 'proposed'
     and c.group_id = p.group_id
     and (
           p.is_default
           or not g.qualification_enabled
           or p.participant_count >= public.required_participants(c.member_count, g.qualification_percent)
         );

  -- 2) llegó closes_at -> closed.
  for r in
    with upd as (
      update public.predictions p
         set status = 'closed', closed_at = now()
       where p.status in ('proposed', 'active')
         and p.closes_at is not null
         and p.closes_at <= now()
         and (p_group_id is null or p.group_id = p_group_id)
      returning p.id, p.group_id, p.title
    )
    select * from upd
  loop
    insert into public.activity_events (group_id, prediction_id, type, payload)
    values (r.group_id, r.id, 'prediction_closed', jsonb_build_object('title', r.title));
    v_changed := v_changed + 1;
  end loop;

  -- 3) los pedidos de cierre alcanzaron el quórum del grupo -> closed.
  for r in
    with counts as (
      select group_id, count(*)::integer as member_count
        from public.group_members
       where (p_group_id is null or group_id = p_group_id)
       group by group_id
    ), upd as (
      update public.predictions p
         set status = 'closed',
             closed_at = now(),
             close_request_count = (
               select count(*)::integer
                 from public.prediction_close_requests q
                 join public.group_members gm
                   on gm.group_id = p.group_id and gm.user_id = q.user_id
                where q.prediction_id = p.id
             )
        from counts c
        join public.groups g on g.id = c.group_id
       where p.status in ('proposed', 'active')
         and p.close_request_count > 0
         and c.group_id = p.group_id
         and (
               select count(*)::integer
                 from public.prediction_close_requests q
                 join public.group_members gm
                   on gm.group_id = p.group_id and gm.user_id = q.user_id
                where q.prediction_id = p.id
             ) >= public.required_close_requests(c.member_count, g.close_request_quorum)
      returning p.id, p.group_id, p.title
    )
    select * from upd
  loop
    insert into public.activity_events (group_id, prediction_id, type, payload)
    values (r.group_id, r.id, 'prediction_closed', jsonb_build_object('title', r.title));
    v_changed := v_changed + 1;
  end loop;

  return v_changed;
end;
$$;

-- ----------------------------------------------------------------------------
-- create_prediction — 12 argumentos: sin los tres de quórum, con la ventana
-- de cambio de voto. El estado inicial sale de groups.qualification_enabled.
-- ----------------------------------------------------------------------------
create or replace function public.create_prediction(
  p_group_id               uuid,
  p_title                  text,
  p_options                text[],
  p_closes_at              timestamptz default null,
  p_description            text default null,
  p_option_type            public.option_source default 'manual',
  p_voting_mode            public.voting_mode default 'single',
  p_vote_interval          interval default null,
  p_allow_new_options      boolean default false,
  p_results_visibility     public.results_visibility default 'on_close',
  p_votes_visibility       public.votes_visibility default 'on_close',
  p_vote_change_window     text default '15m'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := public.require_auth();
  v_group         public.groups;
  v_prediction_id uuid;
  v_opens_at      timestamptz := now();
  v_window        interval;
  v_labels        text[];
  v_label         text;
  v_position      smallint := 0;
  v_member        record;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  perform public.enforce_rate_limit('create_prediction', 20, interval '1 hour');

  select * into v_group from public.groups where id = p_group_id;

  if p_closes_at is not null and p_closes_at <= v_opens_at then
    raise exception 'closes_at_must_be_future' using errcode = '22023';
  end if;

  if p_voting_mode = 'recurring'
     and p_closes_at is not null
     and p_vote_interval is not null
     and p_closes_at - v_opens_at < p_vote_interval then
    raise exception 'interval_exceeds_window' using errcode = '22023';
  end if;

  -- vote_change_window_of() devuelve NULL tanto para 'until_close' (sin
  -- límite, válido) como para una clave desconocida (inválido): se
  -- distinguen comparando contra la clave pedida, no contra el resultado.
  v_window := public.vote_change_window_of(p_vote_change_window);
  if v_window is null and coalesce(p_vote_change_window, '15m') <> 'until_close' then
    raise exception 'invalid_vote_window' using errcode = '22023';
  end if;

  insert into public.predictions (
    group_id, created_by, title, description,
    option_type, voting_mode, vote_interval, allow_new_options,
    results_visibility, votes_visibility,
    qualification_deadline, opens_at, closes_at, vote_change_window,
    is_default, status
  )
  values (
    p_group_id, v_uid, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
    p_option_type, p_voting_mode, p_vote_interval, p_allow_new_options,
    p_results_visibility, p_votes_visibility,
    -- Nunca se escribe más: nada expira, así que no hay plazo que guardar.
    null, v_opens_at, p_closes_at, v_window,
    -- Nunca desde el cliente: una predicción de usuario siempre entra según
    -- el ajuste del grupo. Las del sistema entran por
    -- create_prediction_from_template().
    false,
    case when v_group.qualification_enabled then 'proposed'::public.prediction_status
         else 'active'::public.prediction_status end
  )
  returning id into v_prediction_id;

  if p_option_type = 'members' then
    for v_member in
      select m.user_id
        from public.group_members m
        join public.profiles pr on pr.id = m.user_id
       where m.group_id = p_group_id
       order by pr.display_name
    loop
      perform public.add_member_option(v_prediction_id, v_member.user_id, v_uid);
    end loop;
  else
    v_labels := array(
      select distinct on (btrim(x)) btrim(x)
        from unnest(p_options) as t(x)
       where btrim(x) <> ''
    );
    if array_length(v_labels, 1) is null or array_length(v_labels, 1) < 2 then
      raise exception 'needs_two_options' using errcode = '22023';
    end if;
    if array_length(v_labels, 1) > 12 then
      raise exception 'too_many_options' using errcode = '22023';
    end if;

    foreach v_label in array v_labels loop
      insert into public.prediction_options (prediction_id, label, position, created_by)
      values (v_prediction_id, v_label, v_position, v_uid);
      v_position := v_position + 1;
    end loop;
  end if;

  insert into public.activity_events (group_id, actor_id, prediction_id, type, payload)
  values (p_group_id, v_uid, v_prediction_id, 'prediction_created', jsonb_build_object('title', btrim(p_title)));

  return v_prediction_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- create_prediction_from_template — pierde p_qualification_hours: las del
-- sistema ya nacían activas y ahora nada tiene plazo que respetar.
-- ----------------------------------------------------------------------------
create or replace function public.create_prediction_from_template(
  p_group_id    uuid,
  p_template_id uuid,
  p_closes_at   timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := public.require_auth();
  v_tpl           public.prediction_templates;
  v_prediction_id uuid;
  v_opens_at      timestamptz := now();
  v_label         text;
  v_position      smallint := 0;
  v_member        record;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  perform public.enforce_rate_limit('create_prediction', 20, interval '1 hour');

  select * into v_tpl from public.prediction_templates where id = p_template_id and is_active;
  if not found then
    raise exception 'template_not_found' using errcode = '42704';
  end if;
  if p_closes_at <= v_opens_at then
    raise exception 'closes_at_must_be_future' using errcode = '22023';
  end if;

  insert into public.predictions (
    group_id, created_by, template_id, title, description,
    option_type, voting_mode, vote_interval, allow_new_options,
    results_visibility, votes_visibility,
    qualification_deadline, opens_at, closes_at,
    is_default, status
  )
  values (
    p_group_id, v_uid, v_tpl.id, v_tpl.title, v_tpl.description,
    v_tpl.option_type, v_tpl.voting_mode,
    case when v_tpl.voting_mode = 'recurring' then interval '7 days' else null end,
    false,
    'on_close', 'on_close',
    null, v_opens_at, p_closes_at,
    true, 'active'   -- las del sistema no necesitan juntar participación
  )
  returning id into v_prediction_id;

  if v_tpl.option_type = 'members' then
    for v_member in
      select m.user_id
        from public.group_members m
        join public.profiles pr on pr.id = m.user_id
       where m.group_id = p_group_id
       order by pr.display_name
    loop
      perform public.add_member_option(v_prediction_id, v_member.user_id, v_uid);
    end loop;
  else
    foreach v_label in array v_tpl.options loop
      insert into public.prediction_options (prediction_id, label, position, created_by)
      values (v_prediction_id, v_label, v_position, v_uid);
      v_position := v_position + 1;
    end loop;
  end if;

  if (select count(*) from public.prediction_options where prediction_id = v_prediction_id) < 2 then
    raise exception 'needs_two_options' using errcode = '22023';
  end if;

  insert into public.activity_events (group_id, actor_id, prediction_id, type, payload)
  values (p_group_id, v_uid, v_prediction_id, 'prediction_created', jsonb_build_object('title', v_tpl.title));

  return v_prediction_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- cast_vote — el candado de la ventana de cambio, en la rama single nomás.
-- ----------------------------------------------------------------------------
create or replace function public.cast_vote(
  p_prediction_id uuid,
  p_option_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := public.require_auth();
  v_pred     public.predictions;
  v_cycle    smallint;
  v_existing public.prediction_votes;
begin
  select * into v_pred from public.predictions where id = p_prediction_id;
  if not found then
    raise exception 'prediction_not_found' using errcode = '42704';
  end if;
  if not public.is_group_member(v_pred.group_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  perform public.enforce_rate_limit('cast_vote', 240, interval '1 hour');

  perform public.finalize_predictions(v_pred.group_id);
  select * into v_pred from public.predictions where id = p_prediction_id;

  if v_pred.status not in ('proposed', 'active') then
    raise exception 'voting_closed' using errcode = '22023';
  end if;
  if v_pred.closes_at is not null and now() >= v_pred.closes_at then
    raise exception 'voting_closed' using errcode = '22023';
  end if;
  if now() < v_pred.opens_at then
    raise exception 'voting_not_open' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.prediction_options
     where id = p_option_id and prediction_id = p_prediction_id
  ) then
    raise exception 'invalid_option' using errcode = '22023';
  end if;

  v_cycle := public.current_cycle(v_pred.opens_at, v_pred.vote_interval);

  if v_pred.voting_mode = 'single' then
    select * into v_existing from public.prediction_votes
     where prediction_id = p_prediction_id and user_id = v_uid and cycle = 0;

    -- El candado gobierna CAMBIOS, nunca el primer voto: sin fila previa
    -- (`not found`), esta rama no se evalúa y el insert de abajo sigue de
    -- largo. `vote_change_window is null` = "hasta el cierre", el mismo
    -- idioma que closes_at/expires_at ya usan acá para "sin tope".
    if found
       and v_pred.vote_change_window is not null
       and now() > v_existing.first_cast_at + v_pred.vote_change_window then
      raise exception 'vote_locked' using errcode = '22023';
    end if;

    insert into public.prediction_votes (prediction_id, option_id, user_id, cycle)
    values (p_prediction_id, p_option_id, v_uid, 0)
    on conflict (prediction_id, user_id, cycle)
      do update set
        option_id  = excluded.option_id,
        updated_at = now(),
        -- option_selected_at se mueve SÓLO cuando la opción de verdad cambia:
        -- un re-voto idéntico no la toca, así que sostener la misma opción no
        -- castiga a nadie. first_cast_at NUNCA aparece acá — es el ancla de
        -- seguridad de la ventana de cambio; si se reescribiera, re-votar
        -- cada pocos minutos mantendría la ventana abierta para siempre, el
        -- mismo exploit con otra cara.
        option_selected_at = case
          when excluded.option_id is distinct from public.prediction_votes.option_id
            then now()
          else public.prediction_votes.option_selected_at
        end;
  else
    -- Evolutiva: un voto nuevo por ciclo, sin borrar el historial. La
    -- ventana de cambio no aplica acá — cycle_vote_used ya es un candado
    -- duro por ronda, independiente de vote_change_window.
    begin
      insert into public.prediction_votes (prediction_id, option_id, user_id, cycle)
      values (p_prediction_id, p_option_id, v_uid, v_cycle);
    exception when unique_violation then
      raise exception 'cycle_vote_used' using errcode = '22023';
    end;
  end if;

  select * into v_pred from public.predictions where id = p_prediction_id;

  return jsonb_build_object(
    'status',            v_pred.status,
    'participant_count', v_pred.participant_count,
    'vote_count',        v_pred.vote_count,
    'cycle',             v_cycle,
    'next_cycle_at',     case
                           when v_pred.vote_interval is null then null
                           else v_pred.opens_at + (v_cycle + 1) * v_pred.vote_interval
                         end
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- score_prediction — anticipación desde option_selected_at, base escalada
-- por cuánto duró REALMENTE la predicción.
-- ----------------------------------------------------------------------------
create or replace function public.score_prediction(p_prediction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pred         public.predictions;
  v_close        timestamptz;
  v_actual_close timestamptz;
  v_duration     numeric;
  v_total_votes  integer;
  v_winner_votes integer;
  v_share        numeric;
  v_span         numeric;
  r              record;
begin
  select * into v_pred from public.predictions where id = p_prediction_id;
  if v_pred.resolved_option_id is null then
    raise exception 'not_resolved' using errcode = '22023';
  end if;

  -- v_close: horizonte PLANEADO para la anticipación. Exactamente igual que
  -- antes — no lo toca este cambio.
  v_close := coalesce(v_pred.closes_at, v_pred.closed_at, v_pred.resolved_at, now());

  -- v_actual_close: lo que la predicción duró DE VERDAD, para escalar la
  -- base por duración. Se mantiene separado de v_close a propósito: mezclar
  -- los dos cambiaría en silencio la anticipación de toda predicción con
  -- fecha, que sigue midiéndose contra el horizonte planeado.
  v_actual_close := coalesce(v_pred.closed_at, v_pred.resolved_at, now());
  v_duration := public.duration_multiplier(v_actual_close - v_pred.opens_at);

  select count(*) into v_total_votes
    from public.prediction_votes where prediction_id = p_prediction_id;
  select count(*) into v_winner_votes
    from public.prediction_votes
   where prediction_id = p_prediction_id and option_id = v_pred.resolved_option_id;

  v_share := case when v_total_votes = 0 then 1 else v_winner_votes::numeric / v_total_votes end;
  v_span  := greatest(1, extract(epoch from (v_close - v_pred.opens_at)));

  delete from public.prediction_scores where prediction_id = p_prediction_id;

  for r in
    select
      v.user_id,
      count(*)                                                        as votes_total,
      count(*) filter (where v.option_id = v_pred.resolved_option_id) as votes_winner,
      -- option_selected_at, NO created_at: cuándo la persona se quedó con la
      -- opción ganadora, no cuándo votó por primera vez (a cualquier
      -- opción). Este es el cierre de la segunda mitad del exploit de
      -- cambiar el voto — ver 705_vote_window_and_scoring.sql.
      min(v.option_selected_at) filter (where v.option_id = v_pred.resolved_option_id) as first_winner_at
    from public.prediction_votes v
   where v.prediction_id = p_prediction_id
   group by v.user_id
  loop
    declare
      v_correct    boolean := r.votes_winner > 0;
      v_early      numeric := 0;
      v_conviction numeric := 0;
      v_rarity     numeric := 1;
      v_points     integer := 0;
    begin
      if v_correct then
        v_early := greatest(0, least(1,
          extract(epoch from (v_close - r.first_winner_at)) / v_span
        ));
        v_conviction := r.votes_winner::numeric / r.votes_total;
        v_rarity := case when v_total_votes < 4 then 1.0
                         else least(1.80, 1.0 + (1.0 - v_share) * 0.8) end;
        -- calculate_points() no se toca: sigue recibiendo un entero de base,
        -- ahora escalado por la duración en vez de un 100 fijo.
        v_points := public.calculate_points(
          round(100 * v_duration)::integer, v_share, v_total_votes, v_early, v_conviction
        );
      end if;

      insert into public.prediction_scores (
        prediction_id, user_id, group_id, points, correct,
        rarity_multiplier, early_multiplier, conviction_multiplier, duration_multiplier
      )
      values (
        p_prediction_id, r.user_id, v_pred.group_id, v_points, v_correct,
        round(v_rarity, 2),
        round(1.0 + 0.25 * v_early, 2),
        round(case when v_correct then 0.5 + 0.5 * v_conviction else 0 end, 2),
        v_duration
      );
    end;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- notify_change — required_participants sale del grupo, no de la fila.
-- ----------------------------------------------------------------------------
create or replace function public.notify_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_json    jsonb := to_jsonb(coalesce(new, old));
  v_group   uuid;
  v_payload jsonb;
  v_gset    record;
begin
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
    select qualification_enabled, qualification_percent into v_gset
      from public.groups where id = v_group;

    v_payload := v_payload || jsonb_build_object(
      'prediction_id', v_json->>'id',
      'title', v_json->>'title',
      'status', v_json->>'status',
      'required_participants', case
        when not coalesce(v_gset.qualification_enabled, false) then 0
        else public.required_participants(public.group_member_count(v_group), v_gset.qualification_percent)
      end,
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

-- ----------------------------------------------------------------------------
-- Cierre colaborativo — contra groups.close_request_quorum.
-- ----------------------------------------------------------------------------
create or replace function public.request_close(p_prediction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := public.require_auth();
  v_pred         public.predictions;
  v_quorum       smallint;
  v_member_count integer;
  v_required     integer;
  v_requests     integer;
  v_closed       boolean := false;
begin
  select * into v_pred from public.predictions where id = p_prediction_id;
  if not found then
    raise exception 'prediction_not_found' using errcode = '42704';
  end if;
  if not public.is_group_member(v_pred.group_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  perform public.enforce_rate_limit('request_close', 30, interval '1 hour');
  perform public.finalize_predictions(v_pred.group_id);

  select * into v_pred from public.predictions where id = p_prediction_id for update;

  if v_pred.status not in ('proposed', 'active') then
    raise exception 'voting_closed' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.prediction_votes
     where prediction_id = p_prediction_id and user_id = v_uid
  ) then
    raise exception 'must_vote_first' using errcode = '42501';
  end if;

  insert into public.prediction_close_requests (prediction_id, user_id)
  values (p_prediction_id, v_uid)
  on conflict (prediction_id, user_id) do nothing;

  select close_request_quorum into v_quorum from public.groups where id = v_pred.group_id;
  v_member_count := public.group_member_count(v_pred.group_id);

  select count(*) into v_requests
    from public.prediction_close_requests q
    join public.group_members gm
      on gm.group_id = v_pred.group_id and gm.user_id = q.user_id
   where q.prediction_id = p_prediction_id;

  v_required := public.required_close_requests(v_member_count, v_quorum);

  update public.predictions
     set close_request_count = v_requests
   where id = p_prediction_id;

  if v_requests >= v_required then
    update public.predictions
       set status = 'closed', closed_at = now()
     where id = p_prediction_id;

    insert into public.activity_events (group_id, prediction_id, type, payload)
    values (v_pred.group_id, p_prediction_id, 'prediction_closed', jsonb_build_object('title', v_pred.title));

    v_closed := true;
  end if;

  return jsonb_build_object('requests', v_requests, 'required', v_required, 'closed', v_closed);
end;
$$;

create or replace function public.withdraw_close_request(p_prediction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := public.require_auth();
  v_pred     public.predictions;
  v_quorum   smallint;
  v_requests integer;
  v_required integer;
begin
  select * into v_pred from public.predictions where id = p_prediction_id for update;
  if not found then
    raise exception 'prediction_not_found' using errcode = '42704';
  end if;
  if not public.is_group_member(v_pred.group_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  -- Retirar el pedido nunca reabre: si ya cerró, no hay nada que deshacer.
  if v_pred.status not in ('proposed', 'active') then
    raise exception 'voting_closed' using errcode = '22023';
  end if;

  delete from public.prediction_close_requests
   where prediction_id = p_prediction_id and user_id = v_uid;

  select close_request_quorum into v_quorum from public.groups where id = v_pred.group_id;

  select count(*) into v_requests
    from public.prediction_close_requests q
    join public.group_members gm
      on gm.group_id = v_pred.group_id and gm.user_id = q.user_id
   where q.prediction_id = p_prediction_id;

  v_required := public.required_close_requests(
    public.group_member_count(v_pred.group_id), v_quorum
  );

  update public.predictions
     set close_request_count = v_requests
   where id = p_prediction_id;

  return jsonb_build_object('requests', v_requests, 'required', v_required, 'closed', false);
end;
$$;

-- ----------------------------------------------------------------------------
-- Última sentencia del archivo: todos los grupos arrancan con la calificación
-- apagada (default de la columna nueva), así que ninguna predicción
-- 'proposed' preexistente puede quedar esperando una puerta que ya nadie le
-- pide que cruce.
-- ----------------------------------------------------------------------------
update public.predictions set status = 'active' where status = 'proposed';

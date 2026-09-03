-- ============================================================================
-- friedict — funciones re-declaradas para el quórum y el cierre opcional
-- ----------------------------------------------------------------------------
-- `create or replace function` con una lista de argumentos distinta crea un
-- OVERLOAD, no un reemplazo. `create_prediction` es la única función cuya
-- firma cambia acá, así que primero se borra la vieja con su lista EXACTA de
-- argumentos, y recién después se declara la nueva. Sin este drop, quedarían
-- dos `create_prediction` conviviendo y el servidor llamaría a cualquiera de
-- las dos según cómo Postgres resuelva la sobrecarga.
-- ============================================================================
drop function if exists public.create_prediction(
  uuid, text, text[], timestamptz, text, public.option_source, public.voting_mode,
  interval, boolean, public.results_visibility, public.votes_visibility, smallint, integer);

-- ----------------------------------------------------------------------------
-- Contadores desnormalizados + auto-calificación (usa required_participants)
-- ----------------------------------------------------------------------------
create or replace function public.refresh_prediction_counts(p_prediction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pred         public.predictions;
  v_participants integer;
  v_votes        integer;
  v_required     integer;
begin
  select * into v_pred from public.predictions where id = p_prediction_id for update;
  if not found then
    return;
  end if;

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

  v_required := public.required_participants(
    public.group_member_count(v_pred.group_id),
    v_pred.qualification_percent
  );

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

  -- Momento "listo, esta predicción queda": se emite una única vez.
  if v_pred.status = 'proposed'
     and not v_pred.is_default
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
-- Transiciones de estado por tiempo
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
  -- 1) "En prueba" sin participación suficiente y con el plazo vencido -> expired.
  -- El requisito se compara contra el conteo VIVO del grupo, no un mínimo fijo.
  for r in
    with counts as (
      select group_id, count(*)::integer as member_count
        from public.group_members
       where (p_group_id is null or group_id = p_group_id)
       group by group_id
    ), upd as (
      update public.predictions p
         set status = 'expired'
        from counts c
       where p.status = 'proposed'
         and p.is_default = false
         and p.qualification_deadline <= now()
         and c.group_id = p.group_id
         and p.participant_count < public.required_participants(c.member_count, p.qualification_percent)
      returning p.id, p.group_id, p.title
    )
    select * from upd
  loop
    insert into public.activity_events (group_id, prediction_id, type, payload)
    values (r.group_id, r.id, 'prediction_expired', jsonb_build_object('title', r.title));
    v_changed := v_changed + 1;
  end loop;

  -- 2) alcanzó el umbral (o es del sistema) -> active
  with counts as (
    select group_id, count(*)::integer as member_count
      from public.group_members
     where (p_group_id is null or group_id = p_group_id)
     group by group_id
  )
  update public.predictions p
     set status = 'active'
    from counts c
   where p.status = 'proposed'
     and c.group_id = p.group_id
     and (p.participant_count >= public.required_participants(c.member_count, p.qualification_percent) or p.is_default);

  -- 3) llegó closes_at -> closed. `closes_at is not null and closes_at <= now()`
  -- se escribe explícito para no depender de la lógica de tres valores: con
  -- closes_at NULL, la comparación da NULL y la fila no matchea igual, pero
  -- dejarlo implícito escondería la decisión.
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

  -- 4) los pedidos de cierre alcanzaron el quórum -> closed. La columna
  -- `close_request_count` es sólo un GATE barato (evita el join correlacionado
  -- en el 99% de las filas, que nunca tuvieron un pedido); el join contra
  -- group_members es la AUTORIDAD real, así que un pedido de alguien que ya se
  -- fue del grupo deja de contar solo, sin ningún hook de limpieza en
  -- leave_group/remove_member.
  -- Nota de implementación: un LATERAL en el FROM de un UPDATE no puede leer
  -- la tabla destino (Postgres la resuelve fuera del from_list), así que el
  -- conteo en vivo va como subconsulta correlacionada en SET y en WHERE — la
  -- misma subconsulta dos veces, pero sigue costando cero para casi todas las
  -- filas gracias al gate de `close_request_count > 0`.
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
       where p.status in ('proposed', 'active')
         and p.close_request_count > 0
         and c.group_id = p.group_id
         and (
               select count(*)::integer
                 from public.prediction_close_requests q
                 join public.group_members gm
                   on gm.group_id = p.group_id and gm.user_id = q.user_id
                where q.prediction_id = p.id
             ) >= public.required_close_requests(c.member_count, p.close_percent)
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
-- create_prediction — nueva firma: porcentajes en vez de minimum_participants,
-- p_closes_at ahora opcional.
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
  p_qualification_percent  smallint default 60,
  p_close_percent          smallint default 50,
  p_qualification_hours    integer default 48
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := public.require_auth();
  v_prediction_id uuid;
  v_opens_at      timestamptz := now();
  v_qualification timestamptz;
  v_labels        text[];
  v_label         text;
  v_position      smallint := 0;
  v_member        record;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  perform public.enforce_rate_limit('create_prediction', 20, interval '1 hour');

  if p_closes_at is not null and p_closes_at <= v_opens_at then
    raise exception 'closes_at_must_be_future' using errcode = '22023';
  end if;

  -- Una evolutiva cuyo intervalo no entra en la ventana da exactamente una
  -- ronda truncada: el modo deja de significar nada. El cliente ya lo valida
  -- con Zod, pero la validación del cliente es una cortesía — cualquiera
  -- puede pegarle al RPC directo, así que la regla vive también acá.
  -- Sin fecha de cierre no hay ventana que respetar: las rondas siguen.
  if p_voting_mode = 'recurring'
     and p_closes_at is not null
     and p_vote_interval is not null
     and p_closes_at - v_opens_at < p_vote_interval then
    raise exception 'interval_exceeds_window' using errcode = '22023';
  end if;

  -- El plazo de calificación nunca puede pasarse del cierre. Sin cierre, es
  -- simplemente opens_at + qualification_hours: para una predicción abierta,
  -- es el único vencimiento automático que existe.
  v_qualification := case
    when p_closes_at is null
      then v_opens_at + make_interval(hours => greatest(1, p_qualification_hours))
    else least(v_opens_at + make_interval(hours => greatest(1, p_qualification_hours)), p_closes_at)
  end;

  insert into public.predictions (
    group_id, created_by, title, description,
    option_type, voting_mode, vote_interval, allow_new_options,
    results_visibility, votes_visibility,
    qualification_percent, close_percent, qualification_deadline, opens_at, closes_at,
    is_default
  )
  values (
    p_group_id, v_uid, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
    p_option_type, p_voting_mode, p_vote_interval, p_allow_new_options,
    p_results_visibility, p_votes_visibility,
    coalesce(p_qualification_percent, 60), coalesce(p_close_percent, 50),
    v_qualification, v_opens_at, p_closes_at,
    -- Nunca desde el cliente: una predicción de usuario siempre tiene que
    -- ganarse su lugar. Las del sistema entran por create_prediction_from_template().
    false
  )
  returning id into v_prediction_id;

  if p_option_type = 'members' then
    -- Las opciones son los integrantes del grupo en el momento de crearla.
    for v_member in
      select m.user_id, pr.display_name
        from public.group_members m
        join public.profiles pr on pr.id = m.user_id
       where m.group_id = p_group_id
       order by pr.display_name
    loop
      insert into public.prediction_options (prediction_id, label, member_id, position, created_by)
      values (v_prediction_id, v_member.display_name, v_member.user_id, v_position, v_uid);
      v_position := v_position + 1;
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
-- add_prediction_option — closes_at ahora puede ser NULL: `false or NULL` es
-- NULL en SQL, así que la comparación se escribe explícita.
-- ----------------------------------------------------------------------------
create or replace function public.add_prediction_option(
  p_prediction_id uuid,
  p_label         text
)
returns public.prediction_options
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := public.require_auth();
  v_pred public.predictions;
  v_row  public.prediction_options;
  v_max  smallint;
begin
  select * into v_pred from public.predictions where id = p_prediction_id;
  if not found then
    raise exception 'prediction_not_found' using errcode = '42704';
  end if;
  if not public.is_group_member(v_pred.group_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if not v_pred.allow_new_options then
    raise exception 'options_locked' using errcode = '42501';
  end if;
  if v_pred.status not in ('proposed', 'active')
     or (v_pred.closes_at is not null and v_pred.closes_at <= now()) then
    raise exception 'voting_closed' using errcode = '22023';
  end if;
  if (select count(*) from public.prediction_options where prediction_id = p_prediction_id) >= 12 then
    raise exception 'too_many_options' using errcode = '22023';
  end if;

  select coalesce(max(position), -1) into v_max
    from public.prediction_options where prediction_id = p_prediction_id;

  insert into public.prediction_options (prediction_id, label, position, created_by)
  values (p_prediction_id, btrim(p_label), v_max + 1, v_uid)
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- Votar — closes_at NULL-safe: `if NULL then` es false en plpgsql, así que
-- con cierre abierto el voto siempre pasa esta comprobación.
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
  v_uid   uuid := public.require_auth();
  v_pred  public.predictions;
  v_cycle smallint;
begin
  select * into v_pred from public.predictions where id = p_prediction_id;
  if not found then
    raise exception 'prediction_not_found' using errcode = '42704';
  end if;
  if not public.is_group_member(v_pred.group_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  perform public.enforce_rate_limit('cast_vote', 240, interval '1 hour');

  -- Reevaluar estados por tiempo antes de aceptar nada.
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
    -- Clásica: un voto, modificable hasta el cierre.
    insert into public.prediction_votes (prediction_id, option_id, user_id, cycle)
    values (p_prediction_id, p_option_id, v_uid, 0)
    on conflict (prediction_id, user_id, cycle)
      do update set option_id = excluded.option_id, updated_at = now();
  else
    -- Evolutiva: un voto nuevo por ciclo, sin borrar el historial.
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
-- score_prediction — el arreglo de la anticipación en predicciones abiertas.
-- ----------------------------------------------------------------------------
-- `greatest(1, extract(epoch from (NULL - opens_at)))` valía 1 (greatest
-- IGNORA los NULL), así que con closes_at nulo el "tramo" completo de la
-- predicción colapsaba a un segundo y absolutamente todo el mundo recibía el
-- multiplicador de anticipación máximo. El arreglo puntúa contra el cierre
-- REAL, sea por fecha, por quórum de pedidos o, como último recurso, ahora.
create or replace function public.score_prediction(p_prediction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pred         public.predictions;
  v_close        timestamptz;
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

  v_close := coalesce(v_pred.closes_at, v_pred.closed_at, v_pred.resolved_at, now());

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
      count(*)                                                     as votes_total,
      count(*) filter (where v.option_id = v_pred.resolved_option_id) as votes_winner,
      min(v.created_at) filter (where v.option_id = v_pred.resolved_option_id) as first_winner_at
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
        -- 1 = acertó apenas abrió; 0 = acertó justo sobre el cierre.
        v_early := greatest(0, least(1,
          extract(epoch from (v_close - r.first_winner_at)) / v_span
        ));
        v_conviction := r.votes_winner::numeric / r.votes_total;
        v_rarity := case when v_total_votes < 4 then 1.0
                         else least(1.80, 1.0 + (1.0 - v_share) * 0.8) end;
        v_points := public.calculate_points(100, v_share, v_total_votes, v_early, v_conviction);
      end if;

      insert into public.prediction_scores (
        prediction_id, user_id, group_id, points, correct,
        rarity_multiplier, early_multiplier, conviction_multiplier
      )
      values (
        p_prediction_id, r.user_id, v_pred.group_id, v_points, v_correct,
        round(v_rarity, 2),
        round(1.0 + 0.25 * v_early, 2),
        round(case when v_correct then 0.5 + 0.5 * v_conviction else 0 end, 2)
      );
    end;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- notify_change — el aviso en vivo ahora manda required_participants, no el
-- minimum_participants crudo que ya no se lee.
-- ----------------------------------------------------------------------------
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
    v_payload := v_payload || jsonb_build_object(
      'prediction_id', v_json->>'id',
      'title', v_json->>'title',
      'status', v_json->>'status',
      'required_participants', public.required_participants(
        public.group_member_count(v_group),
        nullif(v_json->>'qualification_percent', '')::smallint
      ),
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
-- Cierre colaborativo
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

  -- Reevaluar estados por tiempo antes de aceptar nada, igual que cast_vote.
  perform public.finalize_predictions(v_pred.group_id);

  -- El lock serializa a dos pedidos concurrentes que completarían el quórum a
  -- la vez: el segundo espera al primero y ve el conteo ya actualizado, así
  -- que sólo uno de los dos cierra la predicción y emite un único evento.
  select * into v_pred from public.predictions where id = p_prediction_id for update;

  if v_pred.status not in ('proposed', 'active') then
    raise exception 'voting_closed' using errcode = '22023';
  end if;

  -- Pedir sin haber votado revelaría intención de voto antes del cierre: la
  -- garantía que promete ParticipationThreshold es que nadie sabe quién votó
  -- hasta que se revela.
  if not exists (
    select 1 from public.prediction_votes
     where prediction_id = p_prediction_id and user_id = v_uid
  ) then
    raise exception 'must_vote_first' using errcode = '42501';
  end if;

  insert into public.prediction_close_requests (prediction_id, user_id)
  values (p_prediction_id, v_uid)
  on conflict (prediction_id, user_id) do nothing;

  v_member_count := public.group_member_count(v_pred.group_id);

  select count(*) into v_requests
    from public.prediction_close_requests q
    join public.group_members gm
      on gm.group_id = v_pred.group_id and gm.user_id = q.user_id
   where q.prediction_id = p_prediction_id;

  v_required := public.required_close_requests(v_member_count, v_pred.close_percent);

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

  select count(*) into v_requests
    from public.prediction_close_requests q
    join public.group_members gm
      on gm.group_id = v_pred.group_id and gm.user_id = q.user_id
   where q.prediction_id = p_prediction_id;

  v_required := public.required_close_requests(
    public.group_member_count(v_pred.group_id), v_pred.close_percent
  );

  update public.predictions
     set close_request_count = v_requests
   where id = p_prediction_id;

  return jsonb_build_object('requests', v_requests, 'required', v_required, 'closed', false);
end;
$$;

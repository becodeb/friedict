-- ============================================================================
-- friedict — lógica de dominio
-- ----------------------------------------------------------------------------
-- Toda regla que afecte la integridad del juego vive acá, no en la UI:
--   * quién puede votar y hasta cuándo
--   * un voto por ciclo
--   * umbral de participación y expiración
--   * resolución con confirmación comunitaria
--   * cálculo de puntos
-- Todas las funciones SECURITY DEFINER usan `search_path = ''` y nombres
-- calificados, para que no puedan ser secuestradas por un search_path hostil.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helpers de autorización (SECURITY DEFINER para evitar recursión en RLS)
-- ----------------------------------------------------------------------------
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id and m.user_id = (select public.current_user_id())
  );
$$;

create or replace function public.group_role(p_group_id uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.group_members m
  where m.group_id = p_group_id and m.user_id = (select public.current_user_id());
$$;

-- El `coalesce` NO es defensivo de más: para quien no es integrante,
-- `group_role()` devuelve NULL, y `NULL in ('owner','admin')` vale NULL, no
-- false. Sin esto, un `if not public.is_group_admin(...) then raise` evalúa
-- `not NULL` = NULL, no entra al branch, y la comprobación de permisos queda
-- desactivada en silencio.
create or replace function public.is_group_admin(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.group_role(p_group_id) in ('owner', 'admin'), false);
$$;

create or replace function public.require_auth()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select public.current_user_id());
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;
  return v_uid;
end;
$$;

-- ----------------------------------------------------------------------------
-- Rate limiting
-- ----------------------------------------------------------------------------
create or replace function public.enforce_rate_limit(
  p_bucket text,
  p_max    integer,
  p_window interval
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := (select public.current_user_id());
  v_window_start timestamptz;
  v_count        integer;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window)
  );

  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (v_uid, p_bucket, v_window_start, 1)
  on conflict (user_id, bucket, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;

  if v_count > p_max then
    raise exception 'rate_limited' using errcode = '53400';
  end if;

  delete from public.rate_limits
   where user_id = v_uid and window_start < now() - interval '1 day';
end;
$$;

-- ----------------------------------------------------------------------------
-- Puntaje — función pura, espejo exacto de src/lib/scoring.ts
-- ----------------------------------------------------------------------------
-- points = base
--        × rareza      (1.00 … 1.80, sólo con muestra >= 4 votos)
--        × anticipación(1.00 … 1.25)
--        × convicción  (0.50 … 1.00, proporción de tus votos en la ganadora)
-- Techo: 100 × 1.8 × 1.25 × 1.0 = 225. Piso de un acierto: 50. Nunca negativo.
create or replace function public.calculate_points(
  p_base              integer,
  p_winner_share      numeric,  -- votos a la ganadora / votos totales   [0..1]
  p_sample_size       integer,  -- votos totales al cierre
  p_early_ratio       numeric,  -- 1 = votó apenas abrió, 0 = votó sobre el cierre
  p_conviction_ratio  numeric   -- votos propios en la ganadora / votos propios
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(0, round(
      p_base
    * case
        when p_sample_size < 4 then 1.0
        else least(1.80, 1.0 + (1.0 - least(1.0, greatest(0.0, p_winner_share))) * 0.8)
      end
    * (1.0 + 0.25 * least(1.0, greatest(0.0, p_early_ratio)))
    * (0.50 + 0.50 * least(1.0, greatest(0.0, p_conviction_ratio)))
  ))::integer;
$$;

comment on function public.calculate_points is
  'Fórmula de puntos. Debe mantenerse idéntica a calculatePoints() en src/lib/scoring.ts; el test de integración scoring-parity la compara contra una grilla de casos.';

-- ----------------------------------------------------------------------------
-- Ciclos de votación
-- ----------------------------------------------------------------------------
create or replace function public.current_cycle(
  p_opens_at timestamptz,
  p_interval interval,
  p_at       timestamptz default now()
)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_interval is null then 0::smallint
    else greatest(0, floor(
      extract(epoch from (p_at - p_opens_at)) / nullif(extract(epoch from p_interval), 0)
    ))::smallint
  end;
$$;

-- ----------------------------------------------------------------------------
-- Token de invitación: 32 chars base32 sin caracteres ambiguos = 160 bits
-- ----------------------------------------------------------------------------
create or replace function public.generate_invite_token()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  v_bytes  bytea := public.gen_random_bytes(32);
  v_token  text := '';
  i        integer;
begin
  for i in 0..31 loop
    v_token := v_token || substr(alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_token;
end;
$$;

-- ----------------------------------------------------------------------------
-- Contadores desnormalizados + auto-calificación
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

  update public.predictions
     set participant_count = v_participants,
         vote_count        = v_votes,
         status = case
                    when status = 'proposed'
                     and (v_participants >= minimum_participants or is_default)
                    then 'active'::public.prediction_status
                    else status
                  end
   where id = p_prediction_id;

  -- Momento "listo, esta predicción queda": se emite una única vez.
  if v_pred.status = 'proposed'
     and not v_pred.is_default
     and v_participants >= v_pred.minimum_participants then
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

create or replace function public.on_vote_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_prediction_counts(coalesce(new.prediction_id, old.prediction_id));
  return null;
end;
$$;

create trigger prediction_votes_refresh
  after insert or update or delete on public.prediction_votes
  for each row execute function public.on_vote_changed();

-- Toda opción arranca con su fila de tally en cero.
create or replace function public.on_option_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.prediction_option_tallies (option_id, prediction_id)
  values (new.id, new.prediction_id)
  on conflict (option_id) do nothing;
  return new;
end;
$$;

create trigger prediction_options_tally
  after insert on public.prediction_options
  for each row execute function public.on_option_created();

-- ----------------------------------------------------------------------------
-- Transiciones de estado por tiempo
-- ----------------------------------------------------------------------------
-- Idempotente. Se invoca desde pg_cron, desde cast_vote y al abrir el feed.
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
  -- 1) "En prueba" sin participación suficiente y con el plazo vencido -> expired
  for r in
    with upd as (
      update public.predictions p
         set status = 'expired'
       where p.status = 'proposed'
         and p.is_default = false
         and p.qualification_deadline <= now()
         and p.participant_count < p.minimum_participants
         and (p_group_id is null or p.group_id = p_group_id)
      returning p.id, p.group_id, p.title
    )
    select * from upd
  loop
    insert into public.activity_events (group_id, prediction_id, type, payload)
    values (r.group_id, r.id, 'prediction_expired', jsonb_build_object('title', r.title));
    v_changed := v_changed + 1;
  end loop;

  -- 2) alcanzó el umbral (o es del sistema) -> active
  update public.predictions p
     set status = 'active'
   where p.status = 'proposed'
     and (p.participant_count >= p.minimum_participants or p.is_default)
     and (p_group_id is null or p.group_id = p_group_id);

  -- 3) llegó closes_at -> closed
  for r in
    with upd as (
      update public.predictions p
         set status = 'closed'
       where p.status in ('proposed', 'active')
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

  return v_changed;
end;
$$;

-- ----------------------------------------------------------------------------
-- Perfil
-- ----------------------------------------------------------------------------
create or replace function public.upsert_profile(
  p_display_name text,
  p_avatar_seed  text default null,
  p_accent       smallint default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_auth();
  v_row public.profiles;
begin
  insert into public.profiles (id, display_name, avatar_seed, accent)
  values (
    v_uid,
    btrim(p_display_name),
    coalesce(nullif(btrim(p_avatar_seed), ''), left(btrim(p_display_name), 2)),
    coalesce(p_accent, (abs(hashtext(v_uid::text)) % 8)::smallint)
  )
  on conflict (id) do update
    set display_name = btrim(p_display_name),
        avatar_seed  = coalesce(nullif(btrim(p_avatar_seed), ''), public.profiles.avatar_seed),
        accent       = coalesce(p_accent, public.profiles.accent)
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grupos
-- ----------------------------------------------------------------------------
create or replace function public.create_group(
  p_name         text,
  p_display_name text,
  p_avatar_seed  text default null,
  p_accent       smallint default null
)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := public.require_auth();
  v_group public.groups;
begin
  perform public.enforce_rate_limit('create_group', 5, interval '1 hour');
  perform public.upsert_profile(p_display_name, p_avatar_seed, p_accent);

  insert into public.groups (name, created_by)
  values (btrim(p_name), v_uid)
  returning * into v_group;

  insert into public.group_members (group_id, user_id, role)
  values (v_group.id, v_uid, 'owner');

  insert into public.activity_events (group_id, actor_id, type, payload)
  values (v_group.id, v_uid, 'member_joined', jsonb_build_object('name', btrim(p_display_name)));

  return v_group;
end;
$$;

create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := public.require_auth();
  v_role public.member_role := public.group_role(p_group_id);
begin
  if v_role is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if v_role = 'owner' then
    raise exception 'owner_cannot_leave' using errcode = '42501';
  end if;

  delete from public.group_members where group_id = p_group_id and user_id = v_uid;
end;
$$;

create or replace function public.update_member_role(
  p_group_id uuid,
  p_user_id  uuid,
  p_role     public.member_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.require_auth();
begin
  -- `is distinct from` en lugar de `<>` por el mismo motivo que el coalesce de
  -- is_group_admin: `NULL <> 'owner'` es NULL y dejaría pasar a un extraño.
  if public.group_role(p_group_id) is distinct from 'owner' then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'ownership_transfer_unsupported' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'cannot_change_own_role' using errcode = '42501';
  end if;

  update public.group_members
     set role = p_role
   where group_id = p_group_id and user_id = p_user_id and role <> 'owner';
end;
$$;

create or replace function public.remove_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_auth();
  if not public.is_group_admin(p_group_id) then
    raise exception 'admin_only' using errcode = '42501';
  end if;

  delete from public.group_members
   where group_id = p_group_id and user_id = p_user_id and role <> 'owner';
end;
$$;

-- ----------------------------------------------------------------------------
-- Invitaciones
-- ----------------------------------------------------------------------------
create or replace function public.create_invite(
  p_group_id   uuid,
  p_expires_in interval default interval '7 days',
  p_max_uses   integer default null
)
returns public.group_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := public.require_auth();
  v_invite public.group_invites;
begin
  if not public.is_group_admin(p_group_id) then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  perform public.enforce_rate_limit('create_invite', 20, interval '1 hour');

  insert into public.group_invites (group_id, token, created_by, expires_at, max_uses)
  values (
    p_group_id,
    public.generate_invite_token(),
    v_uid,
    case when p_expires_in is null then null else now() + p_expires_in end,
    p_max_uses
  )
  returning * into v_invite;

  return v_invite;
end;
$$;

create or replace function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
begin
  perform public.require_auth();
  select group_id into v_group_id from public.group_invites where id = p_invite_id;
  if v_group_id is null then
    raise exception 'invite_not_found' using errcode = '42704';
  end if;
  if not public.is_group_admin(v_group_id) then
    raise exception 'admin_only' using errcode = '42501';
  end if;

  update public.group_invites set revoked_at = now()
   where id = p_invite_id and revoked_at is null;
end;
$$;

-- Devuelve lo mínimo indispensable para pintar la pantalla de "unirse".
-- Cualquier token inválido, vencido, revocado o agotado devuelve exactamente la
-- misma forma de respuesta: nunca revela si el grupo existe.
create or replace function public.peek_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite   public.group_invites;
  v_group    public.groups;
  v_members  integer;
  v_uid      uuid := (select public.current_user_id());
begin
  select * into v_invite
    from public.group_invites
   where token = p_token
     and revoked_at is null
     and (expires_at is null or expires_at > now())
     and (max_uses is null or uses < max_uses);

  if not found then
    return jsonb_build_object('valid', false);
  end if;

  select * into v_group from public.groups where id = v_invite.group_id;
  select count(*) into v_members from public.group_members where group_id = v_invite.group_id;

  return jsonb_build_object(
    'valid',         true,
    'group_id',      v_group.id,
    'group_name',    v_group.name,
    'member_count',  v_members,
    'already_member', v_uid is not null and exists (
      select 1 from public.group_members
       where group_id = v_invite.group_id and user_id = v_uid
    )
  );
end;
$$;

create or replace function public.join_group(
  p_token        text,
  p_display_name text,
  p_avatar_seed  text default null,
  p_accent       smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := public.require_auth();
  v_invite public.group_invites;
begin
  perform public.enforce_rate_limit('join_group', 20, interval '1 hour');

  select * into v_invite
    from public.group_invites
   where token = p_token
     and revoked_at is null
     and (expires_at is null or expires_at > now())
     and (max_uses is null or uses < max_uses)
   for update;

  if not found then
    raise exception 'invalid_invite' using errcode = '42704';
  end if;

  perform public.upsert_profile(p_display_name, p_avatar_seed, p_accent);

  if exists (
    select 1 from public.group_members
     where group_id = v_invite.group_id and user_id = v_uid
  ) then
    return v_invite.group_id;  -- idempotente: reentrar con el mismo link no rompe nada
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_invite.group_id, v_uid, 'member');

  update public.group_invites set uses = uses + 1 where id = v_invite.id;

  insert into public.activity_events (group_id, actor_id, type, payload)
  values (v_invite.group_id, v_uid, 'member_joined', jsonb_build_object('name', btrim(p_display_name)));

  return v_invite.group_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Predicciones
-- ----------------------------------------------------------------------------
create or replace function public.create_prediction(
  p_group_id               uuid,
  p_title                  text,
  p_options                text[],
  p_closes_at              timestamptz,
  p_description            text default null,
  p_option_type            public.option_source default 'manual',
  p_voting_mode            public.voting_mode default 'single',
  p_vote_interval          interval default null,
  p_allow_new_options      boolean default false,
  p_results_visibility     public.results_visibility default 'on_close',
  p_votes_visibility       public.votes_visibility default 'on_close',
  p_minimum_participants   smallint default 3,
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
  v_minimum       smallint;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  perform public.enforce_rate_limit('create_prediction', 20, interval '1 hour');

  if p_closes_at <= v_opens_at then
    raise exception 'closes_at_must_be_future' using errcode = '22023';
  end if;

  -- El plazo de calificación nunca puede pasarse del cierre.
  v_qualification := least(v_opens_at + make_interval(hours => greatest(1, p_qualification_hours)), p_closes_at);

  -- El umbral se acota en el servidor. Si el cliente pudiera mandar 1, cualquiera
  -- calificaría su propia predicción con su propio voto y el estado "En prueba"
  -- dejaría de existir.
  v_minimum := least(20, greatest(3, coalesce(p_minimum_participants, 3)))::smallint;

  insert into public.predictions (
    group_id, created_by, title, description,
    option_type, voting_mode, vote_interval, allow_new_options,
    results_visibility, votes_visibility,
    minimum_participants, qualification_deadline, opens_at, closes_at,
    is_default
  )
  values (
    p_group_id, v_uid, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
    p_option_type, p_voting_mode, p_vote_interval, p_allow_new_options,
    p_results_visibility, p_votes_visibility,
    v_minimum, v_qualification, v_opens_at, p_closes_at,
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

-- Predicciones del sistema. El texto, las opciones y el modo salen de la fila del
-- template leída en el servidor: el cliente sólo elige CUÁL template y cuándo cierra.
-- Si `is_default` se dedujera de un template_id enviado junto con un título libre,
-- cualquiera podría colar una pregunta arbitraria como si fuera del sistema.
create or replace function public.create_prediction_from_template(
  p_group_id            uuid,
  p_template_id         uuid,
  p_closes_at           timestamptz,
  p_qualification_hours integer default 48
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
    minimum_participants, qualification_deadline, opens_at, closes_at,
    is_default, status
  )
  values (
    p_group_id, v_uid, v_tpl.id, v_tpl.title, v_tpl.description,
    v_tpl.option_type, v_tpl.voting_mode,
    case when v_tpl.voting_mode = 'recurring' then interval '7 days' else null end,
    false,
    'on_close', 'on_close',
    3, least(v_opens_at + make_interval(hours => greatest(1, p_qualification_hours)), p_closes_at),
    v_opens_at, p_closes_at,
    true, 'active'   -- las del sistema no necesitan juntar participación
  )
  returning id into v_prediction_id;

  if v_tpl.option_type = 'members' then
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
  if v_pred.status not in ('proposed', 'active') or v_pred.closes_at <= now() then
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

create or replace function public.cancel_prediction(p_prediction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := public.require_auth();
  v_pred public.predictions;
begin
  select * into v_pred from public.predictions where id = p_prediction_id;
  if not found then
    raise exception 'prediction_not_found' using errcode = '42704';
  end if;
  -- El creador puede cancelar la suya mientras nadie haya votado; después, sólo admins.
  if not (
    public.is_group_admin(v_pred.group_id)
    or (v_pred.created_by = v_uid and v_pred.participant_count = 0)
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_pred.status = 'resolved' then
    raise exception 'already_resolved' using errcode = '22023';
  end if;

  update public.predictions set status = 'cancelled' where id = p_prediction_id;

  insert into public.activity_events (group_id, actor_id, prediction_id, type, payload)
  values (v_pred.group_id, v_uid, p_prediction_id, 'prediction_cancelled', jsonb_build_object('title', v_pred.title));
end;
$$;

-- ----------------------------------------------------------------------------
-- Votar
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
  if now() >= v_pred.closes_at then
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
-- Resolución comunitaria
-- ----------------------------------------------------------------------------
create or replace function public.propose_resolution(
  p_prediction_id uuid,
  p_option_id     uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := public.require_auth();
  v_pred     public.predictions;
  v_members  integer;
  v_required smallint;
  v_id       uuid;
begin
  select * into v_pred from public.predictions where id = p_prediction_id;
  if not found then
    raise exception 'prediction_not_found' using errcode = '42704';
  end if;
  if not public.is_group_member(v_pred.group_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  perform public.finalize_predictions(v_pred.group_id);
  select * into v_pred from public.predictions where id = p_prediction_id;

  if v_pred.status not in ('closed', 'resolving') then
    raise exception 'not_closed_yet' using errcode = '22023';
  end if;
  -- Normalmente proponen el creador o un admin. Pero si una propuesta anterior fue
  -- rechazada, cualquier integrante puede proponer: si no, un creador porfiado
  -- podría dejar la predicción trabada para siempre.
  if not (
    v_pred.created_by = v_uid
    or public.is_group_admin(v_pred.group_id)
    or exists (
      select 1 from public.prediction_resolutions
       where prediction_id = p_prediction_id and status = 'rejected'
    )
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.prediction_resolutions
     where prediction_id = p_prediction_id and status = 'proposed'
  ) then
    raise exception 'resolution_already_open' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.prediction_options
     where id = p_option_id and prediction_id = p_prediction_id
  ) then
    raise exception 'invalid_option' using errcode = '22023';
  end if;

  select count(*) into v_members from public.group_members where group_id = v_pred.group_id;
  -- Nunca alcanza con la palabra de quien propone: al menos una confirmación ajena.
  v_required := greatest(1, least(2, v_members - 1))::smallint;

  insert into public.prediction_resolutions (prediction_id, proposed_option_id, proposed_by, required_confirmations)
  values (p_prediction_id, p_option_id, v_uid, v_required)
  returning id into v_id;

  update public.predictions set status = 'resolving' where id = p_prediction_id;

  insert into public.activity_events (group_id, actor_id, prediction_id, type, payload)
  values (
    v_pred.group_id, v_uid, p_prediction_id, 'resolution_proposed',
    jsonb_build_object(
      'title',  v_pred.title,
      'option', (select label from public.prediction_options where id = p_option_id)
    )
  );

  return v_id;
end;
$$;

-- Reparte los puntos. Sólo la llama confirm_resolution.
create or replace function public.score_prediction(p_prediction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pred         public.predictions;
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

  select count(*) into v_total_votes
    from public.prediction_votes where prediction_id = p_prediction_id;
  select count(*) into v_winner_votes
    from public.prediction_votes
   where prediction_id = p_prediction_id and option_id = v_pred.resolved_option_id;

  v_share := case when v_total_votes = 0 then 1 else v_winner_votes::numeric / v_total_votes end;
  v_span  := greatest(1, extract(epoch from (v_pred.closes_at - v_pred.opens_at)));

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
          extract(epoch from (v_pred.closes_at - r.first_winner_at)) / v_span
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

create or replace function public.confirm_resolution(
  p_resolution_id uuid,
  p_agrees        boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := public.require_auth();
  v_res      public.prediction_resolutions;
  v_pred     public.predictions;
  v_agree    integer;
  v_against  integer;
begin
  select * into v_res from public.prediction_resolutions where id = p_resolution_id for update;
  if not found then
    raise exception 'resolution_not_found' using errcode = '42704';
  end if;
  if v_res.status <> 'proposed' then
    raise exception 'resolution_settled' using errcode = '22023';
  end if;

  select * into v_pred from public.predictions where id = v_res.prediction_id;
  if not public.is_group_member(v_pred.group_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  -- Quien propone no se confirma a sí mismo.
  if v_res.proposed_by = v_uid then
    raise exception 'proposer_cannot_confirm' using errcode = '42501';
  end if;

  begin
    insert into public.resolution_confirmations (resolution_id, user_id, agrees)
    values (p_resolution_id, v_uid, p_agrees);
  exception when unique_violation then
    raise exception 'already_confirmed' using errcode = '22023';
  end;

  select
    count(*) filter (where agrees),
    count(*) filter (where not agrees)
    into v_agree, v_against
    from public.resolution_confirmations where resolution_id = p_resolution_id;

  if v_agree >= v_res.required_confirmations then
    update public.prediction_resolutions
       set status = 'confirmed', settled_at = now()
     where id = p_resolution_id;

    update public.predictions
       set status = 'resolved',
           resolved_option_id = v_res.proposed_option_id,
           resolved_at = now()
     where id = v_res.prediction_id;

    perform public.score_prediction(v_res.prediction_id);

    insert into public.activity_events (group_id, actor_id, prediction_id, type, payload)
    values (
      v_pred.group_id, v_uid, v_pred.id, 'prediction_resolved',
      jsonb_build_object(
        'title',  v_pred.title,
        'option', (select label from public.prediction_options where id = v_res.proposed_option_id)
      )
    );

    return jsonb_build_object('outcome', 'resolved', 'agree', v_agree, 'against', v_against);
  end if;

  if v_against >= v_res.required_confirmations then
    -- Disputa: la propuesta cae y el grupo puede proponer otro resultado.
    update public.prediction_resolutions
       set status = 'rejected', settled_at = now()
     where id = p_resolution_id;
    update public.predictions set status = 'closed' where id = v_res.prediction_id;

    return jsonb_build_object('outcome', 'rejected', 'agree', v_agree, 'against', v_against);
  end if;

  return jsonb_build_object('outcome', 'pending', 'agree', v_agree, 'against', v_against);
end;
$$;

-- ----------------------------------------------------------------------------
-- Evolución temporal (predicciones recurrentes)
-- ----------------------------------------------------------------------------
-- Devuelve conteos agregados por ciclo. Nunca filas de voto individuales, y
-- sólo cuando la visibilidad configurada lo permite.
create or replace function public.vote_timeline(p_prediction_id uuid)
returns table (
  cycle     smallint,
  bucket_at timestamptz,
  option_id uuid,
  votes     integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := public.require_auth();
  v_pred public.predictions;
begin
  select * into v_pred from public.predictions where id = p_prediction_id;
  if not found or not public.is_group_member(v_pred.group_id) then
    raise exception 'not_found' using errcode = '42704';
  end if;

  if not (
    v_pred.status in ('closed', 'resolving', 'resolved')
    or v_pred.results_visibility = 'always'
    or (
      v_pred.results_visibility = 'after_vote'
      and exists (
        select 1 from public.prediction_votes
         where prediction_id = p_prediction_id and user_id = v_uid
      )
    )
  ) then
    raise exception 'results_hidden' using errcode = '42501';
  end if;

  return query
    select
      v.cycle,
      (v_pred.opens_at + v.cycle * coalesce(v_pred.vote_interval, interval '0'))::timestamptz,
      v.option_id,
      count(*)::integer
    from public.prediction_votes v
   where v.prediction_id = p_prediction_id
   group by v.cycle, v.option_id
   order by v.cycle, v.option_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants de ejecución
-- ----------------------------------------------------------------------------
-- Se revoca de PUBLIC, no sólo de anon/authenticated.
--
-- Postgres otorga EXECUTE a PUBLIC en toda función nueva, y `anon` y
-- `authenticated` heredan de PUBLIC. Revocar únicamente de esos dos roles no
-- hace nada: el permiso sigue llegando por herencia. El efecto práctico sería
-- que TODA función de `public` —incluidas las internas y SECURITY DEFINER, que
-- corren saltándose RLS— quedara expuesta como endpoint de la API.
revoke execute on all functions in schema public from public, anon, authenticated;

-- Y lo mismo para lo que se cree de acá en adelante, para que un `create
-- function` futuro no reabra el agujero sin que nadie lo note.
alter default privileges in schema public revoke execute on functions from public;

grant execute on function
  public.is_group_member(uuid),
  public.group_role(uuid),
  public.is_group_admin(uuid),
  public.calculate_points(integer, numeric, integer, numeric, numeric),
  public.current_cycle(timestamptz, interval, timestamptz),
  public.finalize_predictions(uuid),
  public.upsert_profile(text, text, smallint),
  public.create_group(text, text, text, smallint),
  public.leave_group(uuid),
  public.update_member_role(uuid, uuid, public.member_role),
  public.remove_member(uuid, uuid),
  public.create_invite(uuid, interval, integer),
  public.revoke_invite(uuid),
  public.join_group(text, text, text, smallint),
  public.create_prediction(uuid, text, text[], timestamptz, text, public.option_source, public.voting_mode, interval, boolean, public.results_visibility, public.votes_visibility, smallint, integer),
  public.create_prediction_from_template(uuid, uuid, timestamptz, integer),
  public.add_prediction_option(uuid, text),
  public.cancel_prediction(uuid),
  public.cast_vote(uuid, uuid),
  public.propose_resolution(uuid, uuid),
  public.confirm_resolution(uuid, boolean),
  public.vote_timeline(uuid)
to authenticated;

-- `peek_invite` debe poder llamarse antes de iniciar sesión: es la pantalla que
-- ve alguien que abre el link desde WhatsApp sin tener cuenta todavía.
grant execute on function public.peek_invite(text) to anon, authenticated;

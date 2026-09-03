-- ============================================================================
-- friedict — Row Level Security
-- ----------------------------------------------------------------------------
-- Regla madre: si no pertenecés al grupo, no existe nada de ese grupo para vos.
--
-- Las tablas sólo tienen GRANT SELECT (ver 20260813000100_schema.sql), así que
-- acá únicamente se definen políticas de lectura. La ausencia deliberada de
-- políticas de INSERT/UPDATE/DELETE es la segunda barrera: aunque alguien
-- consiguiera el privilegio, RLS seguiría negando toda escritura directa.
--
-- Los helpers son SECURITY DEFINER a propósito: consultar `group_members` desde
-- una política sobre `group_members` provocaría recursión infinita.
-- ============================================================================

create or replace function public.shares_group_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.group_members a
      join public.group_members b on b.group_id = a.group_id
     where a.user_id = (select public.current_user_id())
       and b.user_id = p_user_id
  );
$$;

create or replace function public.can_read_prediction(p_prediction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.predictions p
      join public.group_members m on m.group_id = p.group_id
     where p.id = p_prediction_id
       and m.user_id = (select public.current_user_id())
  );
$$;

-- ¿Puede ver los recuentos por opción? Implementa `results_visibility`.
create or replace function public.can_see_results(p_prediction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.predictions p
     where p.id = p_prediction_id
       and public.is_group_member(p.group_id)
       and (
            p.status in ('closed', 'resolving', 'resolved')
         or p.results_visibility = 'always'
         or (
              p.results_visibility = 'after_vote'
              and exists (
                select 1 from public.prediction_votes v
                 where v.prediction_id = p.id and v.user_id = (select public.current_user_id())
              )
            )
       )
  );
$$;

-- ¿Puede ver QUIÉN votó qué? Implementa `votes_visibility`.
create or replace function public.can_see_votes(p_prediction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.predictions p
     where p.id = p_prediction_id
       and public.is_group_member(p.group_id)
       and p.votes_visibility <> 'anonymous'
       and (
            p.votes_visibility = 'visible'
         or p.status in ('closed', 'resolving', 'resolved')
       )
  );
$$;

-- Estas cuatro se crean DESPUÉS del `revoke ... from public` de la migración
-- anterior, así que arrancan con el EXECUTE que Postgres le da a PUBLIC por
-- defecto. Se revoca explícitamente en vez de confiar en el orden de las
-- migraciones: es la clase de detalle que se rompe en silencio al reordenar un
-- archivo.
revoke execute on function
  public.shares_group_with(uuid),
  public.can_read_prediction(uuid),
  public.can_see_results(uuid),
  public.can_see_votes(uuid)
from public, anon, authenticated;

grant execute on function
  public.shares_group_with(uuid),
  public.can_read_prediction(uuid),
  public.can_see_results(uuid),
  public.can_see_votes(uuid)
to authenticated;

-- ----------------------------------------------------------------------------
-- Habilitar RLS en todo
-- ----------------------------------------------------------------------------
alter table public.profiles                  enable row level security;
alter table public.groups                    enable row level security;
alter table public.group_members             enable row level security;
alter table public.group_invites             enable row level security;
alter table public.prediction_templates      enable row level security;
alter table public.predictions               enable row level security;
alter table public.prediction_options        enable row level security;
alter table public.prediction_option_tallies enable row level security;
alter table public.prediction_votes          enable row level security;
alter table public.prediction_resolutions    enable row level security;
alter table public.resolution_confirmations  enable row level security;
alter table public.prediction_scores         enable row level security;
alter table public.activity_events           enable row level security;
alter table public.rate_limits               enable row level security;

-- ----------------------------------------------------------------------------
-- Políticas
-- ----------------------------------------------------------------------------

-- profiles: el propio, y el de quienes comparten algún grupo conmigo.
create policy profiles_select_self_or_groupmates
  on public.profiles for select to authenticated
  using (id = (select public.current_user_id()) or public.shares_group_with(id));

-- groups
create policy groups_select_members
  on public.groups for select to authenticated
  using (public.is_group_member(id));

-- group_members
create policy group_members_select_members
  on public.group_members for select to authenticated
  using (public.is_group_member(group_id));

-- group_invites: sólo owner/admin. Un member nunca ve los tokens.
create policy group_invites_select_admins
  on public.group_invites for select to authenticated
  using (public.is_group_admin(group_id));

-- prediction_templates: contenido de la app, sin datos de ningún grupo.
create policy prediction_templates_select_all
  on public.prediction_templates for select to authenticated
  using (is_active);

-- predictions
create policy predictions_select_members
  on public.predictions for select to authenticated
  using (public.is_group_member(group_id));

-- prediction_options
create policy prediction_options_select_members
  on public.prediction_options for select to authenticated
  using (public.can_read_prediction(prediction_id));

-- prediction_option_tallies: acá vive el "no mostrar tendencias antes del cierre".
create policy prediction_option_tallies_select_visible
  on public.prediction_option_tallies for select to authenticated
  using (public.can_see_results(prediction_id));

-- prediction_votes: el voto propio siempre; el ajeno sólo si la predicción lo permite.
create policy prediction_votes_select_own_or_visible
  on public.prediction_votes for select to authenticated
  using (user_id = (select public.current_user_id()) or public.can_see_votes(prediction_id));

-- prediction_resolutions
create policy prediction_resolutions_select_members
  on public.prediction_resolutions for select to authenticated
  using (public.can_read_prediction(prediction_id));

-- resolution_confirmations
create policy resolution_confirmations_select_members
  on public.resolution_confirmations for select to authenticated
  using (
    exists (
      select 1 from public.prediction_resolutions r
       where r.id = resolution_id
         and public.can_read_prediction(r.prediction_id)
    )
  );

-- prediction_scores
create policy prediction_scores_select_members
  on public.prediction_scores for select to authenticated
  using (public.is_group_member(group_id));

-- activity_events
create policy activity_events_select_members
  on public.activity_events for select to authenticated
  using (public.is_group_member(group_id));

-- rate_limits: sin políticas a propósito. Ni siquiera el dueño de la fila la lee;
-- sólo las funciones SECURITY DEFINER la tocan.

-- ============================================================================
-- friedict — esquema base
-- ----------------------------------------------------------------------------
-- Principios:
--   * Todo timestamp es `timestamptz`. El navegador nunca define tiempos críticos.
--   * Las tablas sólo otorgan SELECT a `authenticated`; toda escritura pasa por
--     funciones SECURITY DEFINER que validan membresía, roles y ventanas de tiempo.
--   * RLS se habilita en absolutamente todas las tablas (ver 20260813000300_rls.sql).
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'admin', 'member');

create type public.prediction_status as enum (
  'proposed',   -- "En prueba": junta participación mínima o expira
  'active',     -- confirmada, acepta votos hasta closes_at
  'closed',     -- cerrada, votos bloqueados
  'resolving',  -- hay un resultado propuesto esperando confirmaciones
  'resolved',   -- resultado confirmado y puntos asignados
  'expired',    -- no alcanzó la participación mínima
  'cancelled'   -- cancelada por owner/admin
);

create type public.option_source as enum ('manual', 'members', 'open');

create type public.voting_mode as enum ('single', 'recurring');

create type public.results_visibility as enum ('always', 'after_vote', 'on_close');

create type public.votes_visibility as enum ('visible', 'on_close', 'anonymous');

create type public.resolution_status as enum ('proposed', 'confirmed', 'disputed', 'rejected');

create type public.activity_type as enum (
  'member_joined',
  'prediction_created',
  'prediction_qualified',
  'prediction_expired',
  'prediction_closed',
  'resolution_proposed',
  'prediction_resolved',
  'prediction_cancelled'
);

-- ----------------------------------------------------------------------------
-- profiles
-- ----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references public.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 2 and 40),
  avatar_seed  text not null default '' check (char_length(avatar_seed) <= 24),
  accent       smallint not null default 0 check (accent between 0 and 7),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'Perfil público mínimo. Se crea en el onboarding, nunca desde el cliente directamente.';
comment on column public.profiles.accent is 'Índice 0-7 dentro de la paleta de avatares del design system.';

-- ----------------------------------------------------------------------------
-- groups
-- ----------------------------------------------------------------------------
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 2 and 48),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index groups_created_by_idx on public.groups (created_by);

-- ----------------------------------------------------------------------------
-- group_members
-- ----------------------------------------------------------------------------
create table public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      public.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_idx on public.group_members (user_id);
-- Un grupo siempre debe conservar exactamente un owner.
create unique index group_members_single_owner_idx
  on public.group_members (group_id)
  where role = 'owner';

-- ----------------------------------------------------------------------------
-- group_invites
-- ----------------------------------------------------------------------------
create table public.group_invites (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  token      text not null unique check (char_length(token) = 32),
  created_by uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz,
  revoked_at timestamptz,
  max_uses   integer check (max_uses is null or max_uses > 0),
  uses       integer not null default 0 check (uses >= 0),
  created_at timestamptz not null default now()
);

create index group_invites_group_idx on public.group_invites (group_id, created_at desc);

comment on column public.group_invites.token is
  '32 caracteres base32 sin ambigüedades (~160 bits de entropía). Generado en el servidor.';

-- ----------------------------------------------------------------------------
-- prediction_templates — contenido público de la app, sin datos de grupo
-- ----------------------------------------------------------------------------
create table public.prediction_templates (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  category      text not null default 'general',
  option_type   public.option_source not null default 'manual',
  options       text[] not null default '{}',
  voting_mode   public.voting_mode not null default 'single',
  default_hours integer not null default 48 check (default_hours between 1 and 8760),
  sort_order    integer not null default 0,
  is_active     boolean not null default true
);

-- ----------------------------------------------------------------------------
-- predictions
-- ----------------------------------------------------------------------------
create table public.predictions (
  id                     uuid primary key default gen_random_uuid(),
  group_id               uuid not null references public.groups (id) on delete cascade,
  created_by             uuid not null references public.profiles (id) on delete cascade,
  template_id            uuid references public.prediction_templates (id) on delete set null,

  title                  text not null check (char_length(btrim(title)) between 4 and 140),
  description            text check (description is null or char_length(description) <= 400),

  option_type            public.option_source not null default 'manual',
  voting_mode            public.voting_mode not null default 'single',
  vote_interval          interval,
  allow_new_options      boolean not null default false,

  results_visibility     public.results_visibility not null default 'on_close',
  votes_visibility       public.votes_visibility not null default 'on_close',

  minimum_participants   smallint not null default 3 check (minimum_participants between 1 and 20),
  qualification_deadline timestamptz not null,
  opens_at               timestamptz not null default now(),
  closes_at              timestamptz not null,

  is_default             boolean not null default false,
  status                 public.prediction_status not null default 'proposed',

  -- Contadores desnormalizados: permiten mostrar participación en vivo por
  -- Realtime sin exponer jamás qué votó cada persona.
  participant_count      integer not null default 0 check (participant_count >= 0),
  vote_count             integer not null default 0 check (vote_count >= 0),

  resolved_option_id     uuid,
  resolved_at            timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint predictions_window
    check (closes_at > opens_at),
  constraint predictions_qualification_within_window
    check (qualification_deadline > opens_at and qualification_deadline <= closes_at),
  constraint predictions_recurring_needs_interval
    check ((voting_mode = 'recurring') = (vote_interval is not null)),
  constraint predictions_interval_sane
    check (vote_interval is null or (vote_interval >= interval '1 hour' and vote_interval <= interval '90 days')),
  constraint predictions_resolved_shape
    check ((status = 'resolved') = (resolved_option_id is not null and resolved_at is not null))
);

create index predictions_group_status_idx on public.predictions (group_id, status, closes_at);
create index predictions_group_created_idx on public.predictions (group_id, created_at desc);
create index predictions_qualification_idx on public.predictions (qualification_deadline)
  where status = 'proposed';
create index predictions_closes_idx on public.predictions (closes_at)
  where status in ('proposed', 'active');

comment on column public.predictions.qualification_deadline is
  'Fecha límite para juntar minimum_participants. NO es el cierre de la predicción.';
comment on column public.predictions.is_default is
  'Predicciones creadas desde templates oficiales: no expiran por falta de participación.';

-- ----------------------------------------------------------------------------
-- prediction_options
-- ----------------------------------------------------------------------------
create table public.prediction_options (
  id            uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.predictions (id) on delete cascade,
  label         text not null check (char_length(btrim(label)) between 1 and 60),
  member_id     uuid references public.profiles (id) on delete cascade,
  position      smallint not null default 0,
  created_by    uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (prediction_id, label)
);

create index prediction_options_prediction_idx on public.prediction_options (prediction_id, position);

alter table public.predictions
  add constraint predictions_resolved_option_fk
  foreign key (resolved_option_id) references public.prediction_options (id) on delete restrict;

-- ----------------------------------------------------------------------------
-- prediction_option_tallies
-- ----------------------------------------------------------------------------
-- Tabla separada a propósito: su RLS implementa `results_visibility`, de modo
-- que los recuentos por opción sólo son legibles (y sólo llegan por Realtime)
-- cuando la predicción lo permite.
create table public.prediction_option_tallies (
  option_id     uuid primary key references public.prediction_options (id) on delete cascade,
  prediction_id uuid not null references public.predictions (id) on delete cascade,
  vote_count    integer not null default 0 check (vote_count >= 0),
  voter_count   integer not null default 0 check (voter_count >= 0),
  updated_at    timestamptz not null default now()
);

create index prediction_option_tallies_prediction_idx
  on public.prediction_option_tallies (prediction_id);

-- ----------------------------------------------------------------------------
-- prediction_votes
-- ----------------------------------------------------------------------------
-- `cycle` = 0 en modo single. En modo recurring es el número de ventana desde
-- `opens_at`. La unique constraint es la que hace imposible votar dos veces en
-- el mismo ciclo, incluso si la UI fallara.
create table public.prediction_votes (
  id            uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.predictions (id) on delete cascade,
  option_id     uuid not null references public.prediction_options (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  cycle         smallint not null default 0 check (cycle >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (prediction_id, user_id, cycle)
);

create index prediction_votes_prediction_idx on public.prediction_votes (prediction_id, created_at);
create index prediction_votes_option_idx on public.prediction_votes (option_id);
create index prediction_votes_user_idx on public.prediction_votes (user_id);

-- ----------------------------------------------------------------------------
-- prediction_resolutions / resolution_confirmations
-- ----------------------------------------------------------------------------
create table public.prediction_resolutions (
  id                     uuid primary key default gen_random_uuid(),
  prediction_id          uuid not null references public.predictions (id) on delete cascade,
  proposed_option_id     uuid not null references public.prediction_options (id) on delete cascade,
  proposed_by            uuid not null references public.profiles (id) on delete cascade,
  status                 public.resolution_status not null default 'proposed',
  required_confirmations smallint not null default 2 check (required_confirmations between 1 and 10),
  created_at             timestamptz not null default now(),
  settled_at             timestamptz
);

create index prediction_resolutions_prediction_idx
  on public.prediction_resolutions (prediction_id, created_at desc);

-- Como mucho una propuesta abierta por predicción.
create unique index prediction_resolutions_one_open_idx
  on public.prediction_resolutions (prediction_id)
  where status = 'proposed';

create table public.resolution_confirmations (
  resolution_id uuid not null references public.prediction_resolutions (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  agrees        boolean not null,
  created_at    timestamptz not null default now(),
  primary key (resolution_id, user_id)
);

-- ----------------------------------------------------------------------------
-- prediction_scores
-- ----------------------------------------------------------------------------
create table public.prediction_scores (
  prediction_id         uuid not null references public.predictions (id) on delete cascade,
  user_id               uuid not null references public.profiles (id) on delete cascade,
  group_id              uuid not null references public.groups (id) on delete cascade,
  points                integer not null default 0 check (points >= 0),
  correct               boolean not null default false,
  rarity_multiplier     numeric(4, 2) not null default 1,
  early_multiplier      numeric(4, 2) not null default 1,
  conviction_multiplier numeric(4, 2) not null default 1,
  created_at            timestamptz not null default now(),
  primary key (prediction_id, user_id)
);

create index prediction_scores_group_user_idx on public.prediction_scores (group_id, user_id);
create index prediction_scores_group_created_idx on public.prediction_scores (group_id, created_at desc);

-- ----------------------------------------------------------------------------
-- activity_events
-- ----------------------------------------------------------------------------
create table public.activity_events (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.groups (id) on delete cascade,
  actor_id      uuid references public.profiles (id) on delete set null,
  prediction_id uuid references public.predictions (id) on delete cascade,
  type          public.activity_type not null,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index activity_events_group_idx on public.activity_events (group_id, created_at desc);

-- ----------------------------------------------------------------------------
-- rate_limits — interno, sin acceso desde la API
-- ----------------------------------------------------------------------------
create table public.rate_limits (
  user_id      uuid not null references public.users (id) on delete cascade,
  bucket       text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (user_id, bucket, window_start)
);

-- ----------------------------------------------------------------------------
-- updated_at
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch     before update on public.profiles         for each row execute function public.touch_updated_at();
create trigger groups_touch       before update on public.groups           for each row execute function public.touch_updated_at();
create trigger predictions_touch  before update on public.predictions      for each row execute function public.touch_updated_at();
create trigger votes_touch        before update on public.prediction_votes for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Vista de ranking (security_invoker: respeta la RLS de las tablas base)
-- ----------------------------------------------------------------------------
create view public.group_leaderboard
with (security_invoker = on) as
select
  gm.group_id,
  gm.user_id,
  p.display_name,
  p.avatar_seed,
  p.accent,
  coalesce(sum(s.points), 0)::integer                                   as points,
  coalesce(count(s.*) filter (where s.correct), 0)::integer             as hits,
  coalesce(count(s.*), 0)::integer                                      as resolved_predictions,
  coalesce(sum(s.points) filter (where s.created_at > now() - interval '30 days'), 0)::integer
                                                                        as points_30d,
  rank() over (
    partition by gm.group_id
    order by coalesce(sum(s.points), 0) desc, coalesce(count(s.*) filter (where s.correct), 0) desc
  )::integer                                                            as position
from public.group_members gm
join public.profiles p on p.id = gm.user_id
left join public.prediction_scores s
  on s.user_id = gm.user_id and s.group_id = gm.group_id
group by gm.group_id, gm.user_id, p.display_name, p.avatar_seed, p.accent;

-- ----------------------------------------------------------------------------
-- Grants: sólo lectura. Cada escritura vive en una función SECURITY DEFINER.
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

-- Se parte de cero a propósito.
--
-- Las default privileges del proyecto conceden ALL sobre las tablas nuevas a
-- `anon` y `authenticated`. Aunque la configuración actual del Data API ya no
-- expone automáticamente SELECT/INSERT/UPDATE/DELETE, quedaba TRUNCATE — que
-- vacía la tabla entera y que, a diferencia de DELETE, NO pasa por RLS. No hay
-- endpoint de PostgREST que lo dispare, pero es un privilegio que estos roles
-- no tienen ningún motivo para tener.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

grant select on
  public.profiles,
  public.groups,
  public.group_members,
  public.group_invites,
  public.predictions,
  public.prediction_options,
  public.prediction_option_tallies,
  public.prediction_votes,
  public.prediction_resolutions,
  public.resolution_confirmations,
  public.prediction_scores,
  public.activity_events,
  public.prediction_templates,
  public.group_leaderboard
to authenticated;

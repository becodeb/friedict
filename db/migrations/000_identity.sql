-- ============================================================================
-- friedict — identidad y roles
-- ----------------------------------------------------------------------------
-- Lo único que Supabase aportaba a nivel base de datos era el schema `auth`
-- (tabla de usuarios de GoTrue) y la función `auth.uid()`, que resolvía quién
-- hacía la petición. Acá se reemplazan por dos piezas propias:
--
--   · `public.users`         — la identidad. Contraseña con bcrypt y/o Google.
--   · `public.current_user_id()` — lee una GUC que el servidor escribe con
--     `set_local` al principio de cada transacción.
--
-- La GUC es lo que hace que TODA la seguridad siga viviendo en la base: las
-- políticas RLS y las funciones SECURITY DEFINER se escribieron contra
-- `auth.uid()` y siguen funcionando igual, sin cambiarles una línea de lógica.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Roles
-- ----------------------------------------------------------------------------
-- Los mismos dos nombres que usa Supabase, porque los GRANT del schema y las
-- políticas (`to authenticated`) los nombran explícitamente. Son roles sin
-- login: sirven de bolsa de permisos, no de cuenta.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Usuarios
-- ----------------------------------------------------------------------------
-- Deliberadamente mínima: acá va sólo lo necesario para autenticar. Todo lo
-- que el grupo ve de una persona (nombre visible, color) vive en `profiles`,
-- que es la tabla que sí se comparte y que la RLS protege.
create table if not exists public.users (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  -- Nulo cuando la cuenta es sólo de Google: no hay contraseña que verificar.
  password_hash   text,
  -- El `sub` de Google. Único, pero puede faltar.
  google_sub      text unique,
  created_at      timestamptz not null default now(),
  last_sign_in_at timestamptz,

  constraint users_email_format check (position('@' in email) > 1),
  -- Una cuenta sin ninguno de los dos no podría iniciar sesión nunca.
  constraint users_has_credential check (password_hash is not null or google_sub is not null)
);

-- El mail identifica la cuenta, sin distinguir mayúsculas: nadie se acuerda de
-- cómo escribió su propio mail al registrarse.
create unique index if not exists users_email_lower_idx on public.users (lower(email));

-- ----------------------------------------------------------------------------
-- Quién hace la petición
-- ----------------------------------------------------------------------------
-- Reemplaza exactamente a `auth.uid()`. El servidor abre una transacción y
-- ejecuta `select set_config('app.user_id', $1, true)` antes de cualquier otra
-- cosa; el `true` la hace LOCAL, así que se limpia sola al terminar y una
-- conexión reciclada del pool nunca arrastra el usuario de la petición
-- anterior.
--
-- El segundo argumento `true` de current_setting devuelve NULL en vez de tirar
-- error cuando la GUC no está definida, que es el caso de las peticiones sin
-- sesión.
create or replace function public.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

-- RLS también acá, aunque el rol de la app no tenga ningún GRANT sobre la
-- tabla. Son dos cerrojos distintos: el GRANT dice "no podés tocar esta
-- tabla" y la RLS dice "y si algún día alguien te da el GRANT, tampoco vas a
-- ver filas". Sin políticas, RLS niega todo por defecto.
alter table public.users enable row level security;

grant execute on function public.current_user_id() to anon, authenticated;

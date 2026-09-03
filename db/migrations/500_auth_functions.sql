-- ============================================================================
-- friedict — autenticación
-- ----------------------------------------------------------------------------
-- El resto del proyecto sigue una regla: el rol de la aplicación sólo tiene
-- SELECT sobre las tablas, y cada escritura pasa por una función SECURITY
-- DEFINER que verifica permisos por su cuenta. `public.users` no es la
-- excepción: el rol de la app no tiene NINGÚN privilegio sobre esa tabla, y
-- todo lo que el servidor necesita para autenticar entra por estas cuatro
-- funciones.
--
-- La consecuencia práctica: si mañana aparece una inyección SQL en cualquier
-- consulta del servidor, el atacante igual no puede leer la tabla de hashes.
--
-- El hash NO se calcula ni se compara acá. Lo hace bcryptjs en Node, que es
-- donde se controlan el costo y el tiempo constante de la comparación. Estas
-- funciones sólo mueven filas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Buscar por mail, para el login con contraseña
-- ----------------------------------------------------------------------------
-- Devuelve el hash. Es deliberado y es la única función que lo expone: el
-- servidor lo necesita para comparar. No se filtra nada más.
create or replace function public.auth_find_by_email(p_email text)
returns table (id uuid, email text, password_hash text)
language sql
security definer
set search_path = ''
as $$
  select u.id, u.email, u.password_hash
    from public.users u
   where lower(u.email) = lower(btrim(p_email));
$$;

-- ----------------------------------------------------------------------------
-- Registro con contraseña
-- ----------------------------------------------------------------------------
-- Devuelve NULL si el mail ya existe, en vez de tirar excepción: quien llama
-- necesita distinguir "ya está tomado" de "algo se rompió", y una excepción
-- obligaría a leer el mensaje de error de Postgres para saber cuál es cuál.
create or replace function public.auth_register(
  p_email         text,
  p_password_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if position('@' in coalesce(p_email, '')) < 2 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;

  insert into public.users (email, password_hash, last_sign_in_at)
  values (btrim(p_email), p_password_hash, now())
  on conflict do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Ingreso con Google
-- ----------------------------------------------------------------------------
-- Tres caminos, en este orden:
--   1. ya existe una cuenta con ese `sub` de Google  -> se usa;
--   2. existe una cuenta con ese mail (registrada con contraseña) -> se le
--      vincula el `sub`, así nadie termina con dos cuentas por haber entrado
--      distinto la segunda vez;
--   3. no existe nada -> se crea.
create or replace function public.auth_upsert_google(
  p_google_sub text,
  p_email      text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select u.id into v_id from public.users u where u.google_sub = p_google_sub;

  if v_id is null then
    select u.id into v_id
      from public.users u
     where lower(u.email) = lower(btrim(p_email));

    if v_id is not null then
      update public.users
         set google_sub = p_google_sub
       where id = v_id;
    else
      insert into public.users (email, google_sub, last_sign_in_at)
      values (btrim(p_email), p_google_sub, now())
      returning id into v_id;
    end if;
  end if;

  update public.users set last_sign_in_at = now() where id = v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Datos de la sesión
-- ----------------------------------------------------------------------------
-- Lo que el cliente puede saber de su propia cuenta. Sin hash, obviamente.
create or replace function public.auth_session_user(p_id uuid)
returns table (id uuid, email text, created_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select u.id, u.email, u.created_at
    from public.users u
   where u.id = p_id;
$$;

create or replace function public.auth_touch_sign_in(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.users set last_sign_in_at = now() where id = p_id;
$$;

-- `current_user_id()` se concede ACÁ y no sólo en 000_identity.sql: la
-- migración 200 hace un `revoke execute on all functions ... from public, anon,
-- authenticated` para que ninguna función interna quede expuesta como
-- endpoint, y eso se lleva puesto el grant original. Sin esta línea, cada
-- política RLS falla con «permission denied for function current_user_id» —
-- que es exactamente lo que pasó la primera vez que se probó.
grant execute on function public.current_user_id() to anon, authenticated;

-- `anon` puede llamarlas porque quien inicia sesión, por definición, todavía
-- no tiene sesión.
grant execute on function public.auth_find_by_email(text)          to anon, authenticated;
grant execute on function public.auth_register(text, text)         to anon, authenticated;
grant execute on function public.auth_upsert_google(text, text)    to anon, authenticated;
grant execute on function public.auth_session_user(uuid)           to anon, authenticated;
grant execute on function public.auth_touch_sign_in(uuid)          to anon, authenticated;

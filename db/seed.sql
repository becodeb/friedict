-- ============================================================================
-- friedict — datos de ejemplo
-- ----------------------------------------------------------------------------
-- Se ejecuta con `npm run db:reset`. Crea dos grupos con integrantes distintos
-- (sirve para verificar a ojo el aislamiento entre grupos) y predicciones en
-- todos los estados relevantes, para poder revisar la UI de verdad.
--
-- Todas las cuentas usan la contraseña `cantado123`, que existe únicamente en
-- este seed: sirve para los tests y para el acceso rápido de /entrar en local.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Usuarios
-- ----------------------------------------------------------------------------
create or replace function pg_temp.seed_user(
  p_id    uuid,
  p_email text,
  p_name  text,
  p_seed  text,
  p_accent integer
) returns void
language plpgsql
as $$
begin
  -- La contraseña de los usuarios sembrados existe sólo para poder entrar sin
  -- mail mientras se prueba. `crypt(..., gen_salt('bf'))` produce un hash
  -- bcrypt estándar ($2a$), que es exactamente el que verifica bcryptjs en el
  -- servidor: no hay dos formatos dando vueltas.
  insert into public.users (id, email, password_hash, created_at)
  values (
    p_id,
    p_email,
    crypt('cantado123', gen_salt('bf')),
    now() - interval '30 days'
  );

  insert into public.profiles (id, display_name, avatar_seed, accent, created_at)
  values (p_id, p_name, p_seed, p_accent::smallint, now() - interval '30 days');
end;
$$;

select pg_temp.seed_user('11111111-1111-4111-8111-111111111111', 'bauti@cantado.test',  'Bauti', 'BA', 0);
select pg_temp.seed_user('22222222-2222-4222-8222-222222222222', 'juan@cantado.test',   'Juan',  'JU', 1);
select pg_temp.seed_user('33333333-3333-4333-8333-333333333333', 'agus@cantado.test',   'Agus',  'AG', 2);
select pg_temp.seed_user('44444444-4444-4444-8444-444444444444', 'fran@cantado.test',   'Fran',  'FR', 3);
select pg_temp.seed_user('55555555-5555-4555-8555-555555555555', 'lu@cantado.test',     'Lu',    'LU', 4);
select pg_temp.seed_user('66666666-6666-4666-8666-666666666666', 'caro@cantado.test',   'Caro',  'CA', 5);

-- ----------------------------------------------------------------------------
-- Templates del sistema
-- ----------------------------------------------------------------------------
insert into public.prediction_templates (title, description, category, option_type, options, voting_mode, default_hours, sort_order) values
  ('¿Quién llega último?',              'El clásico de todos los sábados.',                 'juntadas', 'members', '{}',                                                            'single', 48, 10),
  ('¿Quién cancela primero?',           null,                                               'juntadas', 'members', '{}',                                                            'single', 48, 20),
  ('¿Terminamos cambiando el plan?',    'Se decidió algo. Veamos cuánto dura.',             'juntadas', 'manual',  '{"Sí, como siempre","No, esta vez se respeta"}',                 'single', 48, 30),
  ('¿Quién propone pedir comida?',      null,                                               'juntadas', 'members', '{}',                                                            'single', 24, 40),
  ('¿Quién responde último en el chat?',null,                                               'chat',     'members', '{}',                                                            'single', 24, 50),
  ('¿Quién se olvida de confirmar?',    null,                                               'chat',     'members', '{}',                                                            'single', 48, 60),
  ('¿Qué plan termina ganando?',        'Cargá las opciones que están sobre la mesa.',      'juntadas', 'manual',  '{"Previa en casa","Directo al bar","Se cae todo"}',              'single', 48, 70),
  ('¿Quién organiza la próxima salida?',null,                                               'juntadas', 'members', '{}',                                                            'single', 72, 80),
  ('¿Quién se muda primero?',           'De las que se responden en meses, no en horas.',   'largo',    'members', '{}',                                                            'recurring', 168, 90),
  ('¿Quién se compra un auto primero?', null,                                               'largo',    'members', '{}',                                                            'recurring', 168, 100);

-- ----------------------------------------------------------------------------
-- Grupos
-- ----------------------------------------------------------------------------
insert into public.groups (id, name, created_by, created_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Los pibes', '11111111-1111-4111-8111-111111111111', now() - interval '26 days'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'Fútbol 5',  '22222222-2222-4222-8222-222222222222', now() - interval '12 days');

insert into public.group_members (group_id, user_id, role, joined_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner',  now() - interval '26 days'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'admin',  now() - interval '25 days'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'member', now() - interval '25 days'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'member', now() - interval '20 days'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'member', now() - interval '14 days'),
  -- Caro pertenece SÓLO al segundo grupo: sirve para comprobar el aislamiento.
  ('aaaaaaaa-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'owner',  now() - interval '12 days'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'member', now() - interval '12 days'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '66666666-6666-4666-8666-666666666666', 'member', now() - interval '11 days');

insert into public.group_invites (group_id, token, created_by, expires_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'seedseedseedseedseedseedseedseed', '11111111-1111-4111-8111-111111111111', now() + interval '7 days'),
  -- Invitación vencida, para probar la pantalla correspondiente.
  ('aaaaaaaa-0000-4000-8000-000000000001', 'expiredexpiredexpiredexpiredexpi', '11111111-1111-4111-8111-111111111111', now() - interval '1 day');

-- ----------------------------------------------------------------------------
-- Helper para armar predicciones de ejemplo
-- ----------------------------------------------------------------------------
create or replace function pg_temp.seed_prediction(
  p_id           uuid,
  p_group        uuid,
  p_author       uuid,
  p_title        text,
  p_description  text,
  p_options      text[],
  p_opens_at     timestamptz,
  p_closes_at    timestamptz,
  p_qual_at      timestamptz,
  p_mode         public.voting_mode default 'single',
  p_interval     interval default null,
  p_is_default   boolean default false,
  p_min          integer default 3,
  p_results_vis  public.results_visibility default 'on_close'
) returns void
language plpgsql
as $$
declare
  v_label text;
  v_pos   smallint := 0;
begin
  insert into public.predictions (
    id, group_id, created_by, title, description,
    option_type, voting_mode, vote_interval,
    results_visibility, votes_visibility,
    minimum_participants, qualification_deadline, opens_at, closes_at,
    is_default, created_at
  ) values (
    p_id, p_group, p_author, p_title, p_description,
    'manual', p_mode, p_interval,
    p_results_vis, 'on_close',
    p_min::smallint, p_qual_at, p_opens_at, p_closes_at,
    p_is_default, p_opens_at
  );

  foreach v_label in array p_options loop
    insert into public.prediction_options (prediction_id, label, position, created_by)
    values (p_id, v_label, v_pos, p_author);
    v_pos := v_pos + 1;
  end loop;
end;
$$;

create or replace function pg_temp.seed_vote(
  p_prediction uuid,
  p_user       uuid,
  p_option     text,
  p_at         timestamptz,
  p_cycle      integer default 0
) returns void
language plpgsql
as $$
begin
  insert into public.prediction_votes (prediction_id, option_id, user_id, cycle, created_at, updated_at)
  select p_prediction, o.id, p_user, p_cycle::smallint, p_at, p_at
    from public.prediction_options o
   where o.prediction_id = p_prediction and o.label = p_option;
end;
$$;

-- ----------------------------------------------------------------------------
-- «Los pibes» — predicciones
-- ----------------------------------------------------------------------------

-- 1) EN PRUEBA, 2 de 3. El caso que hay que ver sí o sí en el feed.
select pg_temp.seed_prediction(
  'bbbbbbbb-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  '22222222-2222-4222-8222-222222222222',
  '¿Bauti llega después de las 22:30?',
  'El sábado en lo de Agus. Dijo que sale 21:45.',
  array['Sí', 'No', 'Dice que está llegando pero sigue en su casa'],
  now() - interval '5 hours', now() + interval '2 days', now() + interval '7 hours'
);
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Sí', now() - interval '4 hours');
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Dice que está llegando pero sigue en su casa', now() - interval '3 hours');

-- 2) ACTIVA con buena participación.
select pg_temp.seed_prediction(
  'bbbbbbbb-0000-4000-8000-000000000002',
  'aaaaaaaa-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '¿Dónde terminamos cenando el sábado?',
  null,
  array['Sushi', 'Hamburguesas', 'La pizzería de siempre'],
  now() - interval '2 days', now() + interval '3 days', now() - interval '1 day'
);
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'La pizzería de siempre', now() - interval '47 hours');
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Hamburguesas',           now() - interval '45 hours');
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'La pizzería de siempre', now() - interval '40 hours');
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'Sushi',                  now() - interval '20 hours');

-- 3) CERRADA, esperando que alguien proponga el resultado.
select pg_temp.seed_prediction(
  'bbbbbbbb-0000-4000-8000-000000000003',
  'aaaaaaaa-0000-4000-8000-000000000001',
  '33333333-3333-4333-8333-333333333333',
  '¿Quién cancela el plan del viernes?',
  null,
  array['Bauti', 'Juan', 'Agus', 'Fran', 'Nadie, sale todo'],
  now() - interval '6 days', now() - interval '10 hours', now() - interval '4 days'
);
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'Fran',            now() - interval '5 days');
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'Fran',            now() - interval '5 days');
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'Nadie, sale todo', now() - interval '4 days');
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000003', '55555555-5555-4555-8555-555555555555', 'Bauti',           now() - interval '3 days');
update public.predictions set status = 'closed' where id = 'bbbbbbbb-0000-4000-8000-000000000003';

-- 4) RESUELTA, con puntos ya repartidos.
select pg_temp.seed_prediction(
  'bbbbbbbb-0000-4000-8000-000000000004',
  'aaaaaaaa-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '¿Quién llegó último al cumple de Lu?',
  null,
  array['Bauti', 'Juan', 'Agus', 'Fran'],
  now() - interval '20 days', now() - interval '13 days', now() - interval '18 days'
);
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', 'Agus', now() - interval '19 days');
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'Bauti', now() - interval '19 days');
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'Bauti', now() - interval '18 days');
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000004', '44444444-4444-4444-8444-444444444444', 'Bauti', now() - interval '17 days');
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000004', '55555555-5555-4555-8555-555555555555', 'Agus', now() - interval '15 days');

update public.predictions p
   set status = 'resolved',
       resolved_at = now() - interval '12 days',
       resolved_option_id = (select id from public.prediction_options where prediction_id = p.id and label = 'Agus')
 where p.id = 'bbbbbbbb-0000-4000-8000-000000000004';

insert into public.prediction_resolutions (id, prediction_id, proposed_option_id, proposed_by, status, required_confirmations, created_at, settled_at)
select 'cccccccc-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000004', o.id,
       '11111111-1111-4111-8111-111111111111', 'confirmed', 2, now() - interval '12 days', now() - interval '12 days'
  from public.prediction_options o
 where o.prediction_id = 'bbbbbbbb-0000-4000-8000-000000000004' and o.label = 'Agus';

insert into public.resolution_confirmations (resolution_id, user_id, agrees, created_at) values
  ('cccccccc-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', true, now() - interval '12 days'),
  ('cccccccc-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', true, now() - interval '12 days');

select public.score_prediction('bbbbbbbb-0000-4000-8000-000000000004');

-- 5) EXPIRADA por falta de participación.
select pg_temp.seed_prediction(
  'bbbbbbbb-0000-4000-8000-000000000005',
  'aaaaaaaa-0000-4000-8000-000000000001',
  '44444444-4444-4444-8444-444444444444',
  '¿Fran se anima a cortarse el pelo?',
  null,
  array['Sí', 'No'],
  now() - interval '9 days', now() - interval '2 days', now() - interval '7 days'
);
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000005', '44444444-4444-4444-8444-444444444444', 'Sí', now() - interval '9 days');
update public.predictions set status = 'expired' where id = 'bbbbbbbb-0000-4000-8000-000000000005';

-- 6) EVOLUTIVA: seis semanas de historia, un voto por semana por persona.
select pg_temp.seed_prediction(
  'bbbbbbbb-0000-4000-8000-000000000006',
  'aaaaaaaa-0000-4000-8000-000000000001',
  '55555555-5555-4555-8555-555555555555',
  '¿Quién se muda primero?',
  'Se vota una vez por semana. Vale cambiar de opinión.',
  array['Bauti', 'Juan', 'Agus', 'Fran', 'Lu'],
  now() - interval '42 days', now() + interval '60 days', now() - interval '35 days',
  'recurring', interval '7 days', false, 3, 'always'
);
do $$
declare
  v_open   timestamptz := now() - interval '42 days';
  v_cycle  smallint;
  v_choice text;
begin
  -- La opinión del grupo se mueve de "Juan" a "Lu" alrededor de la semana 3.
  for v_cycle in 0..5 loop
    perform pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111',
      case when v_cycle < 3 then 'Juan' else 'Lu' end, v_open + v_cycle * interval '7 days' + interval '3 hours', v_cycle);
    perform pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000006', '22222222-2222-4222-8222-222222222222',
      case when v_cycle < 4 then 'Lu' else 'Lu' end,   v_open + v_cycle * interval '7 days' + interval '9 hours', v_cycle);
    perform pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000006', '33333333-3333-4333-8333-333333333333',
      case when v_cycle < 2 then 'Juan' when v_cycle < 5 then 'Fran' else 'Lu' end,
      v_open + v_cycle * interval '7 days' + interval '20 hours', v_cycle);
    if v_cycle >= 1 then
      perform pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000006', '44444444-4444-4444-8444-444444444444',
        case when v_cycle < 4 then 'Bauti' else 'Lu' end, v_open + v_cycle * interval '7 days' + interval '30 hours', v_cycle);
    end if;
  end loop;
end;
$$;

-- 7) Del sistema: activa desde el minuto cero, sin umbral que superar.
select pg_temp.seed_prediction(
  'bbbbbbbb-0000-4000-8000-000000000007',
  'aaaaaaaa-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111',
  '¿Terminamos cambiando el lugar de la juntada?',
  'Propuesta del sistema. No necesita juntar participación.',
  array['Sí, como siempre', 'No, esta vez se respeta'],
  now() - interval '6 hours', now() + interval '4 days', now() + interval '42 hours',
  'single', null, true
);
update public.predictions set status = 'active' where id = 'bbbbbbbb-0000-4000-8000-000000000007';

-- ----------------------------------------------------------------------------
-- «Fútbol 5» — existe para verificar que no se filtra nada entre grupos
-- ----------------------------------------------------------------------------
select pg_temp.seed_prediction(
  'bbbbbbbb-0000-4000-8000-000000000101',
  'aaaaaaaa-0000-4000-8000-000000000002',
  '22222222-2222-4222-8222-222222222222',
  '¿Cuántos goles hace Caro el jueves?',
  null,
  array['Ninguno', 'Uno', 'Dos o más'],
  now() - interval '1 day', now() + interval '2 days', now() + interval '1 day'
);
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000101', '22222222-2222-4222-8222-222222222222', 'Dos o más', now() - interval '20 hours');
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000101', '33333333-3333-4333-8333-333333333333', 'Uno',       now() - interval '18 hours');
select pg_temp.seed_vote('bbbbbbbb-0000-4000-8000-000000000101', '66666666-6666-4666-8666-666666666666', 'Dos o más', now() - interval '10 hours');

-- ----------------------------------------------------------------------------
-- Recalcular contadores y aplicar transiciones por tiempo
-- ----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select id from public.predictions loop
    perform public.refresh_prediction_counts(r.id);
  end loop;
end;
$$;

-- La #3 fue cerrada a mano más arriba; refresh no la toca. finalize se encarga del resto.
select public.finalize_predictions();

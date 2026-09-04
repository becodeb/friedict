-- ============================================================================
-- friedict — ajustes de grupo: quórum de cierre y calificación opt-in
-- ----------------------------------------------------------------------------
-- Archivo NUEVO, aditivo. Nada todavía lee estas columnas: el `PREDICTION_SELECT`
-- viejo y las funciones viejas siguen leyendo `predictions.qualification_percent`
-- / `close_percent`, así que el repo se mantiene verde durante toda esta fase.
--
-- El dueño lo pidió así: el quórum de cierre y si una predicción tiene que
-- "ganarse el lugar" son decisiones del GRUPO, no de cada predicción — "con
-- solo uno alcance si confías en el grupo".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Columnas nuevas en groups
-- ----------------------------------------------------------------------------
alter table public.groups
  add column close_request_quorum  smallint not null default 1
    check (close_request_quorum >= 1),
  add column qualification_enabled boolean  not null default false,
  add column qualification_percent smallint not null default 60
    check (qualification_percent between 1 and 100);

comment on column public.groups.close_request_quorum is
  'Cuántos pedidos de cierre hacen falta para cerrar una predicción sin fecha. Piso 1: con uno alcanza si el grupo confía. Se acota al conteo vivo de integrantes en required_close_requests(), nunca acá.';
comment on column public.groups.qualification_enabled is
  'Si está apagado (default), toda predicción nueva nace activa: nadie tiene que "ganarse el lugar". Si está prendido, nace en prueba hasta juntar qualification_percent% del grupo.';
comment on column public.groups.qualification_percent is
  'Porcentaje del conteo VIVO de integrantes que hace falta para calificar, cuando qualification_enabled está prendido. Sólo importa con el toggle en true.';

-- ----------------------------------------------------------------------------
-- Backfill de close_request_quorum
-- ----------------------------------------------------------------------------
-- El quórum de cierre del grupo sale del pedido MÁS FÁCIL que ya tenía alguna
-- de sus predicciones abiertas: es lo que más se parece a lo que el grupo
-- venía experimentando, y la queja del dueño era que cerrar costaba de más.
-- `min(...)` entre las predicciones abiertas del grupo, y no un promedio ni un
-- máximo: si UNA predicción ya tenía un quórum bajo, el grupo ya demostró que
-- le alcanzaba con eso.
update public.groups g set close_request_quorum = sub.q
  from (
    select p.group_id,
           greatest(1, min(least(m.n, ceil(m.n::numeric * p.close_percent / 100)::int)))::smallint as q
      from public.predictions p
      join lateral (select count(*)::int as n
                      from public.group_members gm where gm.group_id = p.group_id) m on true
     where p.status in ('proposed', 'active') and p.closes_at is null
     group by p.group_id
  ) sub
 where sub.group_id = g.id;

-- ----------------------------------------------------------------------------
-- Nada expira: qualification_deadline pasa a ser opcional
-- ----------------------------------------------------------------------------
alter table public.predictions alter column qualification_deadline drop not null;

alter table public.predictions drop constraint predictions_qualification_within_window;
alter table public.predictions add constraint predictions_qualification_within_window
  check (qualification_deadline is null
         or (qualification_deadline > opens_at
             and (closes_at is null or qualification_deadline <= closes_at)));

-- Nada lee más esta columna (finalize_predictions() se re-declara en 710_ sin
-- el paso que la consultaba): un btree sobre una columna que ninguna consulta
-- toca es puro costo de escritura.
drop index public.predictions_qualification_idx;

comment on column public.predictions.qualification_deadline is
  'Retenida como rastro de auditoría de filas anteriores a esta migración. Ya no se escribe ni se lee: nada expira más. NULL en toda predicción nueva.';

-- ----------------------------------------------------------------------------
-- "Los del grupo" en vivo: índices que sostienen add_member_option / sync
-- ----------------------------------------------------------------------------
-- Un integrante que se va conserva su opción (borrarla arrastraría los votos
-- ya emitidos por `on delete cascade`), así que la idempotencia de "no crear
-- una segunda opción al volver a entrar" no puede apoyarse en member_id +
-- prediction_id como si fuera único de por sí: hace falta el índice.
create unique index prediction_options_member_idx
  on public.prediction_options (prediction_id, member_id)
  where member_id is not null;

-- Acota el trigger de alta de integrante a las predicciones que de verdad le
-- importan: sólo las 'members' todavía abiertas. Sin este índice parcial, cada
-- ingreso a un grupo viejo con muchas predicciones cerradas escanearía filas
-- que nunca van a ganar una opción nueva.
create index predictions_open_member_options_idx on public.predictions (group_id)
  where option_type = 'members' and status in ('proposed', 'active');

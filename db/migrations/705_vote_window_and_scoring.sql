-- ============================================================================
-- friedict — ventana de cambio de voto y puntos por duración
-- ----------------------------------------------------------------------------
-- Archivo NUEVO, aditivo. Todavía nadie lee `vote_change_window`,
-- `first_cast_at`, `option_selected_at` ni `duration_multiplier`: `cast_vote` y
-- `score_prediction` siguen siendo las de 610_ hasta que 710_ las re-declare.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- predictions.vote_change_window — el cierre del exploit de cambiar el voto
-- ----------------------------------------------------------------------------
-- NULL = sin límite (hasta el cierre), mismo idioma que closes_at/expires_at
-- ya usan en esta base para "sin tope". `interval '0'` = nunca se puede
-- corregir: el primer voto queda firme al instante.
alter table public.predictions
  add column vote_change_window interval default interval '15 minutes'
    check (vote_change_window is null or vote_change_window >= interval '0');

comment on column public.predictions.vote_change_window is
  'Cuánto tiempo después de tu PROPIO primer voto podés cambiarlo. NULL = hasta el cierre. Se mide desde first_cast_at, nunca desde created_at ni desde la creación de la predicción: así cada quien tiene su propia ventana completa, sin importar cuándo votó.';

-- ----------------------------------------------------------------------------
-- prediction_votes.first_cast_at — el ancla de seguridad de la ventana
-- ----------------------------------------------------------------------------
alter table public.prediction_votes add column first_cast_at timestamptz not null default now();

comment on column public.prediction_votes.first_cast_at is
  'SEGURIDAD, no gamificación: cuándo se emitió el PRIMER voto de esta fila. cast_vote() lo escribe una sola vez y el `on conflict … do update` de la rama single JAMÁS debe reescribirlo — si lo hiciera, re-votar cada pocos minutos mantendría la ventana abierta para siempre (el mismo exploit con otra cara). Nunca usar esta columna para anticipación de puntaje: para eso está option_selected_at.';

update public.prediction_votes set first_cast_at = created_at;

-- ----------------------------------------------------------------------------
-- prediction_votes.option_selected_at — el ancla de la anticipación
-- ----------------------------------------------------------------------------
-- Segunda mitad del mismo exploit, más sutil: `score_prediction` calculaba la
-- anticipación desde `min(created_at) filter (where option_id = ganadora)`, y
-- en modo `single` hay una sola fila por persona cuyo `created_at` NUNCA se
-- reescribe. Alguien que vota mal al abrir y recién sobre el cierre —ya
-- sabiendo el resultado— cambia a la opción ganadora quedaba puntuado como si
-- la hubiera elegido desde el primer segundo: anticipación máxima con
-- información del futuro.
--
-- `option_selected_at` es la respuesta: cuándo se eligió la opción que
-- terminás teniendo, no cuándo se votó por primera vez en general. Se escribe
-- en el alta y se vuelve a escribir en el `on conflict … do update` SÓLO
-- cuando `option_id` de verdad cambia — un re-voto idéntico (idempotente) no
-- la mueve, así que sostener la misma opción durante toda la ventana no
-- castiga a nadie.
--
-- Deliberadamente NO es first_cast_at (esa es la ancla de seguridad del
-- cierre de voto, y moverla reabriría el exploit de la ventana) ni created_at
-- (que ya no debe leer nada relacionado con puntaje: por eso el fixture de
-- integration/prediction-closing.test.ts que simulaba un voto temprano se
-- actualiza para mover esta columna, no created_at). Tres columnas, tres
-- invariantes separados a propósito.
alter table public.prediction_votes add column option_selected_at timestamptz not null default now();

comment on column public.prediction_votes.option_selected_at is
  'Cuándo se eligió la opción que la fila tiene AHORA. score_prediction mide la anticipación desde acá, no desde created_at. Se reescribe en cada cambio real de option_id (nunca en un re-voto a la misma opción) — así un cambio de último momento a la opción ganadora no hereda la anticipación del primer voto (a otra opción). No confundir con first_cast_at, que es el ancla de seguridad de la ventana de cambio y nunca se toca por esto.';

update public.prediction_votes set option_selected_at = created_at;

-- ----------------------------------------------------------------------------
-- prediction_scores.duration_multiplier — puntos que escalan con lo que duró
-- ----------------------------------------------------------------------------
alter table public.prediction_scores
  add column duration_multiplier numeric(4, 2) not null default 1.0;

comment on column public.prediction_scores.duration_multiplier is
  'Multiplicador logarítmico (1.00–3.00) sobre la base, según cuánto duró REALMENTE la predicción (closed_at/resolved_at − opens_at). Se persiste, igual que los otros tres multiplicadores, para que la explicación en pantalla siempre coincida con los puntos ya repartidos aunque la fórmula cambie después.';

-- ----------------------------------------------------------------------------
-- public.duration_multiplier(interval) — puro, immutable, mismo idioma que
-- calculate_points(): la fórmula vive acá, calculate_points() no se toca.
-- ----------------------------------------------------------------------------
create or replace function public.duration_multiplier(p_span interval)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(least(3.0, greatest(1.0,
    1.0 + 0.75 * log(greatest(1.0, extract(epoch from coalesce(p_span, interval '0')) / 86400.0))
  )), 2);
$$;

comment on function public.duration_multiplier(interval) is
  'Curva logarítmica de 1.00× (≤1 día) a 3.00× (techo, alrededor de un año), redondeada a dos decimales para que la paridad con durationMultiplier() de TypeScript sea determinística. Espejo: src/lib/scoring.ts.';

-- ----------------------------------------------------------------------------
-- public.vote_change_window_of(text) — la traducción del enum de presentación
-- ----------------------------------------------------------------------------
-- create_prediction() recibe la ventana como una de cuatro palabras clave, no
-- como un interval crudo: así nunca hace falta mandar un NULL explícito por el
-- RPC (server/src/rpc.ts omite los parámetros undefined, y un NULL explícito
-- sería indistinguible de "no lo mandé") y las cuatro claves válidas se
-- validan en un solo lugar.
create or replace function public.vote_change_window_of(p_key text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case coalesce(p_key, '15m')
           when 'until_close' then null
           when '1d'          then interval '1 day'
           when '15m'         then interval '15 minutes'
           when 'never'       then interval '0'
         end;
$$;

comment on function public.vote_change_window_of(text) is
  'Traduce la clave de presentación (until_close/1d/15m/never) al interval de storage. Devuelve NULL para una clave desconocida que no sea "until_close": create_prediction() lo distingue de "hasta el cierre" y levanta invalid_vote_window.';

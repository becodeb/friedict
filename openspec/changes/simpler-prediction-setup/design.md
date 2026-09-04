# Design: Simpler Prediction Setup

> Size note: this design exceeds the usual 800-word budget on purpose, as `prediction-clarity`'s
> did. It resolves a destructive migration, three RPC signature changes, a security fix with an
> anti-ratchet invariant, a scoring formula that must stay byte-identical across two languages,
> and a partial reversal of specs that are already merged. Trimming would push those decisions
> into `sdd-apply`, which is where they get guessed wrong. `size:exception` is accepted.

## Technical Approach

Five new migration files in the `700_` series. **Never edit an existing numbered migration**:
`server/src/migrate.ts` records applied filenames in `public._migrations` and skips them forever,
so an in-place edit to `600_`/`610_` would run on a fresh `npm run db:reset` and **never** on the
deployed database — silent prod/dev divergence. `supabase/migrations/` is a dead mirror
(`migrate.ts` resolves only `db/migrations`); deliberately untouched, `rules.archive` warning
accepted.

| File | Contents |
|---|---|
| `700_group_settings.sql` | **Additive.** Group columns + `close_request_quorum` backfill (still reads `predictions.close_percent`); nullable `qualification_deadline` + NULL-tolerant constraint; drop the dead `predictions_qualification_idx`; `prediction_options_member_idx`; `predictions_open_member_options_idx` |
| `705_vote_window_and_scoring.sql` | **Additive.** `predictions.vote_change_window`; `prediction_votes.first_cast_at` + backfill; `prediction_scores.duration_multiplier`; `public.duration_multiplier(interval)`; `public.vote_change_window_of(text)` |
| `710_functions.sql` | Three `drop function`s; re-signed `required_close_requests`; `add_member_option`, `sync_member_options`, `on_member_joined` + trigger; `update_group_settings`; re-declared `refresh_prediction_counts`, `finalize_predictions`, `create_prediction`, `create_prediction_from_template`, `cast_vote`, `score_prediction`, `notify_change`, `request_close`, `withdraw_close_request`; finally, promote every `proposed` row |
| `720_rls_and_grants.sql` | `revoke`/`grant execute` for every new and re-signed function |
| `730_drop_prediction_quorum_columns.sql` | **The destructive step, alone in its own file** so the runbook can name it: drops `qualification_percent`, `close_percent`, `minimum_participants` |

The split is deliberate. Between `700_`/`705_` and `710_` the old `PREDICTION_SELECT` still works,
because nothing it reads has been removed. `710_` re-points every function at `groups` while the
old columns still exist. Only `730_` removes them, so there is never a live function referencing a
column that is gone.

---

## A. Group settings

### Decision: Three typed columns on `public.groups`, not a JSONB blob

`close_request_quorum smallint not null default 1 check (>= 1)`,
`qualification_enabled boolean not null default false`,
`qualification_percent smallint not null default 60 check (between 1 and 100)`.

| Option | Tradeoff | Decision |
|---|---|---|
| Three typed columns | CHECKs enforce the floors in the engine; `GET /groups/:id` already selects `g.*`, so the read path needs zero SQL change | **Chosen** |
| A `settings jsonb` column | One migration for any future setting, but no CHECK on the floor of 1 and no type safety in `database.types.ts` | Rejected |
| A `group_settings` side table | A join on every read for three scalars, plus a missing-row case | Rejected |

The floor of 1 is the owner's whole point (*"con solo uno alcance si confías en el grupo"*). A
floor that lives in application code is a floor a future direct write bypasses.

### Decision: The close quorum is capped at read time, not clamped at write time

`required_close_requests(p_member_count integer, p_quorum smallint)` becomes
`greatest(1, least(greatest(1, coalesce(p_member_count, 0)), coalesce(p_quorum, 1)))`.

Postgres cannot rename an input parameter through `create or replace`, and the semantics flip from
percent to count, so `710_` opens with
`drop function if exists public.required_close_requests(integer, smallint);` — and, because
dropping a function drops its grant, `720_` re-grants it.

Clamping the stored value to the member count at write time was rejected: the group row would need
rewriting on every join and leave, and a 3-member group that grew to 10 would silently keep a
quorum of 3.

### Decision: `update_group_settings` uses NULL-means-unchanged and releases stranded rows

```sql
create or replace function public.update_group_settings(
  p_group_id uuid,
  p_close_request_quorum  smallint default null,
  p_qualification_enabled boolean  default null,
  p_qualification_percent smallint default null
) returns public.groups language plpgsql security definer set search_path = ''
```

Order: `require_auth()` → `is_group_admin` else `admin_only` (42501) →
`enforce_rate_limit('update_group_settings', 30, interval '1 hour')` →
`set col = coalesce(p_col, col)` → **if qualification just went true → false,
`update predictions set status = 'active' where group_id = … and status = 'proposed'`** in the same
transaction. Now that nothing expires, a prediction left waiting for a gate that no longer exists
would be stuck forever. No per-prediction `prediction_qualified` event is emitted for that
promotion: it is one group-level decision, not N predictions each earning their place.

`is_group_admin` already returns false for a non-member (`200_functions.sql:46-54`), so a
non-member gets `admin_only` and learns nothing about the group.

---

## B. Nothing expires

Step 1 of `finalize_predictions` (`610_functions.sql:99-123`) is deleted from the re-declared
function. `qualification_deadline` drops `not null`, stops being written, and its constraint is
recreated NULL-tolerant:

```sql
alter table public.predictions alter column qualification_deadline drop not null;
alter table public.predictions drop constraint predictions_qualification_within_window;
alter table public.predictions add constraint predictions_qualification_within_window
  check (qualification_deadline is null
         or (qualification_deadline > opens_at
             and (closes_at is null or qualification_deadline <= closes_at)));
```

`predictions_qualification_idx` is dropped — nothing reads that column, and a btree on an all-NULL
column no query touches is pure write cost. The `expired` enum value stays so pre-existing rows
render; it simply becomes unreachable.

---

## C. Vote-change window (the exploit fix)

### Decision: `interval` column, NULL = until close, `'0'` = never

```sql
alter table public.predictions
  add column vote_change_window interval default interval '15 minutes'
    check (vote_change_window is null or vote_change_window >= interval '0');
```

| Option | Tradeoff | Decision |
|---|---|---|
| Nullable `interval`, `'0'` = never | One `is null` branch, which is already the house idiom for "sin límite" (`closes_at is null`, `expires_at is null`). The four product values are **data**; a fifth is a UI-only change | **Chosen** |
| `interval not null` with a sentinel like `'100 years'` for "always" | A magic constant that every reader has to decode, and arithmetic that silently works | Rejected |
| A four-value enum `vote_change_policy` | Every new value needs a migration, and the comparison becomes a `CASE` in `cast_vote` | Rejected |

That satisfies "not special-cased into ugliness": exactly one `is null` branch at the storage
layer, and no `case` in the hot path.

### Decision: a presentation enum at the wire, an open interval in storage

`create_prediction` takes `p_vote_change_window text default '15m'` with the domain
`'until_close' | '1d' | '15m' | 'never'`, translated by an immutable helper:

```sql
create or replace function public.vote_change_window_of(p_key text)
returns interval language sql immutable set search_path = '' as $$
  select case coalesce(p_key, '15m')
           when 'until_close' then null
           when '1d'          then interval '1 day'
           when '15m'         then interval '15 minutes'
           when 'never'       then interval '0'
         end;
$$;
```
`create_prediction` raises `invalid_vote_window` (22023) when the helper returns NULL for a key
that is not `'until_close'`. This avoids sending an explicit SQL NULL over the RPC boundary
(`server/src/rpc.ts` omits undefined params, so "until close" would otherwise be indistinguishable
from "not supplied"), and it validates the four supported keys in one place. It is the same
pattern the codebase already uses for `closeMode: 'date' | 'open'` over a nullable `closes_at`
(`src/lib/validation.ts:65`) — a presentation enum over an open storage type.

### Decision: `first_cast_at`, a new column, not `created_at` and not `updated_at`

```sql
alter table public.prediction_votes add column first_cast_at timestamptz not null default now();
update public.prediction_votes set first_cast_at = created_at;
```

`cast_vote`'s `on conflict … do update` sets only `option_id` and `updated_at`, so
`first_cast_at` is written once and never again. The check is
`now() <= v_existing.first_cast_at + v_pred.vote_change_window`.

**Why not `updated_at`**: it is rewritten on every change, so the window would ratchet — re-vote
every 14 minutes and it never closes. That is the exploit wearing a different hat.

**Why not `created_at`, which today already survives the upsert**: three reasons, and the third is
decisive.
1. `created_at` carries no *promise* that it survives. A future `on conflict do update set
   created_at = now()` is a one-word mistake that silently reopens the exploit, and nothing in the
   schema would object. `first_cast_at` names the invariant, so a reviewer editing `cast_vote` sees
   why they must not touch it.
2. The anti-ratchet guarantee becomes directly assertable: an integration test asserts
   `first_cast_at` is unchanged after a re-vote. Asserting that on `created_at` would be asserting
   an accident.
3. **Tests already mutate `created_at` deliberately.**
   `integration/prediction-closing.test.ts:276-279` rewrites it to simulate an early vote for the
   earliness multiplier. Sharing one column would make a scoring fixture silently a security
   fixture, and a future scoring test would move the security window without anyone noticing.

### `cast_vote` changes

In the `single` branch only, before the upsert:

```sql
select * into v_existing from public.prediction_votes
 where prediction_id = p_prediction_id and user_id = v_uid and cycle = 0;

if found
   and v_pred.vote_change_window is not null
   and now() > v_existing.first_cast_at + v_pred.vote_change_window then
  raise exception 'vote_locked' using errcode = '22023';
end if;
```

A first cast is never blocked — the window governs *changes*. `recurring` is untouched: its unique
constraint already raises `cycle_vote_used`, and a new cycle creates a new row with its own
`first_cast_at`. New `friendlyError` entry: `vote_locked`.

### Client mirror

`src/lib/prediction.ts`: `voteAvailability`'s prediction type widens to include
`'vote_change_window'`, `VoteAvailability.reason` gains `'vote_locked'`, and the `single` branch
stops returning an unconditional `canVote: true` (`prediction.ts:207-210`). It needs the user's
`first_cast_at`, which already rides in `PREDICTION_SELECT`'s `to_jsonb(v)` — free once
`database.types.ts` knows the column. Copy at `PredictionCard.tsx:267` and
`PredictionDetail.tsx:331` is rewritten from "Podés cambiarlo hasta el cierre" to the real window,
and to "Tu voto quedó firme" once elapsed.

---

## D. Presets

### Decision: purely client-side; the preset is NOT persisted

| Option | Tradeoff | Decision |
|---|---|---|
| Derive the preset from the four columns, store nothing | Zero drift; the override case is free; redefining a preset later cannot rewrite history | **Chosen** |
| A `preset` column alongside the four settings | Two sources of truth that disagree the moment a field is overridden — and override is a first-class requirement here, not an edge case | Rejected |
| A `preset` column *instead of* the settings | Cannot express an override at all | Rejected |

Three reasons, in order of weight:
1. Because per-field override is required, the row must already be able to express any combination.
   A preset column would add zero expressive power and one way to be wrong.
2. Changing a preset's definition later (say "A ciegas" becomes 30 minutes) must not retroactively
   change what an old prediction means. Storing only the columns makes an old row keep exactly what
   it was created with — the same snapshot reasoning as the member-option label rule below.
3. "A medida" is then *derived*, not stored, so it can never go stale.

```ts
// src/lib/presets.ts — pure module, no React
export type PresetId = 'open_book' | 'blind' | 'evolving'
export interface PresetSettings {
  votingMode: 'single' | 'recurring'
  resultsVisibility: 'always' | 'after_vote' | 'on_close'
  votesVisibility: 'visible' | 'on_close' | 'anonymous'
  voteChangeWindow: 'until_close' | '1d' | '15m' | 'never'
}
export const PREDICTION_PRESETS: Record<PresetId, PresetSettings>
export function presetFor(s: PresetSettings): PresetId | 'custom'
```

`presetFor` is called during render, matching the codebase's established "derive during render, not
in an effect" pattern (`CreatePredictionSheet.tsx:131-135`, `PredictionCard.tsx:65-70`). It is
exhaustively unit-testable with no React involved.

### Form information architecture (rewritten for presets)

The default path must be **question → options → preset → done**.

| Zone | Contents | Change |
|---|---|---|
| 1. La pregunta | título, contexto, "Las opciones son…", opciones | unchanged |
| 2. **¿Cómo se juega?** | `Segmented columns={2}` with the four presets and the owner's descriptions, plus a `HelpTip` | **new** — sits exactly where the three deleted fields used to be |
| 3. El cierre | "¿Cuándo cierra?" + the date field, or the static group-quorum line | unchanged from the group-settings work |
| 4. Evolutiva | interval field + rounds preview, rendered when `votingMode === 'recurring'` | unchanged; the Evolutiva preset's own copy promises "cada X días", so the field must stay visible |
| 5. "Más opciones" (collapsed) | **Modo** (`single`/`recurring`), "Ver los números", "Ver quién eligió qué", **"¿Hasta cuándo se puede corregir el voto?"**, "Dejar que agreguen opciones" | the old "Modo" segmented moves in here; the vote-window control is new; "Para que la predicción quede" is gone entirely |

Zone 2 replaces the old standalone "Modo" segmented in the always-visible area, so the visible
height does not grow despite gaining a control. Picking "A medida" auto-expands zone 5. Editing any
control in zone 5 re-derives zone 2 to "A medida" on the next render.

Note this **supersedes** the form IA planned before presets existed: `voting_mode` is no longer an
always-visible control, and a fourth override (`voteChangeWindow`) joins the advanced panel.

---

## E. Duration-scaled points

### Decision: scale the base argument; leave `calculate_points` byte-identical

`calculate_points(p_base, …)` already takes the base as a parameter and `score_prediction` passes a
literal `100` (`610_functions.sql:531`). So this is a base-scaling change:

```sql
v_actual_close := coalesce(v_pred.closed_at, v_pred.resolved_at, now());
v_duration     := public.duration_multiplier(v_actual_close - v_pred.opens_at);
v_points       := public.calculate_points(round(100 * v_duration)::integer, …);
```

`v_close` — the earliness denominator, `coalesce(closes_at, closed_at, resolved_at, now())` — is
kept exactly as it is. `v_actual_close` is separate on purpose: earliness is measured against the
*planned* horizon when there is one, duration against what *actually* elapsed. Conflating them
would silently change earliness for every dated prediction.

| Option | Tradeoff | Decision |
|---|---|---|
| Scale `p_base`, add a separate `duration_multiplier` helper | `calculate_points` and its parity grid are untouched, so the load-bearing formula carries zero regression risk; the new logic is one small function with its own parity grid | **Chosen** |
| Add a `p_duration_ratio` parameter to `calculate_points` | Changes the signature of the one function the whole scoring system rests on, and invalidates the existing parity grid | Rejected |
| Compute the multiplier inline in `score_prediction` | Not `immutable`, not reusable by the client, and impossible to parity-test | Rejected |

```sql
create or replace function public.duration_multiplier(p_span interval)
returns numeric language sql immutable set search_path = '' as $$
  select round(least(3.0, greatest(1.0,
    1.0 + 0.75 * log(greatest(1.0, extract(epoch from coalesce(p_span, interval '0')) / 86400.0))
  )), 2);
$$;
```

`log(numeric)` is base-10 and immutable; `extract(epoch from interval)` is immutable. Rounding to
**two decimals** is what makes cross-language parity deterministic — it is also the precision the
other three multipliers are already stored at (`610_functions.sql:540-542`). The TS mirror takes
days rather than an interval and trims float noise before rounding, exactly as `calculatePoints`
already does (`scoring.ts:81`):

```ts
export const MAX_DURATION = 3
export function durationMultiplier(days: number): number {
  const d = Number.isFinite(days) ? Math.max(1, days) : 1
  const raw = Math.min(MAX_DURATION, Math.max(1, 1 + 0.75 * Math.log10(d)))
  return Math.round((Math.round(raw * 1e6) / 1e6) * 100) / 100
}
```

Reference points: 1 day → 1.0×, 10 → 1.75×, 100 → 2.5×, 365 → 2.93×, capped at 3.0×.

### Surfacing it

`prediction_scores` gains `duration_multiplier numeric not null default 1.0`, stored by
`score_prediction` alongside the existing three. The UI reads the **persisted** value, so the
explanation always reconciles with the points actually awarded even if the formula changes later —
the same reason the other three are stored rather than recomputed.

`ScoreInput` gains `durationDays?: number`; `ScoreBreakdown` gains `duration: number` and keeps
`base` at 100, so the sentence at `PredictionDetail.tsx:506-523` reads naturally: *"Tus N puntos
salen de 100 base × 2.5 porque duró 100 días × 1.4 por lo poco elegida que estaba × …"*. A 1.00
duration factor is omitted rather than printed.

The create form gets one line: with a closing date, "si dura hasta esa fecha vale ~1.8× puntos";
with open-ended close, "cuanto más dure, más vale — hasta 3×". That is the moment the horizon is
chosen, so it is the moment the rule is actionable.

The docblock at `scoring.ts:12` ("Techo: 225") becomes wrong for real awards and must be corrected:
225 is the ceiling **at base 100**; with the duration multiplier the base reaches 300, so the real
ceiling is 675.

---

## F. Live "los del grupo" options

### Decision: a trigger on `group_members`, not a call inside `join_group`

| Option | Tradeoff | Decision |
|---|---|---|
| `after insert on group_members` trigger | Cannot be bypassed by `db/seed.sql`, an admin script or a future join path; fires uselessly once per `create_group`, where the group has zero predictions | **Chosen** |
| Explicit `perform sync_member_options(...)` in `join_group` | Matches the house style of domain effects living in `security definer` functions, but any other writer of `group_members` silently produces a member with no option | Rejected |

A member who exists but is not an option in a live "los del grupo" prediction is voted *about* but
not votable *for*, and nobody notices until someone asks why. Cost is bounded by a partial index:

```sql
create index predictions_open_member_options_idx on public.predictions (group_id)
  where option_type = 'members' and status in ('proposed', 'active');
```

### Decision: leaving keeps the option; labels are deduped at insert and never rewritten

`prediction_votes.option_id` is `on delete cascade` (`100_schema.sql:238`). Deleting a departed
member's option would **delete every vote cast for it**, silently changing `participant_count` and
the tallies — and if that option is a `resolved_option_id`, the `on delete restrict` FK
(`100_schema.sql:209-211`) makes the delete fail outright. So leaving never removes the option.

`unique (prediction_id, label)` (`100_schema.sql:204`) means two members named "Juan" collide, and
`upsert_profile` lets a name change at any time. One helper owns both rules:

- Base label = `left(btrim(display_name), 56)`; on collision try `' (2)'`…`' (12)'`, so the label
  always fits the `between 1 and 60` CHECK.
- Idempotence via a new partial unique index, so a re-joiner never gets a second option:
  ```sql
  create unique index prediction_options_member_idx
    on public.prediction_options (prediction_id, member_id) where member_id is not null;
  ```
- **A rename never rewrites an existing label.** Rewriting would relabel an option people already
  voted for. The label is a snapshot of the name when the option was created.

`create_prediction`, `create_prediction_from_template` and `sync_member_options` all go through
`add_member_option`, so the rule exists once.

---

## G. Signatures, registration and grants

`create or replace` with a different argument list creates an **overload**, not a replacement.
`710_` opens with the exact current lists, read from `db/rpc-functions.json`:

```sql
drop function if exists public.create_prediction(
  uuid, text, text[], timestamptz, text, public.option_source, public.voting_mode,
  interval, boolean, public.results_visibility, public.votes_visibility,
  smallint, smallint, integer);
drop function if exists public.create_prediction_from_template(uuid, uuid, timestamptz, integer);
drop function if exists public.required_close_requests(integer, smallint);
```

New signatures — `create_prediction` loses three params and gains one, so **12 args**:

```sql
create_prediction(p_group_id uuid, p_title text, p_options text[],
  p_closes_at timestamptz default null, p_description text default null,
  p_option_type public.option_source default 'manual',
  p_voting_mode public.voting_mode default 'single',
  p_vote_interval interval default null, p_allow_new_options boolean default false,
  p_results_visibility public.results_visibility default 'on_close',
  p_votes_visibility public.votes_visibility default 'on_close',
  p_vote_change_window text default '15m')

create_prediction_from_template(p_group_id uuid, p_template_id uuid, p_closes_at timestamptz)
```

Integration tests assert `select count(*) from pg_proc where proname = …` = 1 for both — the guard
against a surviving overload.

`720_` revokes from all three roles **before** granting, exactly as `620_` does, because
`ALTER DEFAULT PRIVILEGES` in an earlier migration does not suppress the implicit PUBLIC EXECUTE
that Postgres grants functions created in later files:

```sql
revoke execute on function
  public.update_group_settings(uuid, smallint, boolean, smallint),
  public.required_close_requests(integer, smallint),
  public.duration_multiplier(interval),
  public.vote_change_window_of(text),
  public.add_member_option(uuid, uuid, uuid),
  public.sync_member_options(uuid, uuid),
  public.on_member_joined(),
  public.create_prediction(uuid, text, text[], timestamptz, text, public.option_source,
    public.voting_mode, interval, boolean, public.results_visibility, public.votes_visibility,
    text),
  public.create_prediction_from_template(uuid, uuid, timestamptz)
from public, anon, authenticated;

grant execute on function
  public.update_group_settings(uuid, smallint, boolean, smallint),
  public.required_close_requests(integer, smallint),
  public.duration_multiplier(interval),
  public.create_prediction(…),
  public.create_prediction_from_template(uuid, uuid, timestamptz)
to authenticated;
```

`duration_multiplier` is granted because it is a pure calculation helper, exactly like
`calculate_points`, which is already in `RPC_PUBLICA`. `vote_change_window_of`,
`add_member_option`, `sync_member_options` and `on_member_joined` stay revoked forever — they are
`security definer` internals, like `group_member_count`. `integration/grants.test.ts` is the net.

---

## Data Flow

```
  group settings sheet ──rpc update_group_settings──► groups (3 columns)
       │                        └──► qualification OFF: proposed ──► active (same txn)
       │
  create sheet ──preset fills 4 fields (client only, nothing persisted)
       │        ──rpc create_prediction──► reads groups.qualification_enabled
       │                                   ──► status = active | proposed
       │                                   ──► vote_change_window_of('15m') → interval
       │                                   ──► qualification_deadline = NULL
       │
  join_group ──► group_members INSERT ──trigger──► sync_member_options
       │                                            └─► add_member_option per open
       │                                                option_type='members' prediction
  leave_group ──► group_members DELETE ──► NOTHING. The option stays.
       │
  cast_vote (single) ──► existing row?
       │                   └─ yes, now() > first_cast_at + window ──► raise vote_locked
       │                   └─ yes, inside window ──► update option_id, updated_at
       │                                             (first_cast_at UNTOUCHED)
       │                   └─ no ──► insert, first_cast_at = now()
       │
  request_close ──► live count >= required_close_requests(member_count,
       │                            groups.close_request_quorum)? ──yes──► closed, closed_at=now()
       │
  score_prediction ──► v_actual_close = coalesce(closed_at, resolved_at, now())
                       duration_multiplier(v_actual_close - opens_at)  → 1.0 … 3.0
                       calculate_points(round(100 * duration), share, n, early, conviction)
                       └─► prediction_scores.duration_multiplier (persisted, shown in the UI)

  read path:  GET /groups/:id   → g.* (3 new columns, no SQL change)
              PREDICTION_SELECT → join groups g + lateral member count
                                  → member_count, required_participants, close_required,
                                    my_close_request; votes carry first_cast_at
```

## File Changes

| File | Action | Description |
|---|---|---|
| `db/migrations/700_group_settings.sql` | Create | Group columns + backfill; nullable `qualification_deadline`; drop `predictions_qualification_idx`; two new indexes |
| `db/migrations/705_vote_window_and_scoring.sql` | Create | `vote_change_window`, `first_cast_at` + backfill, `prediction_scores.duration_multiplier`, `duration_multiplier()`, `vote_change_window_of()` |
| `db/migrations/710_functions.sql` | Create | Three drops; re-signed `required_close_requests`; member-option helpers + trigger; `update_group_settings`; nine re-declared functions; promote `proposed` → `active` |
| `db/migrations/720_rls_and_grants.sql` | Create | `revoke`/`grant execute` |
| `db/migrations/730_drop_prediction_quorum_columns.sql` | Create | The destructive drop |
| `db/seed.sql` | Modify | `seed_prediction` loses `p_min`, stops writing `minimum_participants`/`qualification_deadline`; demo group sets `qualification_enabled = true`; the seeded `expired` row stays as the pre-existing-row fixture |
| `db/rpc-functions.json` | Modify | Add `update_group_settings` (`row`); re-sign `create_prediction` (−3 +1, `p_vote_change_window: "text"`) and `create_prediction_from_template` (−1) |
| `server/src/prediction-select.ts` | Modify | `join public.groups g`; derive `required_participants`/`close_required` from `g` |
| `src/lib/database.types.ts` | Modify | `groups` +3; `predictions` +`vote_change_window`, −3 (in `730_`), nullable `qualification_deadline`; `prediction_votes` +`first_cast_at`; `prediction_scores` +`duration_multiplier`; three `Functions` entries |
| `src/lib/prediction.ts` | Modify | `StatusInput` drops `qualification_deadline`; no expiry branch; `vote_locked` in `voteAvailability`; count-based `requiredCloseRequestsPreview` |
| `src/lib/scoring.ts` | Modify | `durationMultiplier`, `MAX_DURATION`, `ScoreInput.durationDays`, `ScoreBreakdown.duration`, corrected ceiling docblock |
| `src/lib/presets.ts` | Create | `PREDICTION_PRESETS`, `presetFor` — pure, no React |
| `src/lib/validation.ts` | Modify | `createPredictionSchema` −3 fields +`voteChangeWindow`; new `groupSettingsSchema` |
| `src/lib/errors.ts` | Modify | `vote_locked`, `invalid_vote_window` |
| `src/data/groups.ts` | Modify | `useUpdateGroupSettings(groupId)` |
| `src/data/predictions.ts` | Modify | `CreatePredictionVars` −3 +`voteChangeWindow`; `PredictionScoreRow` +`duration_multiplier` |
| `src/components/prediction/CreatePredictionSheet.tsx` | Modify | Preset row; the three removed fields; Modo and the window move into "Más opciones"; points-preview line |
| `src/components/prediction/PredictionCard.tsx` | Modify | `vote_locked` copy replaces "Podés cambiarlo hasta el cierre" |
| `src/routes/PredictionDetail.tsx` | Modify | Same copy; extended `explainScore` sentence |
| `src/routes/GroupSettings.tsx` | Modify | New "Cómo funciona este grupo" section |
| `src/routes/GroupFeed.tsx` | Modify | Hide the "En prueba" tab when qualification is off |
| `src/routes/Landing.tsx`, `README.md` | Modify | Reframe qualification as opt-in and never-expiring |
| `integration/helpers.ts`, `e2e/support.ts` | Modify | `timeTravel` stops shifting the dead `qualification_deadline`; gains a `first_cast_at` shift so the lockout is testable |
| `src/components/prediction/ParticipationThreshold.tsx` | **Unchanged** | Props already right; it simply stops being rendered when nothing is `proposed` |
| `supabase/**` | **Untouched** | Dead mirror |

## Testing Strategy

Strict TDD (`openspec/config.yaml:10`). Green baseline: `npm run test` 149,
`npm run test:integration` 95. `npm run test:e2e` is **not runnable here** — Playwright browsers
are not installed.

| Layer | What | Where |
|---|---|---|
| Unit | `effectiveStatus` never returns `expired`; count-based `requiredCloseRequestsPreview` | `src/lib/prediction.test.ts` |
| Unit | `voteAvailability` returns `vote_locked` past the window, allows inside it, ignores it for `recurring` and for a first vote | `src/lib/prediction.test.ts` |
| Unit | `presetFor` exhaustive: each preset round-trips, one overridden field → `custom` | new `src/lib/presets.test.ts` |
| Unit | `durationMultiplier` reference points, floor, cap, non-finite input | `src/lib/scoring.test.ts` |
| Unit | `explainScore` includes `duration`; corrected ceiling | `src/lib/scoring.test.ts` |
| Unit | Schemas: 3 fields gone, `voteChangeWindow` enum, `groupSettingsSchema` bounds | `src/lib/validation.test.ts` |
| Unit | Sheet: preset row present, picking one sets four fields, overriding flips to "A medida", removed `HelpTip`s absent | `CreatePredictionSheet.test.tsx` |
| Unit | Group settings: admin controls vs non-admin read-only; percentage hidden when off; quorum floor 1 capped at members | new `src/routes/GroupSettings.test.tsx` |
| Integration | Exactly one `create_prediction` and one `create_prediction_from_template` in `pg_proc` | `prediction-qualification.test.ts` |
| Integration | Default group → `active`; toggle on → `proposed`; toggle off releases; nothing expires | `prediction-qualification.test.ts` |
| Integration | Quorum 1 closes on first request; capped at member count; departed request stops counting | `prediction-closing.test.ts` |
| Integration | `update_group_settings` authorization matrix and CHECKs | new `group-settings.test.ts` |
| Integration | Late joiner, leaver keeps option **and votes**, rejoin, duplicate names, rename, closed untouched | new `member-options.test.ts` |
| Integration | `vote_locked` past the window; allowed inside; **`first_cast_at` unchanged after a re-vote (anti-ratchet)**; first cast never locked; `never` locks immediately; `until_close` never locks; `recurring` still raises `cycle_vote_used` | new `vote-window.test.ts` |
| Integration | Duration parity grid; `calculate_points` grid still passes unmodified; helper is `immutable` | `scoring-parity.test.ts` |
| Integration | Grants: `update_group_settings` and `duration_multiplier` public; the four internals not | `grants.test.ts` |
| E2E | Preset flow; a locked vote cannot be changed | written, **not run** |

### Tests that assert removed behaviour and MUST be rewritten, not deleted

Located by reading them, not guessed.

| File:line | Asserts today | Rewrite to |
|---|---|---|
| `src/lib/prediction.test.ts:211-216` | "se puede CAMBIAR el voto hasta el cierre" — `canVote: true` with an existing vote | Editable only inside the window; `vote_locked` after; still true with `until_close` |
| `src/lib/prediction.test.ts:121-136` | `effectiveStatus` returns `expired` past the deadline | Never returns `expired`; a pre-existing `expired` row stays `expired` |
| `src/lib/prediction.test.ts:42,125,133,140,168,265` | `StatusInput` fixtures carry `qualification_deadline` | Drop the field |
| `src/lib/prediction.test.ts:429-449` | `requiredCloseRequestsPreview(1,50)===2`, `(2,100)===2` (percent, floor 2) | Count: `(1,1)===1`, `(5,3)===3`, `(2,9)===2` |
| `integration/flow.test.ts:261-277` | "cambiar el voto NO suma un participante nuevo" — changes freely | Still true, but the change must happen inside the window, or with the window set to `until_close` |
| `integration/flow.test.ts:171-186` | "una predicción nueva arranca en prueba" | Born `active` by default; `proposed` only with the toggle on |
| `integration/flow.test.ts:207-243` | `p_qualification_percent: 0` rejected; requirement capped | Move onto `update_group_settings` / the group CHECK |
| `integration/flow.test.ts:245-301` | the "umbral de las 3 personas" walk-through | Same walk-through with the toggle explicitly enabled |
| `integration/flow.test.ts:303-329` | "una predicción con 2 votantes expira al vencer el plazo" | It does **not** expire, ever |
| `integration/flow.test.ts:180,309,436` | `p_qualification_hours` | Drop the argument |
| `integration/prediction-qualification.test.ts:132-155` | `finalize_predictions` sets `expired` | Stays `proposed` with the toggle on; `active` with it off |
| `integration/prediction-qualification.test.ts:21,84,92,140` | passes `p_qualification_percent`/`_hours` | Set the group setting first |
| `integration/prediction-qualification.test.ts:157-235` | the `minimum_participants` backfill | The group-level backfill and the promotion |
| `integration/prediction-closing.test.ts:93-107,140-177,179-225,227-260,262-308` | passes `p_close_percent` | Set `close_request_quorum` on the group |
| `integration/prediction-closing.test.ts:42-57,59-67` | grants lists | Add `update_group_settings`, `duration_multiplier`, and the four internals |
| `integration/prediction-closing.test.ts:262-308` | the earliness fix, by rewriting `created_at` | Keep — and add an explicit comment that it must NOT be switched to `first_cast_at`, which is the security anchor |
| `integration/grants.test.ts:16-58,117-137` | `RPC_PUBLICA` / `internas` | Add the two public and four internal functions |
| `integration/realtime.test.ts:96-134` | `p_qualification_percent: 100` | Enable the toggle at 100% on the group first |
| `integration/predictions-read.test.ts:11-49` | `p_qualification_percent`/`p_close_percent` drive the derived fields | The group settings drive them |
| `integration/scoring-parity.test.ts:14-104` | parity grid at a fixed base of 100 | Keep verbatim (it proves `calculate_points` did not move) **and add** a duration grid |
| `src/lib/scoring.test.ts:77-86` | "nunca supera el techo de 225" at the default base | Keep for base 100; add the real ceiling of 675 with the duration multiplier at its cap |
| `src/components/prediction/CreatePredictionSheet.test.tsx:32-39,50-61` | the three removed `HelpTip`s exist | Assert **absent**; add the preset row and window assertions |
| `src/components/prediction/PredictionCard.test.tsx:24-26,29` | fixture carries the four dropped/renamed columns | Drop them; add `vote_change_window` and `first_cast_at` |
| `e2e/invitado.spec.ts:50` | copy `/tu voto quedó guardado\|podés cambiarlo/i` | New copy naming the real window |
| `e2e/invitado.spec.ts:57-81` | "puede cambiar su voto hasta el cierre" | Can change **inside** the window; cannot after. Written, **not run** |

Gate per work unit:
`npm run typecheck && npm run lint && npm run test && npm run test:integration`.

## Threat Matrix

The reference matrix covers VCS/shell/PR/subprocess boundaries. None exists here.

| Boundary | Applicability | Reason |
|---|---|---|
| Documentation-like paths | N/A | No file-classification or execution boundary |
| Git repository selection | N/A | No `git` invocation, no `-C`, no cwd authority |
| Commit / push state | N/A | No index, worktree or push automation |
| PR commands | N/A | No PR automation |
| Shell / subprocess | N/A | No process is spawned |

The applicable boundaries are **authorization**, **destructive data** and **score integrity**,
which the reference matrix does not model. Enumerated instead, and carried into `tasks.md`
unchanged:

| Adversarial case | Expected safe behaviour |
|---|---|
| Plain `member` calls `update_group_settings` | `admin_only` (42501); nothing written |
| Non-member calls it with a real group id | `admin_only`; nothing leaked about the group |
| `close_request_quorum = 0` | CHECK rejects; no prediction becomes uncloseable |
| `qualification_percent` 0 or 101 | CHECK rejects |
| Quorum far above member count | Read-time cap = member count; always closeable |
| `p_is_default` or a status passed to `create_prediction` | Fails: no such parameter |
| **Change a vote after the window, straight at the RPC** | `vote_locked` (22023); stored `option_id` unchanged |
| **Re-vote every 14 minutes to hold a 15-minute window open** | Blocked: `first_cast_at` is never rewritten, so the deadline is fixed at the first cast |
| **Vote late, then claim the early-voter anchor** | The window is per-user, so a late voter gets their own full window and no more |
| `p_vote_change_window` set to an unknown key | `invalid_vote_window` (22023); no row created |
| Negative `vote_change_window` written directly | CHECK rejects |
| Delete a departed member's option by hand | Never done in code; if forced, `on delete cascade` destroys real votes and `on delete restrict` blocks it for a resolved option — hence the never-delete rule |
| Two identical display names race to join | Both get an option; `unique (prediction_id, label)` holds via the `(2)` suffix; `(prediction_id, member_id)` prevents duplicates |
| Repeated leave/rejoin | Exactly one option, enforced by the partial unique index |
| **Sit on a trivial prediction for a year to farm points** | Log curve + 3.0× cap bounds the payoff; otherwise accepted — see the proposal's risks section |

## RLS / Auth Implications

- No RLS policy changes. `groups_select_members` (`300_rls.sql:142-144`) already lets a member read
  `g.*`, so the three new columns are readable by exactly the right people. `groups` has no write
  policy, so the only writer is the `security definer` RPC — the house style from
  `100_schema.sql:372-404`.
- `prediction_votes.first_cast_at` is covered by the existing
  `prediction_votes_select_own_or_visible` policy (`300_rls.sql:177-179`): you always see your own
  row, so you always know your own deadline; other people's `first_cast_at` is as private as their
  vote already is. No new leak.
- `PREDICTION_SELECT` runs under `queryAs`/`withUser`, so the new `join public.groups g` is filtered
  by `groups_select_members`. Inner join, not left: if you cannot read the group you cannot read its
  predictions, and a left join would emit a prediction row with a null requirement that the client
  type says is a number.
- `add_member_option` / `sync_member_options` are `security definer` because the trigger must not
  depend on the joiner's RLS over `prediction_options`. Both stay revoked from every role.
- `cast_vote` and `score_prediction` remain `security definer` with unchanged reachability;
  `score_prediction` stays revoked (it writes the score table).

## Migration / Rollout

**Destructive.** `730_` MUST be preceded by a database snapshot in the deploy runbook; it is the
only artifact that can restore `qualification_percent` / `close_percent`.

Backfills, in `700_`/`705_`, while the old columns and semantics are still readable:

```sql
-- 700_: el quórum de cierre del grupo sale del pedido MÁS FÁCIL que ya tenía
-- alguna de sus predicciones abiertas: es lo que más se parece a lo que el grupo
-- venía experimentando, y la queja del dueño es que cerrar costaba de más.
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

-- 705_: el ancla de la ventana para los votos que ya existen es cuándo se
-- votaron de verdad.
update public.prediction_votes set first_cast_at = created_at;

-- 710_, última sentencia, ya con finalize_predictions redeclarada: todos los
-- grupos arrancan con la calificación apagada, así que ninguna predicción queda
-- esperando una puerta que ya no existe.
update public.predictions set status = 'active' where status = 'proposed';
```

`qualification_enabled`, `qualification_percent`, `vote_change_window` and `duration_multiplier`
take their column defaults for every existing row: no group is opted into qualification without
asking, and every existing prediction inherits the "A ciegas" 15-minute window. What that loses is
listed in the proposal.

Rollout is a single PR to `main` (`size:exception` accepted). SQL, server and client must ship
together: the moment `predictions.close_percent` is dropped, the old `PREDICTION_SELECT` fails.

## Open Questions

- [ ] Earliness still rewards a hindsight switch on the "A libro abierto" preset, via
      `min(created_at)` in `score_prediction`. Recorded as a known consequence in the proposal's
      risks and proposed as a **follow-up change**, because anchoring earliness to "when the vote
      landed on that option" changes scoring semantics for every prediction and was not requested.

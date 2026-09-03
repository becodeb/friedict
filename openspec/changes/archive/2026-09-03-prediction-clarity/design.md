# Design: Prediction Clarity

> Size note: this design exceeds the usual 800-word budget on purpose. The orchestrator asked for seven
> named architectural problems resolved down to exact columns, signatures, files and props. Trimming
> would push those decisions into `sdd-apply`, which is where they get guessed wrong.

## Technical Approach

Eight deliverables, one shared SQL surface. All schema and function work lands in **new** `db/migrations/600_*.sql`
files, never in `100_`/`200_`/`300_`. `server/src/migrate.ts:140-162` records each applied filename in
`public._migrations` and skips it forever, so an in-place edit to `200_functions.sql` would run on a fresh
`scripts/db-reset.mjs` and **never** on the deployed database — silent prod/dev divergence.

`supabase/migrations/` is a **dead mirror**. No code path reads it: `migrate.ts:44` resolves only
`db/migrations`, and `scripts/db-reset.mjs` does the same. The two trees are already out of sync since the
Supabase→Express move. It is left untouched deliberately; the `rules.archive` warning in
`openspec/config.yaml:67` will fire and is accepted.

Migration files:

| File | Contents |
|---|---|
| `600_quorum_and_open_close.sql` | Columns, constraints, `prediction_close_requests`, pure quorum functions, indexes |
| `610_functions.sql` | Re-declared `refresh_prediction_counts`, `finalize_predictions`, `create_prediction`, `cast_vote`, `add_prediction_option`, `score_prediction`, `notify_change`; new `request_close`/`withdraw_close_request` |
| `620_rls_and_grants.sql` | RLS on the new table, `revoke`/`grant execute` for every new and re-signed function |

Postgres `create or replace function` with a changed argument list creates an **overload**, not a replacement.
`create_prediction` is the only function whose signature changes, so `610` opens with the exact old list:

```sql
drop function if exists public.create_prediction(
  uuid, text, text[], timestamptz, text, public.option_source, public.voting_mode,
  interval, boolean, public.results_visibility, public.votes_visibility, smallint, integer);
```

Dropping a function also drops its `grant execute`, so `620` re-grants it.

---

## A. Quorum data model

### Storage

New columns on `public.predictions` (all additive, all with defaults, no rewrite of existing rows):

```sql
alter table public.predictions
  add column qualification_percent smallint not null default 60
    check (qualification_percent between 1 and 100),
  add column close_percent smallint not null default 50
    check (close_percent between 1 and 100),
  add column close_request_count integer not null default 0
    check (close_request_count >= 0),
  add column closed_at timestamptz;
```

`minimum_participants` is **kept, never dropped, and stops being read**. A `comment on column` marks it as
retained only so the rollback in the proposal stays a pure code revert. Backfill so today's rows keep today's
requirement:

```sql
update public.predictions p
   set qualification_percent = least(100, greatest(1,
         ceil(p.minimum_participants::numeric * 100
              / greatest(1, (select count(*) from public.group_members g where g.group_id = p.group_id)))::int))
 where p.status in ('proposed', 'active');
```

### Computation: pure function + per-group count, not a generated column, not a trigger

```sql
create or replace function public.required_participants(p_member_count integer, p_percent smallint)
returns integer language sql immutable set search_path = '' as $$
  select greatest(1, least(
    greatest(0, coalesce(p_member_count, 0)),
    ceil(greatest(0, coalesce(p_member_count, 0))::numeric * coalesce(p_percent, 60) / 100)::integer
  ));
$$;

create or replace function public.required_close_requests(p_member_count integer, p_percent smallint)
returns integer language sql immutable set search_path = '' as $$
  select greatest(2, least(
    greatest(0, coalesce(p_member_count, 0)),
    ceil(greatest(0, coalesce(p_member_count, 0))::numeric * coalesce(p_percent, 50) / 100)::integer
  ));
$$;
```

The `least(member_count, …)` cap is the bug fix — it is what lets a 2-member group qualify, and it is the
part that must never be dropped in review. The `greatest(1, …)` / `greatest(2, …)` are the absolute floors
from the settled decisions.

| Option | Tradeoff | Decision |
|---|---|---|
| Generated column | Impossible: a generated column must be `immutable` and cannot read `group_members` | Rejected |
| Trigger recomputing a stored column on every join/leave | Writes one row per prediction per membership change; each write fires `notify_predictions` (`400_notify_and_cron.sql:88`) → realtime storm; still stale if the trigger is ever skipped | Rejected |
| **Pure function over a member count aggregated once per group** | Correct by construction, never stale, cost bounded | **Chosen** |

The functions take the member count **as an argument**, which is what makes them `immutable` and inlinable.
The count is aggregated once per group, not once per row.

### Cost inside `finalize_predictions` (runs every 60s over all rows, `server/src/index.ts:144-148`)

`finalize_predictions` is re-declared to open with one CTE and join it:

```sql
with counts as (
  select group_id, count(*)::integer as member_count
    from public.group_members
   where (p_group_id is null or group_id = p_group_id)
   group by group_id
)
```

`group_members`' primary key is `(group_id, user_id)`, so `group by group_id` is an index-only scan. Steps 1
and 2 then read `public.required_participants(c.member_count, p.qualification_percent)` instead of
`p.minimum_participants`. The per-row cost is an inlined arithmetic expression — no extra I/O versus today.

Single-row callers (`refresh_prediction_counts`, `cast_vote`, `request_close`) use a stable helper:

```sql
create or replace function public.group_member_count(p_group_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.group_members where group_id = p_group_id;
$$;
```

`security definer` because `notify_change()` also calls it and triggers must not depend on the caller's RLS.

### How the client mirror stays honest

The client receives the prediction row but **does not know the group's member count** — `PredictionCard`
receives only `prediction`, `groupId`, `userId`. `PredictionDetail` happens to have `useMembers(groupId)`,
but relying on that would make the feed and the detail disagree.

So the requirement is computed **server-side and shipped on the row**. `PREDICTION_SELECT`
(`server/src/routes.ts:35-75`) gains a lateral join and three derived fields:

```sql
  from public.predictions p
  left join lateral (
    select count(*)::integer as member_count
      from public.group_members gm
     where gm.group_id = p.group_id
  ) mc on true
```

selecting additionally:

```sql
    mc.member_count,
    public.required_participants(mc.member_count, p.qualification_percent) as required_participants,
    public.required_close_requests(mc.member_count, p.close_percent)       as close_required,
    exists (
      select 1 from public.prediction_close_requests q
       where q.prediction_id = p.id and q.user_id = (select public.current_user_id())
    ) as my_close_request
```

This runs under `queryAs` / `withUser`, so RLS applies: `group_members_select_members`
(`300_rls.sql:147-149`) lets a member count their own group exactly, and a non-member never sees the outer
`predictions` row at all. No `security definer` needed in the read path. `required_participants` and
`required_close_requests` must be granted to `authenticated` (they run as the app role).

Client types (`src/lib/types.ts`), on `Prediction` — **not** on `PredictionRow`, because they are derived,
not columns:

```ts
export interface Prediction extends PredictionRow {
  member_count: number
  required_participants: number
  close_required: number
  my_close_request: boolean
  // …existing fields
}
```

`src/lib/prediction.ts` changes shape rather than defaulting:

```ts
export type StatusInput = Pick<PredictionRow,
  'status' | 'is_default' | 'participant_count' | 'qualification_deadline' | 'closes_at'
> & { required_participants: number }
```

`required_participants` is **required**, not optional with a fallback to `minimum_participants` — an optional
field with a fallback would silently reintroduce the hidden-3 bug on any payload that forgot it. TypeScript
forces every call site to supply it. `hasQualified()` and `participantsMissing()` keep their signatures; only
their callers change what they pass.

Realtime: `notify_change()` (`400_notify_and_cron.sql:62-70`) currently emits `minimum_participants`. It is
re-declared to emit `required_participants` computed from `public.group_member_count(v_group)` and the row's
`qualification_percent`. That is one count per `predictions` notify — a low-frequency table (status and
counter changes only). `server/src/realtime.ts:33`, `src/data/realtime.ts:38,152` and the toast at
`src/components/layout/GroupShell.tsx:64` follow.

`ParticipationThreshold` gains `memberCount: number` and renames `minimumParticipants` → `requiredParticipants`.
The face row is capped at `requiredParticipants` (which is itself capped at `memberCount`), so a 2-member
group renders two faces and can fill them.

---

## B. Nullable `closes_at` — full blast radius

`closes_at` drops `not null`; both window constraints are dropped and recreated NULL-tolerant:

```sql
alter table public.predictions alter column closes_at drop not null;
alter table public.predictions drop constraint predictions_window;
alter table public.predictions add constraint predictions_window
  check (closes_at is null or closes_at > opens_at);
alter table public.predictions drop constraint predictions_qualification_within_window;
alter table public.predictions add constraint predictions_qualification_within_window
  check (qualification_deadline > opens_at
         and (closes_at is null or qualification_deadline <= closes_at));
```

**`qualification_deadline` with no close**: it stays `not null` and keeps its exact current meaning — the
deadline to gather the qualification quorum. With no close date it is simply not clamped by `least(…, closes_at)`;
it is `opens_at + qualification_hours`. For an open-ended prediction it is the *only* automatic expiry, which is
why it must not become nullable.

### Every read of `closes_at`

| # | Site | NULL behaviour |
|---|---|---|
| 1 | `100_schema.sql:153` `not null` | Dropped in `600_` |
| 2 | `100_schema.sql:170` `predictions_window` | Recreated `closes_at is null or …` |
| 3 | `100_schema.sql:172` `predictions_qualification_within_window` | Recreated as above |
| 4 | `100_schema.sql:185` `predictions_closes_idx` | **No change.** btree indexes store NULLs; open-ended rows sort last and are simply never matched by `closes_at <= now()` |
| 5 | `100_schema.sql:181` `predictions_group_status_idx` | No change |
| 6 | `200_functions.sql:337` `finalize_predictions` step 3 | `NULL <= now()` is NULL → row not selected. Correct already, but written explicitly as `p.closes_at is not null and p.closes_at <= now()` so the behaviour is stated, not inherited from three-valued logic |
| 7 | `200_functions.sql:862` `add_prediction_option` `… or v_pred.closes_at <= now()` | `false or NULL` = NULL → no raise → options stay open. Desired; rewritten explicitly |
| 8 | `200_functions.sql:946` `cast_vote` `if now() >= v_pred.closes_at` | `if NULL then` is false in plpgsql → vote allowed. Desired; rewritten as `if v_pred.closes_at is not null and now() >= v_pred.closes_at` |
| 9 | `200_functions.sql:1101,1125` `score_prediction` | **Real landmine.** `greatest(1, extract(epoch from (NULL - opens_at)))` = `1` (greatest ignores NULLs) → `v_span = 1s`; then `least(1, NULL)` = 1 and `greatest(0, 1)` = 1, so **every correct voter silently receives the maximum earliness multiplier**. Fixed by scoring against the real close instant: `v_close := coalesce(v_pred.closes_at, v_pred.closed_at, v_pred.resolved_at, now())`, which is why `closed_at` is added |
| 10 | `server/src/routes.ts:37` `p.*` | Ships `null`; no server-side dereference exists |
| 11 | `src/lib/database.types.ts:481,507,533` | `closes_at: string \| null` in Row / Insert / Update |
| 12 | `src/lib/prediction.ts:78` | `closes_at === null ? 'active' : (toDate(...) <= now ? 'closed' : 'active')` |
| 13 | `src/lib/prediction.ts:81` | same guard → `'proposed'` |
| 14 | `src/lib/prediction.ts:85` | `status === 'active' && prediction.closes_at !== null && toDate(...) <= now` |
| 15 | `src/lib/prediction.ts:99` `isOpenForVoting` | `closes_at === null \|\| toDate(...) > now` |
| 16 | `src/lib/prediction.ts:232` `feedRank` `closesIn` | `closes_at === null ? Number.POSITIVE_INFINITY : …`. Line 239 then ranks an open-ended active prediction **5**, not 4 — correct, nothing is about to close |
| 17 | `src/lib/prediction.ts:247` `sortFeed` tiebreak | Extracted helper `closesAtMs(p)` returning `POSITIVE_INFINITY` for null → open-ended rows sort last inside their rank |
| 18 | `src/routes/PredictionDetail.tsx:183` `<Countdown target={data.closes_at} />` | Rendered only when `closes_at !== null`; otherwise a `<Sticker>` reading "sin fecha de cierre" plus the close-request progress |
| 19 | `src/routes/PredictionDetail.tsx:207-208` | `closes_at === null` → "cierra cuando lo pida el grupo"; revealed with `closed_at` → "cerró el {closed_at}" |
| 20 | `src/components/prediction/PredictionCard.tsx:109` | Same guard as #18 |
| 21 | `src/components/ui/Countdown.tsx:18` `target: string` | **Unchanged, stays non-nullable.** A countdown to nothing has no meaning; making the prop nullable would bury a "render nothing" branch in a leaf component and hide the decision from the two call sites that actually own it |
| 22 | `src/routes/History.tsx:87-88,144` `resolved_at ?? closes_at` | → `resolved_at ?? closed_at ?? closes_at ?? created_at`. The `created_at` tail guarantees `new Date(null)` never happens |
| 23 | `src/lib/validation.ts:54,76-89` | `closesAt` becomes conditional on the new `closeMode` discriminator (see G) |
| 24 | `integration/helpers.ts:354-355`, `e2e/support.ts:111-112` time-travel | `closes_at = closes_at - interval` leaves NULL as NULL. Harmless, no change |
| 25 | `src/lib/prediction.test.ts:33-36` fixture | Gains `closes_at: null` variants and `required_participants` |
| 26 | `db/seed.sql` | Writes explicit timestamps; unaffected |
| 27 | `create_prediction_from_template` (`200_functions.sql:754`) | **Unchanged.** Templates always carry a close date; `p_closes_at` stays non-nullable there |

---

## C. Close-request mechanism

### Table

```sql
create table public.prediction_close_requests (
  prediction_id uuid not null references public.predictions (id) on delete cascade,
  user_id       uuid not null references public.profiles (id)    on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (prediction_id, user_id)
);
create index prediction_close_requests_prediction_idx
  on public.prediction_close_requests (prediction_id);
grant select on public.prediction_close_requests to authenticated;
alter table public.prediction_close_requests enable row level security;
```

Composite PK, `select`-only grant, no `insert`/`update`/`delete` policy — writes go exclusively through
`security definer` functions. That is the house style from `100_schema.sql:372-404` and `300_rls.sql:6-9`.

### RLS

```sql
create policy prediction_close_requests_select_own_or_visible
  on public.prediction_close_requests for select to authenticated
  using (user_id = (select public.current_user_id()) or public.can_see_votes(prediction_id));
```

This is the analogue of `prediction_votes_select_own_or_visible` (`300_rls.sql:177-179`), and it is not
cosmetic. Requesting a close requires having already voted, so an openly readable request row would leak
*who has voted* before the reveal — exactly the guarantee `ParticipationThreshold`'s docblock promises. The
group therefore sees a **count**, never a list, until `can_see_votes` opens.

The count is delivered as the denormalized `predictions.close_request_count`, mirroring how
`participant_count` exposes an aggregate over otherwise-private `prediction_votes` rows. It also rides the
existing `notify_predictions` trigger, so the progress updates live with no new realtime plumbing.

### RPCs

```sql
create or replace function public.request_close(p_prediction_id uuid) returns jsonb
create or replace function public.withdraw_close_request(p_prediction_id uuid) returns jsonb
```

Both return `jsonb_build_object('requests', int, 'required', int, 'closed', boolean)`.

`request_close`, in order: `require_auth()` → `is_group_member` else `not_a_member` (42501) →
`enforce_rate_limit('request_close', 30, interval '1 hour')` → `finalize_predictions(group_id)` then re-read
the row (the `cast_vote:940-941` pattern) → `select … for update` on the prediction → status must be
`proposed`/`active` else `voting_closed` (22023) → **caller must already have voted**
(`exists (select 1 from prediction_votes where prediction_id = … and user_id = v_uid)`) else `must_vote_first`
(42501) → `insert … on conflict do nothing` → recount current-member requests → write
`close_request_count` → compare against `required_close_requests(group_member_count(group_id), close_percent)`.

`withdraw_close_request` deletes the caller's own row, recounts, updates the counter, and raises
`voting_closed` if the prediction is no longer `proposed`/`active` — withdrawing never reopens a closed
prediction.

New `friendlyError` entries in `src/lib/errors.ts`: `must_vote_first`, and reuse of the existing
`voting_closed`.

### Closing happens **inside** `request_close`, in the same transaction — confirmed

The settled decision is "no grace window". Deferring the close to `finalize_predictions` would create a
window of up to 60 seconds (`server/src/index.ts:148`) in which the quorum has been visibly met — the counter
is denormalized and pushed over realtime the moment it is written — while voting is still open. That is
precisely the sniping window the decision forbids. Closing in-transaction also serializes on the
`for update` row lock, so two concurrent final requests cannot both close the row and emit two duplicate
`prediction_closed` activity events. The close sets `status = 'closed'`, `closed_at = now()`, and inserts the
same `prediction_closed` event `finalize_predictions` inserts, so downstream consumers see one shape.

### What `finalize_predictions` still needs to know — membership drift

The close act does not need the cron. The **quorum moving** does. If a member leaves, `member_count` drops,
`required_close_requests` drops, and a set of pending requests that did not reach quorum now does. Also, a
departed member's request row survives (`leave_group` does not delete the profile), so a stale row must stop
counting.

Both are solved by one new step 4, which uses the column as a **cheap gate** and a live join as the
**authority**:

```sql
-- 4) los pedidos de cierre alcanzaron el quórum -> closed
for r in
  with upd as (
    update public.predictions p
       set status = 'closed', closed_at = now(), close_request_count = live.n
      from counts c,
           lateral (
             select count(*)::integer as n
               from public.prediction_close_requests q
               join public.group_members gm
                 on gm.group_id = p.group_id and gm.user_id = q.user_id
              where q.prediction_id = p.id
           ) live
     where p.status in ('proposed', 'active')
       and p.close_request_count > 0          -- gate: skips ~every row at zero cost
       and c.group_id = p.group_id
       and live.n >= public.required_close_requests(c.member_count, p.close_percent)
    returning p.id, p.group_id, p.title
  ) select * from upd
loop … insert prediction_closed activity event … end loop;
```

The correlated count only executes for rows that already carry at least one request, so the 60-second sweep
costs the same as today for every ordinary prediction. Requests from people who are no longer members stop
counting automatically, with no cleanup hook in `leave_group` or `remove_member` — which is why the join is
the authority and the column is only a mirror.

### Registration and grants

`db/rpc-functions.json`:

```json
"request_close":           { "shape": "scalar", "params": { "p_prediction_id": "uuid" } },
"withdraw_close_request":  { "shape": "scalar", "params": { "p_prediction_id": "uuid" } }
```

`shape: "scalar"` because `server/src/rpc.ts:95` wraps the call in `to_jsonb(...)`, which is the identity on a
`jsonb` return — the same treatment `cast_vote` already gets. `create_prediction`'s param map loses
`p_minimum_participants` and gains `p_qualification_percent: "smallint"` and `p_close_percent: "smallint"`.

`620_rls_and_grants.sql`:

```sql
grant execute on function
  public.required_participants(integer, smallint),
  public.required_close_requests(integer, smallint),
  public.request_close(uuid),
  public.withdraw_close_request(uuid),
  public.create_prediction(uuid, text, text[], timestamptz, text, public.option_source,
    public.voting_mode, interval, boolean, public.results_visibility, public.votes_visibility,
    smallint, smallint, integer)
to authenticated;
revoke execute on function public.group_member_count(uuid) from public, anon, authenticated;
```

`group_member_count` is `security definer` and is only ever called from other definer functions and the
notify trigger, so it stays unreachable as an endpoint — the same reasoning as `notify_change`
(`400_notify_and_cron.sql:84`).

### New `create_prediction` signature

```sql
create_prediction(
  p_group_id uuid, p_title text, p_options text[],
  p_closes_at timestamptz default null,            -- was required, now optional
  p_description text default null,
  p_option_type public.option_source default 'manual',
  p_voting_mode public.voting_mode default 'single',
  p_vote_interval interval default null,
  p_allow_new_options boolean default false,
  p_results_visibility public.results_visibility default 'on_close',
  p_votes_visibility public.votes_visibility default 'on_close',
  p_qualification_percent smallint default 60,     -- replaces p_minimum_participants
  p_close_percent smallint default 50,             -- new
  p_qualification_hours integer default 48)
```

Body changes: the `p_closes_at <= v_opens_at` guard becomes NULL-tolerant; `v_qualification` becomes
`case when p_closes_at is null then v_opens_at + make_interval(hours => greatest(1, p_qualification_hours))
else least(v_opens_at + make_interval(...), p_closes_at) end`; the `least(20, greatest(3, …))` clamp at
`200_functions.sql:690` is deleted and replaced by percentage clamps. Argument order does not matter to
callers — `server/src/rpc.ts:85-91` always passes arguments **by name** — but the exact list matters to the
`drop`/`grant`. `src/data/predictions.ts:248` (`p_minimum_participants: 3`) is deleted.

---

## D. Two-step voting component contract

### `src/components/prediction/VoteOption.tsx`

One new prop; nothing removed.

```ts
{
  option: OptionWithTally
  selected: boolean          // the COMMITTED vote (unchanged meaning)
  staged: boolean            // NEW: the pending, uncommitted intent
  disabled: boolean
  showResults: boolean
  totalVotes: number
  isWinner?: boolean
  pending?: boolean
  onSelect: () => void       // now only stages
}
```

`filled = selected || Boolean(isWinner)` is unchanged. `staged && !selected` renders the ring/checkmark in
outline via a new `data-staged` attribute, so the styling stays in the existing CSS idiom next to
`data-checked`.

**ARIA**: the contract stays `role="radio"` inside `role="radiogroup"` — but `aria-checked` now tracks the
**staged intent**, not the committed vote: `aria-checked={staged || (selected && stagedNone)}`, expressed in
the component as `aria-checked={staged ? true : selected}` with the parent guaranteeing that at most one
option is staged. Rationale: inside a radiogroup, `aria-checked` means "this is the currently chosen item in
this group". A screen-reader user who activates an option must hear that their choice registered; the commit
is a separate, explicitly-labelled action, exactly as it is visually. A committed-but-not-staged option keeps
`data-committed` for styling and an `sr-only` "tu voto guardado" suffix so the distinction is still audible.

### Where the staged selection lives

In the **consumers** (`PredictionDetail.tsx`, `PredictionCard.tsx`), not in `VoteOption` — the Confirm button
is a sibling, and every reset trigger is data the consumer owns.

```ts
const [staged, setStaged] = useState<string | null>(null)

// Reset derived state during render, not in an effect — the pattern already used by
// `celebrated` (PredictionDetail.tsx:112-113) and `wasOpen` (CreatePredictionSheet.tsx:94-98).
const voteKey = `${data.myVote?.option_id ?? ''}:${data.myVote?.cycle ?? ''}:${status}`
const [lastVoteKey, setLastVoteKey] = useState(voteKey)
if (lastVoteKey !== voteKey) { setLastVoteKey(voteKey); setStaged(null) }
```

One rule covers all three reset triggers:

- **Own vote lands** — `useCastVote`'s `onMutate` (`src/data/predictions.ts:137-180`) writes `myVote` into the
  cache synchronously, so `voteKey` changes on the very next render and the staging clears immediately.
- **Server rejects** — `onError` (`:195-202`) restores the previous snapshot; `voteKey` reverts, staging stays
  cleared, and the committed pill returns to the old vote. That is the honest outcome.
- **Realtime / refetch** — `usePredictionRealtime` and `onSettled` (`:204-208`) invalidate; the refetched row
  carries the true vote or a new `status`, the key changes, staging clears.

No effect, no listener, no race with concurrent rendering.

### `useCastVote` is untouched

`src/data/predictions.ts:120-210` does not change by a single line. Only the trigger moves: `onSelect`
becomes `setStaged(option.id)`, and the existing `castVote.mutate({ predictionId, optionId, groupId }, { onError… })`
call moves verbatim into the Confirm handler. That is precisely what preserves the optimistic rollback.

### Confirm affordance

- **`PredictionDetail.tsx`** — a primary `<Button>` directly under the radiogroup:
  `disabled={staged === null || staged === data.myVote?.option_id}`, `loading={castVote.isPending}`, label
  "Confirmar" or "Cambiar mi voto" when a committed vote already exists. A sibling `<p role="status">`
  announces the staged option's label.
- **`PredictionCard.tsx`** — the same button at `size="sm"`, rendered in the footer **only while
  `staged !== null`**, so the card does not grow for the many cards nobody is voting on. It mounts as a
  direct consequence of the user's own tap, so focus stays on the tapped radio and the button becomes the
  next tab stop; it never steals focus. The existing `savedAt` / `SuccessCheck` feedback (`:46,73-76,225-231`)
  is unchanged and still fires on `onSuccess`.

`src/components/prediction/VoteOption.test.tsx` currently asserts one-tap commit and is rewritten first
(strict TDD per `openspec/config.yaml:10`).

---

## E. `HelpTip`

`src/components/ui/Tooltip.tsx` is pure CSS `:hover` with no state — it cannot open on touch and cannot be
opened from the keyboard. It stays exactly as it is, for its documented use (icon-only buttons). `HelpTip`
is a **different component for a different job**; do not unify them.

```tsx
// src/components/ui/HelpTip.tsx
export function HelpTip({ label, children }: { label: string; children: ReactNode }): ReactElement
```

- Renders `<button type="button" aria-expanded={open} aria-controls={panelId}
  aria-label={\`Qué significa ${label}\`}>` with an `aria-hidden` `?` glyph, min `var(--tap)` hit area.
- Toggles on click (therefore on tap). When open, renders `<div id={panelId} role="note">{children}</div>` as
  the **next sibling**, so it is reachable in DOM order without moving focus.
- **Dismissal**: `Escape` closes and returns focus to the trigger; outside `pointerdown` closes; a second
  activation closes.
- **Focus**: never trapped and never moved into the panel. It is a disclosure, not a dialog.
- **Not** `role="tooltip"` and **not** wired through `aria-describedby`: a conditionally-rendered description
  is announced inconsistently across screen readers. `aria-expanded` + `aria-controls` is the pattern that
  works on touch, keyboard and AT simultaneously.

### Composition with `FieldShell`

**`src/components/ui/Field.tsx` needs no change at all** — that is the point of reusing the existing slot.
`FieldShell` already renders `trailing` in the label row (`:82-93`) and already wires `hint` into
`aria-describedby` (`:76-78`). Usage:

```tsx
<TextField label="…" hint="Una línea." trailing={<HelpTip label="…">…</HelpTip>} … />
```

Division of labour, so the two never duplicate each other: **`hint`** is the always-visible one-liner, part of
the accessible description. **`HelpTip`** carries the longer "por qué existe esto". If copy fits in a hint, it
is a hint.

### `src/components/ui/Segmented.tsx`

One new optional prop `help?: ReactNode`, rendered inside the `<legend>`, which becomes a flex row:

```tsx
<legend className="mb-1.5 flex items-center gap-1.5 text-[0.8125rem] font-semibold text-[var(--ink-2)]">
  {legend}
  {help}
</legend>
```

| Option | Tradeoff | Decision |
|---|---|---|
| Help button inside `<legend>` | Valid HTML; some AT append the trigger's accessible name to the fieldset's group name | **Chosen** — mitigated by writing the `aria-label` as `Qué significa {label}`, which still reads correctly when appended |
| Move the legend text out of `<fieldset>` into a plain `div` row | Cleanest group name, but destroys the fieldset/legend grouping the component's docblock deliberately chose (`Segmented.tsx:10-13`) | Rejected |
| Help rendered as a sibling after `<legend>` | Keeps the group name pristine but cannot be visually aligned in the legend row without absolute positioning | Rejected |

---

## F. Client-side robots meta

No meta-management library is added. `src/components/SeoRobots.tsx`:

```tsx
const INDEXABLE_PATHS = new Set(['/', '/entrar'])   // from src/lib/indexing.ts

export function SeoRobots(): null {
  const { pathname } = useLocation()
  useEffect(() => {
    const content = robotsFor(pathname)
    let tag = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    if (!tag) { tag = document.createElement('meta'); tag.name = 'robots'; document.head.appendChild(tag) }
    tag.content = content
  }, [pathname])
  return null
}
```

Mounted once inside `App` (`src/App.tsx:66-68`), above `<Routes>` and therefore inside the Router, so it
observes every SPA navigation including `Navigate` redirects. `robotsFor` lives in a new pure module
`src/lib/indexing.ts` (default-deny: anything not in the allowlist gets `noindex, nofollow`; exact match after
stripping a single trailing slash, so `/Entrar` and `/entrar/extra` are **not** indexable). The blanket
`<meta name="robots">` at `index.html:19` is removed; the tag now only ever exists as this component wrote it.

**Which one wins**: the server header. `X-Robots-Tag` and the `robots` meta are combined by crawlers using the
**most restrictive** directive, so `X-Robots-Tag: noindex, nofollow` from `server/src/index.ts` cannot be
overridden by a permissive meta tag. That ordering is the whole safety property: the server is authoritative
and JS-independent, the meta is a mirror that improves the indexable pages and can only ever fail closed. The
client list is therefore a convenience, never a control — an incorrect client allowlist entry cannot make a
private route indexable, because the server still sends `noindex` for it.

Server side, `server/src/index.ts:79` and `:89` replace the unconditional header with a default-deny helper in
a new `server/src/robots.ts` holding its own copy of the same allowlist. The two copies are deliberate: the
Express server has its own package and tsconfig and does not import from `src/`; introducing a cross-package
import for two string literals would be a larger and riskier change than the drift it prevents. Drift is
caught by test instead (see Testing Strategy).

`public/robots.txt` (new): `Disallow: /g/`, `/join/`, `/crear-grupo`. `deploy/Caddyfile:44` mirrors the
allowlist with a matcher so the static-hosting path behaves identically; it remains the fastest kill switch
(restore the unconditional header, redeploy Caddy, no app rebuild).

---

## G. Form information architecture

`CreatePredictionSheet.tsx:20-23` states the principle: question and options first, configuration hidden.
The new fields are placed so the **always-visible** part grows by exactly one control.

| Zone | Contents | Change |
|---|---|---|
| 1. La pregunta | título, contexto, "Las opciones son…", opciones | unchanged |
| 2. El cierre | `Segmented` "¿Cuándo cierra?" `[Con fecha \| Cuando lo pida el grupo]`; the `datetime-local` renders **only** for "Con fecha"; the close-quorum `Segmented` renders **only** for "Cuando lo pida el grupo" | +1 control net |
| 3. Modo | single / evolutiva, interval when evolutiva, **new rounds-before-close preview** | +1 read-only line |
| 4. "Más opciones" (collapsed) | three labelled sub-blocks separated by hairlines | regrouped |

Zone 2 is the key move: the close quorum is **not** an advanced knob when there is no date — it is the only
closing rule that exists, so it belongs next to the choice that creates it. And because the date field
disappears in the open-ended case, the visible height is roughly unchanged either way.

Zone 4's collapsed panel, today a flat stack, gains three headings:

- **Para que la predicción quede** — quorum (`Segmented`, `columns={3}`: "Pocos 30%" / "La mitad 50%" /
  "Casi todos 80%") + `qualification_hours` ("¿Cuánto tiempo tiene para juntar gente?"), each with `?`, plus
  one live sentence: *"Con 5 personas en el grupo, necesita 3."*
- **Quién ve qué** — resultados ("Ver los números") and votos ("Ver quién eligió qué"), relabelled per scope
  item 7, each with `?`.
- **Extras** — "Dejar que agreguen opciones".

Quorum is a three-way preset `Segmented`, not a free number input. A numeric "how many people" field is the
current hidden-constant problem with a UI bolted on, and it cannot scale with the group; presets keep it one
tap, and the live sentence turns the abstract percentage into the concrete count that actually matters. The
same reasoning applies to the close quorum.

`src/lib/validation.ts` gains `closeMode: z.enum(['date', 'open'])`, makes `closesAt` required only when
`closeMode === 'date'`, adds `qualificationPercent` / `closePercent` (`z.number().int().min(1).max(100)`), and
cross-validates the evolutiva interval against the window: with `closeMode === 'date'`, at least one full
round must fit before the close. With `closeMode === 'open'` the interval is unbounded — **open-ended
evolutiva produces rounds indefinitely; there is no round cap.**

The sheet's `description` ("Empieza en prueba. Si en 48 horas la eligen 3 personas, queda.", `:164`) and the
success toast (`:125`) both hardcode `3` and are rewritten against the live requirement.

---

## Data Flow

```
  create sheet ──rpc create_prediction──► predictions row (qualification_percent, close_percent,
       │                                                   closes_at NULL-able)
       │
  tap option ──► staged (component state)
       │
  Confirm ──► useCastVote.onMutate (optimistic) ──rpc cast_vote──► prediction_votes
       │                                                │
       │                                    trigger ──► refresh_prediction_counts
       │                                                │  participant_count vs
       │                                                │  required_participants(member_count, pct)
       │                                                └──► predictions.status
       │
  Pedir cierre ──rpc request_close──► prediction_close_requests ──► close_request_count
                                             │
                                     quorum met? ──yes──► status='closed', closed_at=now()  (same txn)
                                             │
                                     no ──► finalize_predictions (60s) re-evaluates
                                            against the LIVE member join

  read path:  PREDICTION_SELECT + lateral member count
              └─► member_count, required_participants, close_required, my_close_request ─► client
```

## File Changes

| File | Action | Description |
|---|---|---|
| `db/migrations/600_quorum_and_open_close.sql` | Create | Columns, constraints, `prediction_close_requests`, pure quorum functions, backfill |
| `db/migrations/610_functions.sql` | Create | `drop function` for the old `create_prediction`; re-declared `refresh_prediction_counts`, `finalize_predictions`, `create_prediction`, `cast_vote`, `add_prediction_option`, `score_prediction`, `notify_change`; new `request_close`, `withdraw_close_request`, `group_member_count` |
| `db/migrations/620_rls_and_grants.sql` | Create | RLS policy on the new table, `revoke`/`grant execute` |
| `supabase/migrations/**` | **Untouched** | Dead mirror; no code path applies it |
| `db/rpc-functions.json` | Modify | Register both close RPCs; re-sign `create_prediction` |
| `server/src/robots.ts` | Create | Default-deny allowlist + `robotsFor(pathname)` |
| `server/src/index.ts` | Modify | Replace the two unconditional `X-Robots-Tag` writes (`:79`, `:89`) |
| `server/src/routes.ts` | Modify | `PREDICTION_SELECT` lateral member count + 4 derived fields |
| `server/src/realtime.ts` | Modify | `minimum_participants` → `required_participants` in the event shape |
| `deploy/Caddyfile` | Modify | Mirror the allowlist |
| `public/robots.txt`, `index.html` | Create / Modify | Disallow private prefixes; remove the blanket meta |
| `src/lib/indexing.ts`, `src/components/SeoRobots.tsx` | Create | Client allowlist + per-route meta |
| `src/lib/database.types.ts` | Modify | Nullable `closes_at`; new columns; new `create_prediction` args |
| `src/lib/types.ts` | Modify | Derived fields on `Prediction` |
| `src/lib/prediction.ts` | Modify | NULL `closes_at` in 6 places; `StatusInput` requires `required_participants`; new `canSeeVotes()` |
| `src/lib/validation.ts` | Modify | `closeMode`, percentages, interval-vs-window |
| `src/lib/errors.ts` | Modify | `must_vote_first` |
| `src/data/predictions.ts` | Modify | Drop `p_minimum_participants: 3`; send percentages and optional `closesAt`; new `useRequestClose` / `useWithdrawCloseRequest` |
| `src/components/ui/HelpTip.tsx` | Create | Accessible help disclosure |
| `src/components/ui/Segmented.tsx` | Modify | `help?: ReactNode` in the legend row |
| `src/components/ui/Field.tsx`, `Tooltip.tsx`, `Countdown.tsx` | **Unchanged** | Existing slots suffice; deliberate |
| `src/components/prediction/VoteOption.tsx` | Modify | `staged` prop, ARIA on staged intent |
| `src/components/prediction/PredictionCard.tsx` | Modify | Staging + Confirm; NULL close guards |
| `src/components/prediction/ParticipationThreshold.tsx` | Modify | `requiredParticipants` + `memberCount` |
| `src/components/prediction/CreatePredictionSheet.tsx` | Modify | New IA, help copy, live requirement sentence |
| `src/routes/PredictionDetail.tsx` | Modify | Staging + Confirm; NULL close; close-request panel; names block gated on `canSeeVotes()` |
| `src/routes/History.tsx` | Modify | `resolved_at ?? closed_at ?? closes_at ?? created_at` |
| `src/components/layout/GroupShell.tsx` | Modify | Toast reads `required_participants` |
| `src/App.tsx` | Modify | Mount `<SeoRobots />` |

## Testing Strategy

Only two runners work here: **vitest unit** (`src/**/*.test.{ts,tsx}`, jsdom) and **vitest integration**
(`integration/**/*.test.ts`, node + `pg` against the live dev Postgres on port 54432). `npm run test:e2e` is
**not runnable** — Playwright browsers are unavailable; e2e specs are written, never claimed as passing.
Strict TDD (`openspec/config.yaml:10`): every RED test below is written before its production change.

| Capability | Unit (vitest jsdom) | Integration (vitest + live DB) |
|---|---|---|
| `search-indexing` | `robotsFor()` exhaustive: `/`, `/entrar`, `/entrar/`, `/Entrar`, `/g/x`, `/join/tok`, `/crear-grupo`, unknown path, empty. `SeoRobots` sets and updates the meta across two `MemoryRouter` navigations | Structural drift guard: `readFileSync` both `src/lib/indexing.ts` and `server/src/robots.ts`, assert the same literal path list — the same technique `integration/helpers.ts` already uses on `db/rpc-functions.json`. Header behaviour itself is an e2e spec (written, not run) |
| `prediction-qualification` | `required participants` math mirrored client-side; `effectiveStatus`/`hasQualified`/`participantsMissing` at member counts 1, 2, 3, 7; `ParticipationThreshold` renders 2 faces in a 2-member group | **`required_participants` never exceeds `member_count`** (the bug fix); a 2-member group qualifies; the requirement rises when a third member joins without any write to the prediction row; `create_prediction` produces **exactly one** overload (`select count(*) from pg_proc where proname='create_prediction'` = 1); pre-change seeded rows keep their effective requirement after the backfill; `finalize_predictions` plan does not regress into a per-row subquery |
| `vote-confirmation` | Rewritten `VoteOption.test.tsx`: one tap does **not** call the mutation; Confirm does; `aria-checked` follows the staged option; staging clears when `myVote` changes, when the error rollback lands, and on a `status` change; optimistic patch and rollback still observed through `useCastVote` | `cast_vote` behaviour unchanged (regression guard on the existing `integration/flow.test.ts` vote paths) |
| `prediction-closing` | `effectiveStatus`, `isOpenForVoting`, `feedRank`, `sortFeed` with `closes_at: null`; `sortFeed` puts open-ended last within a rank; `PredictionDetail`/`PredictionCard` render no `Countdown` when null | Create with `p_closes_at => null`; voting stays open past any date; `request_close` rejected for a non-voter (`must_vote_first`) and for a non-member; reaching quorum closes **in the same transaction** (status is `closed` on the RPC's own return, before any `finalize_predictions` call); `withdraw_close_request` lowers the count and never reopens; a member leaving lowers the requirement and `finalize_predictions` closes the row; a departed member's request stops counting; `score_prediction` earliness is **not** 1.0 for everyone on an open-ended prediction (the `closed_at` fix) |
| `prediction-visibility` | `canSeeVotes()` truth table across `visible` / `on_close` / `anonymous` × each status; `PredictionDetail` renders the names block iff `canSeeVotes()` | RLS parity: `votes_visibility='visible'` returns other members' `prediction_votes` rows before close; `anonymous` never does — client and RLS must agree |
| `prediction-settings-help` | `HelpTip`: toggles on click, `aria-expanded` flips, `Escape` closes and restores focus to the trigger, outside pointerdown closes, panel is `role="note"` and not a focus trap; `Segmented` renders `help` in the legend row; `FieldShell.trailing` composition keeps `hint` in `aria-describedby` | — |
| Form IA / validation | `createPredictionSchema`: `closesAt` required only when `closeMode==='date'`; percentages bounded; evolutiva interval must fit at least one round before a dated close; unbounded when open-ended | `create_prediction` rejects a past `p_closes_at` and accepts NULL |

Gate before and after each work unit: `npm run typecheck && npm run lint && npm run test && npm run test:integration`
(current green baseline: 68 unit, 61 integration). No test is deleted to make the suite pass; the two tests
that assert the old behaviour — `VoteOption.test.tsx` and `integration/flow.test.ts:212-220` (which asserts the
`greatest(3, …)` clamp, i.e. the bug) — are **rewritten**, and the rewrite is itself the RED step.

## Threat Matrix

The reference matrix covers VCS/shell/PR/subprocess boundaries. None of them exist in this change.

| Boundary | Applicability | Reason |
|---|---|---|
| Documentation-like paths | N/A | No file-classification or execution boundary; nothing in this change decides whether a file is executable |
| Git repository selection | N/A | No `git` invocation, no `-C`, no cwd authority |
| Commit state | N/A | No index/worktree automation |
| Push state | N/A | No push automation |
| PR commands | N/A | No PR automation |

The applicable boundary here is **HTTP path routing**, which the reference matrix does not model. Its
adversarial cases are enumerated instead and carried into `tasks.md` unchanged:

| Adversarial case | Expected safe behaviour |
|---|---|
| Unknown path (`/no-existe`) | `noindex, nofollow` — default-deny, no allowlist entry |
| Case variant (`/Entrar`) | `noindex, nofollow` — exact match, no case folding |
| Trailing slash (`/entrar/`) | Indexable — exactly one trailing slash is stripped, nothing else |
| Prefix extension (`/entrar/x`, `/entrarahora`) | `noindex, nofollow` — no prefix matching |
| Query/hash (`/entrar?next=/g/abc`) | Indexable; the router matches `pathname` only, and the private target never reaches a canonical or OG tag |
| Static asset under `/assets/*` | `noindex, nofollow` — the static middleware branch shares the same helper |
| JS disabled | Server header still applies; the client meta is a mirror, never a control |
| Client allowlist wrong | Cannot make a private route indexable — crawlers combine header and meta by the most restrictive directive |

## Migration / Rollout

Additive only. New columns carry defaults, `closes_at` only loses `not null`, nothing is dropped except the
old `create_prediction` overload (immediately recreated). Existing rows are backfilled so their effective
requirement is preserved. Rollback per the proposal: revert the code first — the new columns simply go
unread; drop `prediction_close_requests` and the new columns only if the revert is permanent. The indexing
kill switch stays the Caddy header, which needs no app rebuild.

## Open Questions

- [ ] Default `qualification_percent = 60` and `close_percent = 50` are proposed, not settled by the owner.
      Both are one-line changes in `600_*.sql` and in the sheet's preset labels if the owner prefers others.
- [ ] `predictions.minimum_participants` is retained but becomes read-nowhere. Removing it is a follow-up
      change, not part of this one, because the rollback plan depends on it still being there.

# Proposal: Simpler Prediction Setup

> Renamed from `group-level-settings`. The scope outgrew the original name: it now covers group
> settings, a vote-change lockout that closes a real exploit, a preset front door for the create
> form, and duration-scaled points.

## Why

The owner shipped `prediction-clarity`, used it, and came back with four things.

### 1. The qualification machinery is "muy tosca"

Their words. Three concrete complaints:

- **Nothing should expire.** They want to leave a prediction that might resolve in a year and not
  care whether people take two months or a year to pick an option. `qualification_hours` forces a
  clock onto a question that has none.
- **They do not want to be asked, per prediction,** how long there is to gather people or what
  fraction must vote.
- **The close quorum "no importa" per prediction** — it belongs to the group, and one person must
  be able to be enough: *"con solo uno alcance si confías en el grupo"*.

### 2. You can currently change your vote after learning the answer — and get paid for it

This is a real exploit in the shipped product, spotted by the owner.

`voting_mode = 'single'` lets anyone change their vote until `closes_at`
(`db/migrations/610_functions.sql:436-439`, the `on conflict … do update set option_id` branch;
UI copy "Podés cambiar tu voto hasta el cierre" at `src/components/prediction/PredictionCard.tsx:267`
and `src/routes/PredictionDetail.tsx:331`). Combined with scoring, somebody who learns the real
answer before the close switches their vote and collects the points.

It is worse than it first looks. `score_prediction` computes earliness from
`min(created_at) filter (where option_id = resolved)` (`610_functions.sql:511`), and in `single`
mode there is exactly one vote row per user whose `created_at` is never rewritten by the upsert.
So a last-second switch to the winning option is scored as if it had been chosen at the very
beginning: **maximum earliness multiplier for a vote cast with hindsight.**

### 3. The form is a wall of settings

*"Quizá en vez de tantas opciones que haya como presets"* — immediately followed by *"pero que se
puedan cambiar las opciones individuales"*. Presets are the front door, not a replacement.

### 4. Every prediction is worth the same

*"Está bueno si algunas valen más puntos, por ejemplo las que más tiempo duran, como quien se casa
primero vale más que quien llega tarde"*. A prediction resolving over a year should outweigh one
resolving tonight.

This change partially reverses `prediction-clarity`. That change was right that the hidden
`minimum_participants = 3` was a bug and right that a percentage of live membership beats a magic
constant. It was wrong about **where** those knobs live, and wrong that a prediction should ever
be able to fail an exam it did not sign up for.

## What Changes

### A. Group-level settings

Removed from the create-prediction form entirely — field, `HelpTip` and Zod entry:
`qualificationHours`, `qualificationPercent`, `closePercent`.

| Setting | Type | Default | Replaces |
|---|---|---|---|
| `groups.close_request_quorum` | `smallint`, floor **1**, capped at live member count | `1` | `predictions.close_percent` |
| `groups.qualification_enabled` | `boolean` | **`false`** | (new — was always-on) |
| `groups.qualification_percent` | `smallint` 1–100 | `60` | `predictions.qualification_percent` |

`qualification_enabled = false` (the default): a prediction is born `active` — no "En prueba"
badge, no `ParticipationThreshold`, no gate. `true`: born `proposed`, flips to `active` when the
group threshold is met, and **never** expires. With the toggle on, "En prueba" is a signal, not an
exam that can be failed.

### B. Nothing expires, ever

`finalize_predictions`' expire-by-deadline step is deleted. `predictions.qualification_deadline`
becomes nullable and stops being written. The `expired` enum value stays so pre-existing rows still
render, but becomes **unreachable**.

### C. Per-prediction quorum columns are dropped

`predictions.qualification_percent`, `close_percent` and the long-dead `minimum_participants` are
**dropped**. Leaving dead columns that silently contradict the group setting is worse than a
destructive migration.

### D. Vote-change window (the exploit fix)

New per-prediction `vote_change_window`, enforced in `cast_vote` — a real constraint, not UI
politeness. Supported values: **until close / 1 day / 15 minutes / never**.

The window is measured from **when that user cast their own vote**, not from prediction creation.
Anchoring to creation gives early voters a long window and late voters none, which is both unfair
and unexplainable; anchored to your own vote it has one sentence: *"Tenés 15 minutos para corregir
tu voto."* A new `prediction_votes.first_cast_at` is the anchor, so re-voting inside the window
cannot ratchet it forward. `recurring` predictions keep their existing hard per-cycle lock
regardless.

### E. Presets, with per-field override

Four presets fill the underlying settings. The advanced panel stays and lets any single field be
overridden; when the combination stops matching, the UI honestly shows **"A medida"**.

| Preset | `voting_mode` | `results_visibility` | `votes_visibility` | vote-change window |
|---|---|---|---|---|
| **A libro abierto** | `single` | `always` | `visible` | until close |
| **A ciegas** *(default)* | `single` | `on_close` | `on_close` | 15 minutes |
| **Evolutiva** | `recurring` | `on_close` | `on_close` | never |
| **A medida** | — | — | — | — (opens every field) |

The default path becomes: write the question, write the options, pick a preset, done.

### F. Points scale with how long the prediction ran

`score_prediction` currently passes a hardcoded base of `100`
(`db/migrations/610_functions.sql:531`). That base is now scaled by a logarithmic duration
multiplier over the **actual** elapsed time (`closed_at - opens_at`), floored at 1.0× and capped at
3.0×. The rarity, earliness and conviction multipliers are untouched.

### G. Option type "los del grupo" becomes live

`option_type = 'members'` currently snapshots the roster at creation
(`db/migrations/610_functions.sql:296-308`); a member who joins later never appears. Joining now
adds an option to every still-open `members` prediction. A member who **leaves keeps their
option** — `prediction_votes.option_id` is `on delete cascade`
(`db/migrations/100_schema.sql:238`), so removing an option would delete every vote cast for it.

### H. Editable group settings screen

`src/routes/GroupSettings.tsx` is read-only today for the group block. It gains an editable
section, admin-only, backed by a new admin-gated `update_group_settings` RPC.

## Impact

- **Touches both** `server/` (Express read path) and `src/` (client), and adds five new SQL
  migrations, all in the `700_` series. No applied migration is edited.
- `supabase/migrations/` and `supabase/seed.sql` are a dead mirror and are deliberately left
  untouched; the `rules.archive` warning in `openspec/config.yaml:67` will fire and is accepted.
- Two RPC signatures change (`create_prediction`, `create_prediction_from_template`), one helper is
  re-signed (`required_close_requests`) and two are added (`update_group_settings`,
  `duration_multiplier`), so `db/rpc-functions.json` changes.
- `db/seed.sql` writes `minimum_participants` (`:116`), so it must move in the same change or
  `npm run db:reset` breaks.
- Copy in `src/routes/Landing.tsx` and `README.md` markets the qualification mechanic as mandatory
  and time-bounded; both must be rewritten.

## What Is Lost

Stated plainly, because this migration is destructive:

- **Per-prediction quorum tuning is gone.** Any prediction that carried a non-default
  `qualification_percent` or `close_percent` now follows its group's single setting.
- **The gathering deadline is gone.** `qualification_deadline` is kept on existing rows as an audit
  trail and never read again.
- **Rows already `expired` stay `expired`.** Nothing revives them. Reviving a prediction the group
  watched disappear months ago is a worse surprise than leaving it in history.
- Every existing `proposed` row is promoted to `active` by the migration, because every group
  starts with `qualification_enabled = false`.
- **Existing predictions become non-editable after 15 minutes from each voter's own first vote**,
  because the new column's default is the "A ciegas" window and the backfill applies it to
  existing rows. This is the point of the change, but it is a behaviour change for votes already
  cast: their `first_cast_at` is backfilled from `created_at`, so a vote cast an hour ago is
  already locked the moment the migration lands.

## Risks

### Points farming, and why it is accepted

With the close quorum now as low as 1 and nothing expiring, a group could sit on a trivial
prediction for a year to inflate points. This is named rather than ignored.

**Partly mitigated by shape**: the duration multiplier is logarithmic and hard-capped at 3.0×, so a
year of waiting buys 2.9× rather than 365×, and there is no reward at all for going past roughly a
year. Linear scaling would have turned the leaderboard into "whoever left something open longest".

**Otherwise accepted, deliberately.** These are private groups of friends who set their own quorum,
and `group_leaderboard` is scoped to the group — inflating points only inflates them against the
same friends playing the same predictions. Any hard anti-farming rule (a maximum duration, a decay,
a minimum participant count) would punish the exact use case the owner asked for: *quién se casa
primero*. If farming ever becomes real, it is a social problem in a five-person group, not a
scoring bug.

### Earliness still rewards hindsight on the "A libro abierto" preset

The lockout closes the exploit for "A ciegas" and "Evolutiva". "A libro abierto" is explicitly for
predictions where nothing is at stake and keeps unlimited vote changes, so a last-second switch
there still collects the full earliness multiplier via the `min(created_at)` path described above.
Recorded as a **known consequence of that preset**, not silently fixed: correcting earliness to
anchor on "when the vote landed on that option" changes scoring semantics for every prediction and
was not requested. Flagged as a follow-up change.

### Destructive schema change

`predictions.qualification_percent` and `close_percent` cannot be recovered from the schema after
`730_`. See the rollback plan.

## Rollback Plan

The schema change is destructive, so rollback is **not** a pure code revert — stated up front
rather than discovered later.

1. **Code-only revert (partial, not viable alone).** Reverting `server/` and `src/` without the DB
   leaves the app reading columns that no longer exist; the read path breaks.
2. **Forward fix (preferred).** Any defect is corrected by a new `740_*.sql` plus a code fix. The
   group columns, `vote_change_window`, `first_cast_at` and `duration_multiplier` are all additive;
   only the columns dropped by `730_` are unrecoverable.
3. **Full rollback (last resort).** Restore from the pre-deploy snapshot, then revert the code.

`db/migrations/730_drop_prediction_quorum_columns.sql` MUST be preceded by a database snapshot in
the deploy runbook. That snapshot is the only artifact that can bring back
`qualification_percent` / `close_percent`.

## Delivery

Single PR to `main`. `size:exception` accepted by the owner: SQL, server and client must move
together because the dropped columns break the read path the moment they are gone.

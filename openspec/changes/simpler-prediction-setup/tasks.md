# Tasks: Simpler Prediction Setup

## Delivery Forecast (Review Workload Guard)

Estimated authored diff: ~2,100 changed lines (5 new SQL migrations, 4 new test suites, 1 new pure
client module, 24 modified files).

```
Decision needed before apply: No
Chained PRs recommended: No
400-line budget risk: High
```

`delivery_strategy` = `single-pr` to `main`, with `size:exception` **accepted by the owner**.
Chained PRs were considered and rejected for a concrete reason: the moment
`predictions.close_percent` is dropped, the old `PREDICTION_SELECT` fails, so SQL, server and
client cannot be split across PRs without leaving `main` broken between them. The phase order below
is the compensating control — every phase ends with the repo compiling, linting and green.

## Conventions for every phase

- **Strict TDD** (`openspec/config.yaml:10`): write the RED test first, watch it fail, then make it
  pass. Test commands are named per task.
- **Never edit an existing numbered migration.** `server/src/migrate.ts` records applied filenames
  in `public._migrations` and skips them forever: an in-place edit runs on a fresh
  `npm run db:reset` and **never** on the deployed database.
- `supabase/migrations/` and `supabase/seed.sql` are a dead mirror. Leave them.
- UI copy and code comments in Rioplatense Spanish; identifiers and types in English.
- Phase gate, run at the END of every phase, all four green before moving on:
  `npm run typecheck && npm run lint && npm run test && npm run test:integration`
- `npm run test:e2e` is **not runnable here** — Playwright browsers are not installed. E2E specs
  are written, never claimed as passing.

---

## Phase 0 — Rename, baseline, safety net

- [x] 0.1 **Finish the folder rename.** The artifacts have been written to
      `openspec/changes/simpler-prediction-setup/`, but the design agent had no shell access, so
      the old directory is still on disk. Run:
      `git rm -r --cached openspec/changes/group-level-settings && rm -rf openspec/changes/group-level-settings`
      (nothing is committed yet, so a plain `rm -rf` is sufficient if the path was never staged).
      Verify `openspec/changes/` contains exactly `archive/` and `simpler-prediction-setup/`.
- [x] 0.2 Grep the repo for the string `group-level-settings` and fix any remaining reference.
      Expected hits: none outside the deleted folder.
- [x] 0.3 Confirm the green baseline before touching anything: `npm run typecheck`,
      `npm run lint`, `npm run test` (expect 149), `npm run test:integration` (expect 95).
      Record the numbers; every later phase must end at or above them.
- [x] 0.4 Confirm `npm run db:reset` applies `000` → `620` cleanly against `friedict-db` on port
      54432.
- [x] 0.5 Add the deploy-runbook note: **snapshot the database immediately before applying
      `730_`.** That snapshot is the only way to recover `qualification_percent` / `close_percent`.

---

## Phase 1 — SQL: group settings columns (purely additive)

Nothing reads the new columns yet, so the repo stays green throughout.

- [x] 1.1 **RED** — `integration/group-settings.test.ts` (new): `public.groups` has
      `close_request_quorum` (default 1, CHECK `>= 1`), `qualification_enabled` (default false) and
      `qualification_percent` (default 60, CHECK 1..100), read from `information_schema.columns` and
      `pg_constraint`. `npm run test:integration` — fails.
- [x] 1.2 **RED** — same file: a direct `update … set close_request_quorum = 0` is rejected, and
      `qualification_percent` at 0 and at 101 are rejected. `npm run test:integration` — fails.
      *Threat-matrix rows: quorum 0, percent out of range.*
- [x] 1.3 Create `db/migrations/700_group_settings.sql` with the three columns, their CHECKs and a
      `comment on column` for each, in Rioplatense Spanish, matching the voice of
      `600_quorum_and_open_close.sql`.
- [x] 1.4 Same file: the `close_request_quorum` backfill exactly as in `design.md` § Migration /
      Rollout — it reads `predictions.close_percent`, which still exists here. Comment why `min`
      over still-open open-ended predictions is the honest translation.
- [x] 1.5 Same file: `alter table public.predictions alter column qualification_deadline drop not
      null`; drop and recreate `predictions_qualification_within_window` NULL-tolerant; drop
      `predictions_qualification_idx` with a comment saying nothing reads that column any more.
- [x] 1.6 Same file: `prediction_options_member_idx` (partial unique on
      `(prediction_id, member_id) where member_id is not null`) and
      `predictions_open_member_options_idx` (partial on `(group_id)` for open `members`
      predictions), each with the comment explaining what invariant it buys.
- [x] 1.7 `npm run db:reset && npm run test:integration` — 1.1 and 1.2 go green.
- [x] 1.8 **Phase gate.**

---

## Phase 2 — SQL: vote window and scoring columns (purely additive)

Still additive. Nothing reads these yet either.

- [x] 2.1 **RED** — `integration/vote-window.test.ts` (new): `predictions.vote_change_window` is a
      nullable `interval` defaulting to `15 minutes`, with a CHECK rejecting a negative interval;
      `prediction_votes.first_cast_at` is `not null default now()`;
      `prediction_scores.duration_multiplier` is `numeric not null default 1.0`.
      `npm run test:integration` — fails. *Threat-matrix row: negative window.*
- [x] 2.2 **RED** — same file: every pre-existing vote row has `first_cast_at = created_at` after
      the migration. `npm run test:integration` — fails.
- [x] 2.3 **RED** — `integration/scoring-parity.test.ts`: `public.duration_multiplier` exists, is
      `immutable` in `pg_proc`, and returns 1.00 / 1.75 / 2.50 / 2.93 / 3.00 for spans of 1, 10,
      100, 365 and 4000 days, and 1.00 for anything under a day.
      `npm run test:integration` — fails.
- [x] 2.4 Create `db/migrations/705_vote_window_and_scoring.sql` with the three columns, their
      CHECKs, `comment on column` for each, and the `first_cast_at` backfill from `created_at`. The
      `first_cast_at` comment MUST state that it is the security anchor and must never be rewritten
      by an upsert.
- [x] 2.5 Same file: `public.duration_multiplier(p_span interval)` and
      `public.vote_change_window_of(p_key text)` exactly as in `design.md` § E and § C, both
      `immutable` with `set search_path = ''`.
- [x] 2.6 `npm run db:reset && npm run test:integration` — 2.1–2.3 go green.
- [x] 2.7 **Phase gate.**

---

## Phase 3 — SQL: functions, trigger, RPCs and grants

Where behaviour changes. The old `predictions` quorum columns still exist; nothing reads them by
the end of this phase.

### 3a. `update_group_settings`

- [x] 3a.1 **RED** — `integration/group-settings.test.ts`: `owner` and `admin` can call it; a plain
      `member` gets `admin_only`; a non-member gets `admin_only` and nothing is written.
      `npm run test:integration` — fails. *Threat-matrix rows: member, non-member.*
- [x] 3a.2 **RED** — same file: omitted parameters leave their column untouched.
      `npm run test:integration` — fails.
- [x] 3a.3 **RED** — same file: with the toggle on and a prediction in `proposed`, turning the
      toggle off promotes it to `active` in the same call. `npm run test:integration` — fails.
- [x] 3a.4 Create `db/migrations/710_functions.sql` and add `update_group_settings` per
      `design.md` § A: `require_auth` → `is_group_admin` else `admin_only` (42501) →
      `enforce_rate_limit('update_group_settings', 30, interval '1 hour')` → `coalesce` update →
      promote stranded `proposed` rows when the toggle goes off → return the `groups` row.
- [x] 3a.5 Register it in `db/rpc-functions.json` as `"shape": "row"` with the exact casts.
- [x] 3a.6 `npm run db:reset && npm run test:integration` — 3a.1–3a.3 go green.

### 3b. Live "los del grupo" options

- [x] 3b.1 **RED** — `integration/member-options.test.ts` (new): a late joiner becomes a votable
      option on an open `option_type = 'members'` prediction. `npm run test:integration` — fails.
- [x] 3b.2 **RED** — same file: a member who leaves keeps their option **and** the votes cast for
      it survive (count `prediction_votes` before and after `leave_group`).
      `npm run test:integration` — fails. *Threat-matrix row: option deletion cascades to votes.*
- [x] 3b.3 **RED** — same file: rejoining creates no second option.
      `npm run test:integration` — fails. *Threat-matrix row: repeated leave/rejoin.*
- [x] 3b.4 **RED** — same file: two members with an identical `display_name` both get an option and
      `unique (prediction_id, label)` is not violated. `npm run test:integration` — fails.
      *Threat-matrix row: identical display names.*
- [x] 3b.5 **RED** — same file: `upsert_profile` renaming a member does not rewrite an existing
      option label, and the votes for it are untouched. `npm run test:integration` — fails.
- [x] 3b.6 **RED** — same file: joining adds no option to a `closed` or `resolved` prediction.
      `npm run test:integration` — fails.
- [x] 3b.7 In `710_`, add `public.add_member_option(uuid, uuid, uuid)` — `security definer`,
      `set search_path = ''` — with the label rule from `design.md` § F: base
      `left(btrim(display_name), 56)`, `' (2)'`…`' (12)'` on collision,
      `on conflict (prediction_id, member_id) where member_id is not null do nothing`,
      position `max(position) + 1`.
- [x] 3b.8 In `710_`, add `public.sync_member_options(uuid, uuid)` looping over the group's
      `members` predictions in `('proposed', 'active')`.
- [x] 3b.9 In `710_`, add `public.on_member_joined()` and
      `create trigger group_members_sync_options after insert on public.group_members for each row
      execute function public.on_member_joined();`, with the comment explaining why a trigger and
      not a call inside `join_group`.
- [x] 3b.10 `npm run db:reset && npm run test:integration` — 3b.1–3b.6 go green.

### 3c. Nothing expires

- [x] 3c.1 **REWRITE (RED)** — `integration/prediction-qualification.test.ts:132-155`: with the
      toggle ON and no quorum, the prediction is still `proposed` after `timeTravel` + `finalize`,
      never `expired`. `npm run test:integration` — fails.
- [x] 3c.2 **REWRITE (RED)** — `integration/flow.test.ts:303-329`: it does **not** expire, ever.
      `npm run test:integration` — fails.
- [x] 3c.3 **RED** — `integration/prediction-qualification.test.ts`: after the migrations, no row is
      in `proposed` unless its group has `qualification_enabled = true`.
      `npm run test:integration` — fails.
- [x] 3c.4 In `710_`, re-declare `finalize_predictions(uuid)` **without** step 1. Step 2 reads
      `g.qualification_percent` through a join on `public.groups` and promotes when `is_default`, or
      `not g.qualification_enabled`, or the live requirement is met. Step 3 unchanged (and keeps
      writing `closed_at`). Step 4 reads `g.close_request_quorum`.
- [x] 3c.5 In `710_`, re-declare `refresh_prediction_counts(uuid)` to read the group's
      `qualification_enabled` / `qualification_percent`.
- [x] 3c.6 `npm run db:reset && npm run test:integration` — 3c.1–3c.3 go green.

### 3d. Re-signed RPCs, the vote lockout and duration scoring

This sub-phase changes the RPC contract, so `db/rpc-functions.json`, the `Functions` block of
`database.types.ts` and `src/data/predictions.ts`'s argument lists move **with it** — those three
are one contract and must never disagree, even for one phase.

- [x] 3d.1 **RED** — `integration/prediction-qualification.test.ts`:
      `select count(*) from pg_proc where proname = 'create_prediction'` = 1, and the same for
      `create_prediction_from_template`. `npm run test:integration` — fails.
- [x] 3d.2 **RED** — `integration/prediction-closing.test.ts`: with `close_request_quorum = 1`, the
      first close request from a voter closes the prediction in that same call.
      `npm run test:integration` — fails.
- [x] 3d.3 **RED** — same file: with the quorum far above the member count, the requirement is the
      member count and the group can still close. `npm run test:integration` — fails.
      *Threat-matrix row: quorum above member count.*
- [x] 3d.4 **RED** — `integration/vote-window.test.ts`: changing a vote past the window raises
      `vote_locked` and leaves `option_id` unchanged. `npm run test:integration` — fails.
      *Threat-matrix row: late change straight at the RPC.*
- [x] 3d.5 **RED** — same file, **the anti-ratchet test**: vote at T, change at T+14min (accepted,
      `first_cast_at` still T), change again at T+16min (rejected). Use a direct
      `update prediction_votes set first_cast_at = first_cast_at - interval …` to move the clock,
      never `created_at`. `npm run test:integration` — fails.
      *Threat-matrix row: re-vote every 14 minutes to hold the window open.*
- [x] 3d.6 **RED** — same file: a first cast is never locked even with the window at `never`;
      `until_close` never locks; `recurring` still raises `cycle_vote_used` regardless of the
      window; an unknown `p_vote_change_window` key raises `invalid_vote_window`.
      `npm run test:integration` — fails. *Threat-matrix rows: first cast, unknown key.*
- [x] 3d.7 **RED** — `integration/scoring-parity.test.ts`: a prediction that ran 100 days awards
      more points than an identical one that ran 4 hours, and the stored
      `prediction_scores.duration_multiplier` matches `public.duration_multiplier`.
      `npm run test:integration` — fails.
- [x] 3d.8 In `710_`, before any `create or replace`, add the three explicit drops with their exact
      current argument lists read from `db/rpc-functions.json`:
      `create_prediction(uuid, text, text[], timestamptz, text, public.option_source,
      public.voting_mode, interval, boolean, public.results_visibility, public.votes_visibility,
      smallint, smallint, integer)`,
      `create_prediction_from_template(uuid, uuid, timestamptz, integer)` and
      `required_close_requests(integer, smallint)` (its parameter is renamed, which
      `create or replace` cannot do).
- [x] 3d.9 In `710_`, re-create `required_close_requests(p_member_count integer, p_quorum
      smallint)` with the count semantics, and a comment saying the floor is 1 on purpose.
- [x] 3d.10 In `710_`, re-declare `create_prediction` with the **12-argument** signature: the three
      quorum params gone, `p_vote_change_window text default '15m'` added;
      `qualification_deadline` inserted as `null`; `status` from the group's
      `qualification_enabled`; `vote_change_window` from `vote_change_window_of(...)` raising
      `invalid_vote_window` on an unknown key; the `members` branch through `add_member_option`.
- [x] 3d.11 In `710_`, re-declare `create_prediction_from_template` with 3 arguments,
      `qualification_deadline = null`, no `minimum_participants`, `members` branch through
      `add_member_option`.
- [x] 3d.12 In `710_`, re-declare `cast_vote` with the lockout in the `single` branch only, per
      `design.md` § C. The `on conflict do update` MUST keep setting only `option_id` and
      `updated_at` — add a comment saying `first_cast_at` is deliberately untouched and why.
- [x] 3d.13 In `710_`, re-declare `score_prediction`: keep `v_close` exactly as it is for
      earliness; add `v_actual_close := coalesce(closed_at, resolved_at, now())`; compute
      `v_duration := duration_multiplier(v_actual_close - opens_at)`; pass
      `round(100 * v_duration)::integer` as the base; store `duration_multiplier` on the score row.
- [x] 3d.14 In `710_`, re-declare `request_close` and `withdraw_close_request` against
      `groups.close_request_quorum`, and `notify_change` to compute `required_participants` from
      the group's percent.
- [x] 3d.15 In `710_`, as the **last statement of the file**,
      `update public.predictions set status = 'active' where status = 'proposed';` with the comment
      from `design.md`.
- [x] 3d.16 Update `db/rpc-functions.json`: `create_prediction` loses the three quorum params and
      gains `"p_vote_change_window": "text"`; `create_prediction_from_template` loses
      `p_qualification_hours`.
- [x] 3d.17 Update the `Functions` block of `src/lib/database.types.ts` and — inside
      `src/data/predictions.ts` — only the **RPC call bodies** of `useCreatePrediction` and
      `useCreateFromTemplate`, so the parameters they send match 3d.16 exactly.
      Do **not** change the `CreatePredictionVars` interface here and do **not** touch the table
      column types: both are Phase 4. This keeps typecheck green — `CreatePredictionSheet.tsx`
      keeps passing the three quorum fields, the hook simply stops forwarding them, and the new
      `vote_change_window` takes its column default until the form learns to send it in Phase 6.
      An unread field on an interface is legal; a field the sheet passes but the interface has
      dropped is not, which is why the interface change waits.
- [x] 3d.18 Add `vote_locked` and `invalid_vote_window` to `src/lib/errors.ts`.
- [x] 3d.19 **REWRITE** every integration call site passing a removed parameter — set the group
      setting through `update_group_settings` first instead:
      `integration/prediction-qualification.test.ts:21,84,92,140`;
      `integration/prediction-closing.test.ts:93-107,140-177,179-225,227-260,262-308`;
      `integration/flow.test.ts:180,207-243,309,436`;
      `integration/realtime.test.ts:96-134`; `integration/predictions-read.test.ts:11-49`.
- [x] 3d.20 **REWRITE** `integration/flow.test.ts:171-186` (born `active` by default; `proposed`
      only with the toggle on) and `:245-301` (the "umbral de las 3 personas" walk-through, with
      the toggle explicitly enabled for that group).
- [x] 3d.21 **REWRITE** `integration/flow.test.ts:261-277` ("cambiar el voto NO suma un
      participante nuevo"): still true, but the change must now happen **inside** the window, or
      with the prediction created as `until_close`. Do not delete the assertion — it is the
      participant-counting guarantee, which is unrelated to the lockout.
- [x] 3d.22 **REWRITE** `integration/prediction-qualification.test.ts:157-235` (the
      `minimum_participants` backfill test) against the group-level backfill and the promotion.
- [x] 3d.23 **KEEP AND ANNOTATE** `integration/prediction-closing.test.ts:262-308`: it rewrites
      `prediction_votes.created_at` to simulate an early vote for the earliness multiplier. Add a
      comment that this must NOT be switched to `first_cast_at`, which is the security anchor —
      the two columns are deliberately separate.
- [x] 3d.24 `npm run db:reset && npm run typecheck && npm run test:integration` — all of 3d green.

### 3e. Grants

- [x] 3e.1 **REWRITE (RED)** — `integration/grants.test.ts:16-58`: add `update_group_settings` and
      `duration_multiplier` to `RPC_PUBLICA`. `:117-137`: add `vote_change_window_of`,
      `add_member_option`, `sync_member_options` and `on_member_joined` to `internas`.
      `npm run test:integration` — fails.
- [x] 3e.2 **REWRITE (RED)** — `integration/prediction-closing.test.ts:42-57` and `:59-67`: extend
      the grant assertions to the two new public functions and the four new internals.
      `npm run test:integration` — fails.
- [x] 3e.3 Create `db/migrations/720_rls_and_grants.sql` with the explicit
      `revoke execute … from public, anon, authenticated` **before** the `grant`, exactly as `620_`
      does, listing every new and re-signed function with its full argument types. Add the comment
      explaining that `ALTER DEFAULT PRIVILEGES` in an earlier migration does not suppress implicit
      PUBLIC EXECUTE for functions created in later files.
- [x] 3e.4 Confirm in a comment that no RLS policy change is needed: `groups_select_members` already
      covers the three new group columns, `prediction_votes_select_own_or_visible` already covers
      `first_cast_at`, and `groups` has no write policy, so the RPC is the only writer.
- [x] 3e.5 `npm run db:reset && npm run test:integration` — 3e.1 and 3e.2 go green.
- [x] 3e.6 **Phase gate.**

---

## Phase 4 — Server read path and generated types

- [x] 4.1 **REWRITE (RED)** — `integration/predictions-read.test.ts:11-49`: the derived fields are
      driven by the group settings, not by per-prediction parameters, and the returned votes carry
      `first_cast_at`. `npm run test:integration` — fails.
- [x] 4.2 Modify `server/src/prediction-select.ts`: add `join public.groups g on g.id = p.group_id`
      (inner, with the comment explaining why not `left`); derive `required_participants` from
      `g.qualification_percent` and `close_required` from `g.close_request_quorum`. Update the
      module docblock.
- [x] 4.3 Modify `src/lib/database.types.ts` table types: `groups` Row/Insert/Update gain the three
      columns; `predictions` gains `vote_change_window: string | null` and
      `qualification_deadline` becomes `string | null`; `prediction_votes` gains `first_cast_at`;
      `prediction_scores` gains `duration_multiplier`. Do **not** remove the three dropped
      `predictions` columns yet — they still exist until Phase 8.
- [x] 4.4 Modify `src/data/predictions.ts`: `CreatePredictionVars` drops the three quorum fields and
      gains `voteChangeWindow`; `PredictionScoreRow` gains `duration_multiplier: number`.
- [x] 4.5 **Same commit as 4.4, not a later one.** Dropping those fields from
      `CreatePredictionVars` makes `CreatePredictionSheet.tsx:150-168` an excess-property error, so
      fix its `mutate` call in place immediately: stop passing `qualificationPercent`,
      `closePercent` and `qualificationHours`, and pass the literal `voteChangeWindow: '15m'` — the
      "A ciegas" default — as a placeholder. It is a literal and not derived from `closeMode`: the
      window is owned by the preset, and when a prediction ends has nothing to do with how long a
      vote stays editable. The form value arrives in Phase 5.13 (schema) and the control in
      Phase 6.6. Run `npm run typecheck` before moving on.
- [x] 4.6 `npm run db:reset && npm run test:integration` — 4.1 goes green.
- [x] 4.7 **Phase gate.**

---

## Phase 5 — Client domain logic

- [x] 5.1 **REWRITE (RED)** — `src/lib/prediction.test.ts:121-136`: `effectiveStatus` never returns
      `expired` for a live row; an already-`expired` row still returns `expired`.
      `npm run test` — fails.
- [x] 5.2 **REWRITE (RED)** — `src/lib/prediction.test.ts:42,125,133,140,168,265`: drop
      `qualification_deadline` from the `StatusInput` fixtures; add `vote_change_window`.
      `npm run test` — fails.
- [x] 5.3 **REWRITE (RED)** — `src/lib/prediction.test.ts:211-216` ("se puede CAMBIAR el voto hasta
      el cierre"): editable inside the window; `canVote: false` with reason `vote_locked` after it;
      still unlimited with `vote_change_window: null`; unaffected for `recurring`.
      `npm run test` — fails.
- [x] 5.4 **REWRITE (RED)** — `src/lib/prediction.test.ts:429-449`: count semantics for
      `requiredCloseRequestsPreview` — `(1,1)===1`, `(5,3)===3`, `(2,9)===2`, `(3,0)===1`.
      `npm run test` — fails.
- [x] 5.5 **RED** — `src/lib/presets.test.ts` (new): each of the three concrete presets round-trips
      through `presetFor`; overriding any single field yields `'custom'`; restoring it yields the
      preset again; the mapping matches the owner-approved table exactly.
      `npm run test` — fails.
- [x] 5.6 **RED** — `src/lib/scoring.test.ts`: `durationMultiplier` at 0.5, 1, 10, 100, 365 and 4000
      days plus non-finite input; floor 1.0, cap 3.0, two-decimal rounding.
      `npm run test` — fails.
- [x] 5.7 **REWRITE (RED)** — `src/lib/scoring.test.ts:77-86`: keep "nunca supera el techo de 225"
      for base 100, and **add** the real ceiling of 675 with the duration multiplier at its cap.
      `npm run test` — fails.
- [x] 5.8 **RED** — `src/lib/scoring.test.ts:142-…`: `explainScore` returns a `duration` field and
      `total` reflects the scaled base. `npm run test` — fails.
- [x] 5.9 **REWRITE (RED)** — `src/lib/validation.test.ts:17-19,46-59`: remove the three fields from
      `baseInput`; assert the parsed output has none of them; add `voteChangeWindow` enum cases;
      move the 1..100 range cases onto the new `groupSettingsSchema` and add floor-1 cases for
      `closeRequestQuorum`. `npm run test` — fails.
- [x] 5.10 Modify `src/lib/prediction.ts`: drop `qualification_deadline` from `StatusInput`; delete
      the expiry branch of `effectiveStatus` (keep `expired` in the terminal-status guard); widen
      `voteAvailability`'s input with `vote_change_window`; add the `'vote_locked'` reason and
      replace the unconditional `canVote: true` in the `single` branch (`:207-210`); rewrite
      `requiredCloseRequestsPreview` as a count with floor 1 and a live cap; update the surrounding
      comments so they describe the new rules.
- [x] 5.11 Create `src/lib/presets.ts` per `design.md` § D — pure module, no React import.
- [x] 5.12 Modify `src/lib/scoring.ts`: add `MAX_DURATION`, `durationMultiplier(days)`,
      `ScoreInput.durationDays`, `ScoreBreakdown.duration`; correct the docblock ceiling (225 at
      base 100; 675 real).
- [x] 5.13 Modify `src/lib/validation.ts`: remove the three fields from `createPredictionSchema`,
      add `voteChangeWindow: z.enum(['until_close','1d','15m','never'])`, keep
      `quorumPercentSchema`, export `groupSettingsSchema`.
- [x] 5.14 Add `useUpdateGroupSettings(groupId)` to `src/data/groups.ts`, invalidating
      `qk.group(groupId)` **and** `qk.predictions(groupId)` — the derived requirements ride on the
      prediction rows, so a settings change must refetch them.
- [x] 5.15 **REWRITE** `src/components/prediction/PredictionCard.test.tsx:24-26,29`: drop
      `minimum_participants`, `qualification_percent`, `close_percent` and
      `qualification_deadline`; add `vote_change_window` and a `first_cast_at` on the vote fixture.
- [x] 5.16 `npm run test` — 5.1–5.9 and 5.15 go green.
- [x] 5.17 **Phase gate.**

---

## Phase 6 — Client UI

- [x] 6.1 **REWRITE (RED)** — `src/components/prediction/CreatePredictionSheet.test.tsx:32-39,50-61`:
      the three removed `HelpTip`s are **absent** (`queryByRole` is null) with the advanced panel
      expanded and close mode "Cuando lo pida el grupo"; keep the results/votes assertions.
      `npm run test` — fails.
- [x] 6.2 **RED** — same file: the preset row renders four choices with the owner's copy, "A ciegas"
      is selected by default, and it has a `HelpTip`. `npm run test` — fails.
- [x] 6.3 **RED** — same file: picking "A libro abierto" sets all four underlying fields at once
      (assert through the advanced panel's controls). `npm run test` — fails.
- [x] 6.4 **RED** — same file: overriding one advanced field flips the preset row to "A medida", and
      restoring it re-selects the original preset. `npm run test` — fails.
- [x] 6.5 **RED** — same file: with close mode "Cuando lo pida el grupo", a static line names how
      many people the group needs to close and says the number is changed in the group settings;
      and a points-preview line states the duration reward. `npm run test` — fails.
- [x] 6.6 Modify `src/components/prediction/CreatePredictionSheet.tsx` to the IA in `design.md` § D:
      delete the `qualificationHours` / `qualificationPercent` / `closePercent` controls, their
      `HelpTip`s, defaults, watches and the `QUALIFICATION_PRESETS` / `CLOSE_PRESETS` constants; add
      zone 2 (the preset `Segmented`, `columns={2}`, driven by `presetFor` during render); move the
      "Modo" segmented into "Más opciones" and add the vote-change-window control there with its
      `HelpTip`; add the open-ended close line and the points-preview line; rewrite the sheet
      `description` and success toast against `group.qualification_enabled`. Update the docblock —
      the old "Zona 2 es la jugada clave" note now describes the preset row.
- [x] 6.7 **RED** — `src/routes/GroupSettings.test.tsx` (new): an admin sees the toggle, the
      close-quorum input and a save button; the percentage control appears only when the toggle is
      on. `npm run test` — fails.
- [x] 6.8 **RED** — same file: a non-admin sees the three values as read-only text, no form control
      is focusable, and the "sólo quien administra…" line is present. `npm run test` — fails.
- [x] 6.9 **RED** — same file: the close-quorum input floors at 1 and is capped at the live member
      count. `npm run test` — fails.
- [x] 6.10 Modify `src/routes/GroupSettings.tsx`: add the "Cómo funciona este grupo" section between
      "El grupo" and "Tu cuenta", using `isAdmin` from the outlet context, `useGroup`, `useMembers`
      for the cap, `useUpdateGroupSettings`, `groupSettingsSchema` and the existing
      `Toggle` / `Segmented` / `TextField` / `HelpTip`. Reuse the `saved` / `succeeded` feedback
      pattern already in the profile block (`:38,51-55,82`).
- [x] 6.11 Modify `src/routes/GroupFeed.tsx`: hide the "En prueba" tab when
      `useGroup(groupId).data?.qualification_enabled` is false.
- [x] 6.12 **RED** — a card-level test: `ParticipationThreshold` is not rendered by `PredictionCard`
      for an `active` prediction, and a locked vote renders the settled copy instead of "Podés
      cambiarlo hasta el cierre". `npm run test` — fails.
- [x] 6.13 Modify `src/components/prediction/PredictionCard.tsx:267` and
      `src/routes/PredictionDetail.tsx:331`: replace "Podés cambiarlo hasta el cierre" with the real
      window ("Tenés 15 minutos para corregir tu voto") and, once elapsed, "Tu voto quedó firme".
      Disable the options when `voteAvailability.reason === 'vote_locked'`.
- [x] 6.14 Modify `src/routes/PredictionDetail.tsx:506-523`: extend the `explainScore` sentence with
      the persisted `duration_multiplier`, omitting the factor when it is exactly 1.00.
- [x] 6.15 `npm run test` — 6.1–6.5, 6.7–6.9 and 6.12 go green.
- [x] 6.16 **Phase gate.**

---

## Phase 7 — Seed, harness and copy

- [x] 7.1 Modify `db/seed.sql`: drop `p_min` from `pg_temp.seed_prediction` (`:103,122`) and stop
      writing `minimum_participants` / `qualification_deadline` (`:116`); set
      `qualification_enabled = true` on the demo group so the seeded "en prueba" rows still mean
      something; leave the seeded `expired` row (`:244`) exactly as it is — it is the
      pre-existing-row fixture.
- [x] 7.2 Modify `integration/helpers.ts:350-359` and `e2e/support.ts:105-115`: `timeTravel` stops
      shifting the now-dead `qualification_deadline`, and gains an optional `first_cast_at` shift so
      the lockout is testable from a helper rather than ad-hoc SQL.
- [x] 7.3 Rewrite `src/routes/Landing.tsx:208-220` and its `ParticipationThreshold` demo
      (`:65-67,82-84,197-204`): qualification is an **opt-in group setting, off by default**, and a
      prediction **never expires**. Delete "si en 48 horas no la eligen al menos tres personas" and
      anything promising a fixed number of people or a deadline. Keep the demo widget, reframed as
      "si el grupo lo prende".
- [x] 7.4 Rewrite `README.md:22-27`, `:114`, `:222`, `:482-487` to match, and add the vote-change
      window, the presets and the duration multiplier to the mechanics section.
- [x] 7.5 **REWRITE** `e2e/invitado.spec.ts:50` (the copy matcher) and `:57-81` ("puede cambiar su
      voto hasta el cierre" → can change **inside** the window, cannot after). Write, do **not**
      run — Playwright browsers are not installed.
- [x] 7.6 Write (do not run) an e2e spec for the preset flow and for an admin changing the group
      settings so a new prediction is born open.
- [x] 7.7 `npm run db:reset` (exercises the edited seed), then **phase gate**.

---

## Phase 8 — The destructive drop

Last, on purpose: by now nothing in SQL, server or client reads these columns.

- [x] 8.1 **RED** — `integration/group-settings.test.ts`: `predictions` has no
      `qualification_percent`, `close_percent` or `minimum_participants`, via
      `information_schema.columns`. `npm run test:integration` — fails.
- [x] 8.2 Create `db/migrations/730_drop_prediction_quorum_columns.sql` dropping the three columns,
      with a header comment naming the snapshot requirement and listing what is lost (see
      `proposal.md` § What Is Lost).
- [x] 8.3 Modify `src/lib/database.types.ts`: remove the three columns from `predictions`
      Row / Insert / Update.
- [x] 8.4 `npm run db:reset && npm run test:integration` — 8.1 goes green.
- [x] 8.5 **Phase gate.**

---

## Phase 9 — Adversarial cases and final verification

Every row here comes from `design.md` § Threat Matrix and must exist as a real test, not a note.

- [x] 9.1 Confirm each threat-matrix case has a passing test:
      plain member → `admin_only` (3a.1); non-member → `admin_only` (3a.1);
      `close_request_quorum = 0` rejected (1.2); `qualification_percent` 0/101 rejected (1.2);
      quorum above member count still closeable (3d.3);
      `p_is_default` not passable (`flow.test.ts:188-205` — confirm it still passes against the new
      signature); **late vote change → `vote_locked` (3d.4)**;
      **re-vote every 14 min does not extend the window (3d.5)**;
      first cast never locked, unknown window key rejected (3d.6);
      negative window rejected (2.1);
      option deletion cascades to votes → never delete (3b.2);
      identical display names both get an option (3b.4);
      repeated leave/rejoin yields exactly one option (3b.3);
      points farming — no test, **accepted risk**, documented in `proposal.md` § Risks.
- [x] 9.2 Confirm the scoring parity guarantee: `integration/scoring-parity.test.ts:14-104` still
      passes **unmodified** (proving `calculate_points` did not move), and the new duration grid
      passes alongside it.
- [x] 9.3 Confirm no test was deleted to make the suite pass. Every entry in `design.md`'s rewrite
      table is a rewrite, and the rewrite was the RED step. In particular
      `integration/prediction-closing.test.ts:262-308` is kept and annotated, not switched to
      `first_cast_at`.
- [x] 9.4 Confirm `openspec/specs/*` were **not** edited by hand — the deltas in
      `openspec/changes/simpler-prediction-setup/specs/` are merged by `sdd-archive`.
- [x] 9.5 Confirm `supabase/migrations/` and `supabase/seed.sql` are untouched; the `rules.archive`
      warning about the dead mirror is expected and accepted.
- [x] 9.6 Confirm `openspec/changes/group-level-settings/` no longer exists (Phase 0.1).
- [x] 9.7 Final gate: `npm run typecheck && npm run lint && npm run test &&
      npm run test:integration && npm run build`. Unit count ≥ 149 plus the new suites; integration
      count ≥ 95 plus the new suites. `npm run test:e2e` **not run** — Playwright browsers are not
      installed; do not claim it passed.

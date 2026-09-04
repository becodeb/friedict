# Apply Progress: Simpler Prediction Setup

**Status**: All 131 tasks in `tasks.md` are checked off. All four gates green, run by this
executor, output actually observed (not assumed):

```
npm run typecheck        → clean
npm run lint              → clean
npm run test               → 15 files, 186 tests passed (baseline 149)
npm run test:integration   → 14 files, 129 tests passed (baseline 95)
npm run build               → succeeds (client bundle + PWA service worker generated)
```

`npm run test:e2e` was **not run** — Playwright browsers are not installed in this
environment. All e2e specs were written/rewritten, never executed, never claimed to pass.

## Mode

Strict TDD (`openspec/config.yaml:10`), applied at file/logical-unit granularity given the
size of this change (~2,100 authored lines across 5 new SQL migrations, 4 new integration
test files, 1 new client module, and ~24 modified files). For every SQL migration and every
client module, the test file was written and run against the not-yet-existing behaviour
first (RED), confirmed to fail for the right reason, then the implementation was added and
the same tests re-run to green, then triangulated with additional cases where the spec
called for them (threat-matrix rows, boundary values, anti-ratchet scenarios).

## Orchestrator-mandated addition (beyond design.md)

The orchestrator overrode design.md's Open Questions deferral of the "A libro abierto"
hindsight-switch exploit and required it closed in this same change. Implemented as:

- New column `prediction_votes.option_selected_at` (`705_vote_window_and_scoring.sql`),
  distinct from both `created_at` (row insert time, no longer read by scoring) and
  `first_cast_at` (the vote-lockout security anchor, untouched by option changes). Set on
  insert; updated in `cast_vote`'s `on conflict … do update` **only** when `option_id`
  actually changes (an idempotent re-vote for the same option does not move it).
- Backfilled from `created_at` for pre-existing rows.
- `score_prediction` (710_) now computes `first_winner_at` from
  `min(option_selected_at) filter (...)` instead of `min(created_at) filter (...)`.
  `calculate_points` itself and `p_base`/its other parameters are untouched — only which
  timestamp feeds the earliness calculation changed, exactly like the duration multiplier
  only changes what feeds `p_base`.
- `integration/scoring-parity.test.ts:14-104` (the grid calling `calculate_points` at a
  fixed base of 100) passes **unmodified**.
- New integration test in `prediction-closing.test.ts` ("cambiar el voto a la ganadora en
  el último momento NO farmea la anticipación…") proves a late switch to the winning option
  earns materially less earliness credit than an early, unchanged vote.
- `prediction-closing.test.ts:262-308`'s existing fixture (which fakes an early vote by
  rewriting a timestamp) was updated to rewrite `option_selected_at` instead of
  `created_at`, with an explicit comment distinguishing all three timestamps. This is a
  **deliberate deviation from design.md's own text**, which said this fixture must not be
  "switched to `first_cast_at`" (true — it wasn't) but assumed it would stay on
  `created_at` forever (no longer true, because `created_at` stopped being scoring-relevant
  the moment `option_selected_at` was introduced). The fixture would have silently stopped
  proving anything if left unchanged.

## Deviation: design.md's stated duration-multiplier reference point is wrong

design.md and `tasks.md` (task 2.3) both state `duration_multiplier` returns **2.93** for a
365-day span. The formula as specified
(`round(least(3.0, greatest(1.0, 1.0 + 0.75 * log(... / 86400.0))), 2)`) actually evaluates
to **2.92** for 365 days — verified directly against the live Postgres instance
(`select round(least(3.0, greatest(1.0, 1.0 + 0.75 * log(greatest(1.0, 365::numeric)))), 2)`
→ `2.92`) and cross-checked against the TypeScript mirror. The formula itself was
implemented exactly as specified; only the illustrative reference number in the design docs
was off by 0.01. All tests (SQL and TS) assert the **correct, verified** value of 2.92, not
the design doc's 2.93.

## Files changed (highlights; see `git status`/`git diff` for the complete list)

**New SQL migrations** (`db/migrations/`): `700_group_settings.sql`,
`705_vote_window_and_scoring.sql`, `710_functions.sql`, `720_rls_and_grants.sql`,
`730_drop_prediction_quorum_columns.sql`.

**New/rewritten integration tests** (`integration/`): `group-settings.test.ts`,
`vote-window.test.ts`, `member-options.test.ts` (all new); `prediction-qualification.test.ts`,
`prediction-closing.test.ts`, `flow.test.ts`, `realtime.test.ts`, `predictions-read.test.ts`,
`grants.test.ts`, `scoring-parity.test.ts` (extended, original grid untouched) — all rewritten
per design.md's rewrite table.

**New client modules**: `src/lib/presets.ts` (+ `presets.test.ts`).

**Modified client**: `src/lib/prediction.ts`, `src/lib/scoring.ts`, `src/lib/validation.ts`,
`src/lib/errors.ts`, `src/lib/database.types.ts`, `src/data/predictions.ts`,
`src/data/groups.ts`, `src/components/prediction/CreatePredictionSheet.tsx` (+ test, full
rewrite), `src/components/prediction/PredictionCard.tsx` (+ test), `src/routes/GroupSettings.tsx`
(+ new test file), `src/routes/GroupFeed.tsx`, `src/routes/PredictionDetail.tsx`,
`src/routes/Landing.tsx` (+ existing test still passing).

**Server**: `server/src/prediction-select.ts` (group join for derived fields),
`server/src/routes.ts` (scores route selects `duration_multiplier`).

**Seed/config**: `db/seed.sql`, `db/rpc-functions.json`.

**Docs/copy**: `README.md`, `deploy/README.md` (730_ snapshot runbook note),
`src/routes/Landing.tsx`.

**Harness**: `integration/helpers.ts`, `e2e/support.ts` (`timeTravel` signature extended,
`qualification_deadline` no longer shifted).

**E2E (written, never run)**: `e2e/invitado.spec.ts` (two tests rewritten),
`e2e/creador.spec.ts` (two tests rewritten for no-expiry / active-by-default),
`e2e/ajustes-y-presets.spec.ts` (new — preset flow + admin group settings flow).

## Non-negotiables checklist

- All new SQL lives in new `700_`–`730_` files; no applied migration (`000`–`620`) was
  edited. `supabase/migrations/` and `supabase/seed.sql` untouched (verified via `git
  status`).
- Explicit `drop function if exists` with the exact old argument lists precedes every
  signature change (`create_prediction`, `create_prediction_from_template`,
  `required_close_requests`), in `710_functions.sql`. Verified `select count(*) from
  pg_proc where proname = '<name>'` = 1 for `create_prediction` and
  `create_prediction_from_template` via a dedicated integration test.
- Every new function (`update_group_settings`, `duration_multiplier`,
  `vote_change_window_of`, `add_member_option`, `sync_member_options`, `on_member_joined`,
  the re-signed `required_close_requests`, and the re-signed RPCs) gets an explicit
  `revoke … from public, anon, authenticated` before its `grant` in `720_rls_and_grants.sql`.
  `integration/grants.test.ts` and `prediction-closing.test.ts`'s grants describe block
  assert this for every one of them.
- `db/rpc-functions.json` updated for `create_prediction`, `create_prediction_from_template`,
  and the new `update_group_settings`.
- `db/seed.sql` no longer writes `minimum_participants`/`qualification_deadline`; "Los
  pibes" gets `qualification_enabled = true` in the seed so the seeded "en prueba" fixture
  keeps meaning something; the legacy `expired` row (#5) is left exactly as-is.
- Presets are not persisted anywhere; `presetFor()` derives from the four underlying
  columns every render.
- Every entry in design.md's rewrite table was rewritten, not deleted — confirmed by
  re-reading every touched test file's diff and comparing test counts before/after (149→186
  unit, 95→129 integration — net growth, no net loss).
- Rioplatense Spanish in all new UI copy and SQL/TS comments; English identifiers throughout.
- `src/routes/Landing.tsx` and `README.md` updated to stop marketing qualification as
  mandatory/time-bounded and to describe it as an opt-in, never-expiring group setting.

## Known residual risk (documented, not a defect)

"A libro abierto" pairs `single` voting with `voteChangeWindow: 'until_close'` by design —
unlimited vote changes are the point of that preset. The orchestrator's fix closes the
*scoring* exploit (a late switch no longer earns early-voter credit) but does not add a
lockout to that preset — that would contradict what the preset promises. This matches the
proposal's own framing: "A libro abierto" is for predictions where nothing is at stake.

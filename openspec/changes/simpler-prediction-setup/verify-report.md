# Verify Report: simpler-prediction-setup

**Verdict: pass-with-findings** — 0 CRITICAL, 2 WARNING, 2 SUGGESTION.

## Test evidence (already green, re-confirmed spot-checks)
- `npm run typecheck/lint/test/test:integration/build` green per apply-progress.md (186 unit / 129 integration).
- Independently queried the live Postgres instance (127.0.0.1:54432) directly, bypassing the test suite:
  - `select proname, count(*) from pg_proc where proname in ('create_prediction','create_prediction_from_template','required_close_requests') group by proname` → all exactly 1. No surviving overload.
  - `has_function_privilege('public'/'anon'/'authenticated', ...)` for every new/re-signed function: `update_group_settings` and `duration_multiplier` → authenticated only; `vote_change_window_of`, `add_member_option`, `sync_member_options`, `on_member_joined` → nobody, including authenticated. `create_prediction`/`create_prediction_from_template` → authenticated only, public/anon false.
  - `information_schema.columns` on `predictions` for `qualification_percent`/`close_percent`/`minimum_participants` → empty (dropped).
  - `pg_get_functiondef(finalize_predictions)` → does not contain the string `'expired'` anywhere in the live function body. No live path can set that status.

## Focus-area findings

### 1. Vote-change lockout — PASS
`cast_vote` (710_functions.sql:619-631) enforces the lockout in the `single` branch only, in the database, with `first_cast_at` written once (705_:25, never touched by the `on conflict … do update`, 710_:636-649). Anti-ratchet is directly tested and passing: `integration/vote-window.test.ts:138-190` moves `first_cast_at` backward via raw SQL (never `created_at`) and proves a T+14min change is accepted with `first_cast_at` unmoved, then a T+16min change is rejected. `recurring` keeps `cycle_vote_used` independent of the window (`710_`:650-659, tested at `vote-window.test.ts:244-260`).

### 2. Hindsight-earliness fix — PASS, with one untested invariant (see SUGGESTION S1)
This was an orchestrator-mandated addition beyond design.md, and it is real, not just claimed. Verified directly:
- `705_vote_window_and_scoring.sql:56-61` adds `prediction_votes.option_selected_at`, distinct from both `first_cast_at` (security anchor) and `created_at`.
- `cast_vote`'s upsert (710_:645-649) moves it via `case when excluded.option_id is distinct from … then now() else … end` — only on a real option change, confirmed by reading the SQL.
- `score_prediction` (710_:734) computes `first_winner_at` from `min(option_selected_at) filter (...)`, not `created_at`.
- `calculate_points` and its parity grid are untouched — `integration/scoring-parity.test.ts` runs the original grid unmodified plus a new duration grid.
- A dedicated integration test (`prediction-closing.test.ts:377-428`) proves a late switcher (votes loser, then switches to winner right before close) earns strictly less `early_multiplier` than an early holder who never changed — `expect(Number(early.early_multiplier)).toBeGreaterThan(Number(late.early_multiplier))`.

### 3. Function overloads — PASS (empirically verified against the live DB, not just re-trusting the test suite)

### 4. Grants — PASS (empirically verified against the live DB; every internal helper is unreachable by every role, every public helper is authenticated-only)

### 5. Destructive drop — PASS
No SQL/server/client code references `qualification_percent`/`close_percent` in a `predictions` context (all remaining hits are on `groups`, correctly). `db/seed.sql` no longer writes `minimum_participants` or `p_min`. `730_drop_prediction_quorum_columns.sql` is isolated, correctly documented, and preceded by an explicit backup requirement wired into `deploy/README.md`.

### 6. Nothing expires — PASS
`finalize_predictions` in `710_functions.sql` has no expiry step (confirmed both by reading the file and by inspecting the live function body via `pg_get_functiondef`). `effectiveStatus` in `src/lib/prediction.ts` never returns `expired` for a non-already-expired row.

### 7. Live "los del grupo" — PASS
`integration/member-options.test.ts` directly covers every spec scenario: late joiner gets an option; leaver keeps the option AND the votes cast for it (counted before/after); rejoin creates no duplicate (partial unique index `prediction_options_member_idx`); two identical `display_name`s both get distinct labels (`Igual`/`Igual (2)`); a rename via `upsert_profile` does not rewrite an existing label; a closed/resolved prediction gets no new option on a late join.

### 8. Presets — PASS
`src/lib/presets.ts` is a pure module (no React import), nothing is persisted — `presetFor()` derives the preset from the four live columns on every render. `src/lib/presets.test.ts` proves each preset round-trips and any single-field override yields `'custom'`.

### 9. Duration-scaled points — PASS
Floored at 1.0, capped at 3.0 (`705_`:82-84, `scoring.ts:41-46` mirror). Uses **actual** elapsed time (`v_actual_close := coalesce(closed_at, resolved_at, now())`, kept deliberately separate from `v_close`, the earliness denominator, which is unchanged). SQL/TS parity is tested over a grid including the clamp boundaries.

One legitimate, well-documented deviation: `design.md` and `tasks.md` (task 2.3) both assert the 365-day reference point is **2.93**; the formula as specified actually evaluates to **2.92**, verified live against Postgres. The apply executor caught this, corrected the illustrative number, and used the *correct* verified value everywhere in tests (both SQL and TS). This is a documentation bug in the design artifact, not an implementation defect — flagged in `apply-progress.md` and independently re-verified here: `1 + 0.75·log10(365) = 2.9217...`, rounds to 2.92.

### 10. Group settings authorization — PASS
`update_group_settings` requires `is_group_admin`, raising `admin_only` (42501) for both a plain member and a non-member, verified by a real integration test that has both the owner and a promoted admin succeed while a `member` and an `outsider` are rejected and confirms the group's final state reflects only the two valid calls.

## Findings

### WARNING — Stale UI copy contradicts the new vote-change-window control
`src/components/prediction/CreatePredictionSheet.tsx:492`, the "Modo" segmented control inside "Más opciones" still describes the `single` option as **"Cambiable hasta el cierre"**:
```
{ value: 'single', label: 'Un voto', description: 'Cambiable hasta el cierre' },
```
This was true before this change (voting_mode `single` was unconditionally editable until close) but is no longer true for the default "A ciegas" preset (15-minute window) or "Evolutiva" — and this stale line sits in the same collapsed panel, directly above the new, correct "¿Hasta cuándo se puede corregir el voto?" control (`:522-536`), so the panel now contradicts itself. Violates the spec's own intent (`vote-change-window/spec.md`, "The copy stops promising unlimited changes") even though the specific surfaces named in that scenario (`PredictionCard.tsx:267`, `PredictionDetail.tsx:331`) were correctly rewritten. No test locks this stale string in place (`CreatePredictionSheet.test.tsx` does not assert it), so it is a genuine oversight, not an intentional choice.
**Fix**: drop the description entirely, or replace it with something that doesn't promise a fixed window, e.g. "Se puede corregir según la ventana de abajo".

### WARNING — `required_close_requests` is granted to `authenticated` but is never called directly by the client
`720_rls_and_grants.sql:34-35` grants `execute` on `required_close_requests(integer, smallint)` to `authenticated`, matching `design.md`'s stated grant list. This mirrors the pre-existing `620_` precedent (the old `required_close_requests` was also public), so it's consistent with house style and not a security hole by itself — but it's worth flagging because it's a pure calculation helper whose only real caller is other `SECURITY DEFINER` functions (`request_close`, `withdraw_close_request`, `finalize_predictions`), same shape as `duration_multiplier`, which the design explicitly justifies as "the client uses it to preview points." No equivalent justification is written down for exposing `required_close_requests` to the client (`requiredCloseRequestsPreview` in `src/lib/prediction.ts` is a pure TS mirror, not an RPC call). Not exploitable, not incorrect — just an unexplained grant surface that a future reviewer will have to re-derive from scratch.

### SUGGESTION — No integration test directly asserts the idempotent-revote invariant on `option_selected_at`
The SQL logic is correct (verified by reading `710_functions.sql:645-649`: `case when excluded.option_id is distinct from … then now() else … end`), and the design's stated invariant ("an idempotent re-vote for the same option does not move it") is real. But no test in `vote-window.test.ts` or `prediction-closing.test.ts` re-votes for the *same* option twice and asserts `option_selected_at` is unchanged the way `first_cast_at`'s anti-ratchet is explicitly tested. The closest coverage is the late-switch test, which only exercises a real option *change*. Given this is exactly the kind of invariant this change is most worried about getting subtly wrong (task focus #2 explicitly calls it out), it would benefit from the same explicit treatment `first_cast_at` got.

### SUGGESTION — `duration_multiplier` numeric(4,2) storage precision undocumented against a future scale change
`705_vote_window_and_scoring.sql:67` stores `prediction_scores.duration_multiplier numeric(4, 2)`. At the current cap of 3.00 this has generous headroom, but if `MAX_DURATION` is ever raised past 99.99 in a future change (unlikely, but the column doesn't self-document its own ceiling the way the CHECK on `groups.qualification_percent` does), the column would silently overflow rather than reject. Not a defect in this change — the value is always in `[1.00, 3.00]`, well within range — just a latent trap for a careless future edit that a `check (duration_multiplier between 1.0 and 3.0)` would close for free.

## Non-findings explicitly ruled out (adversarial checks that came back clean)
- Re-voting every 14 minutes cannot hold the vote-change window open (empirically tested, not just claimed).
- A departed member's option is never deleted; cascade-to-votes and restrict-on-resolved-option are both respected by construction (never deleted, not merely "usually" not deleted).
- Two members with the same `display_name` cannot violate `unique(prediction_id, label)` — collision suffixing tested up to `(2)`.
- `required_close_requests` floor of 1 cannot be bypassed by a large stored quorum (member-count cap happens at read time, tested with quorum far above member count).
- No lingering `qualification_percent`/`close_percent` read anywhere outside historical (never-reapplied) migration files `600_`/`610_`.
- No live code path can set `expired` (checked the actual function body in the running database, not just the source file).

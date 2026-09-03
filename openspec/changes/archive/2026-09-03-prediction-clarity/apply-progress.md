# Apply Progress: Prediction Clarity

**Mode**: Strict TDD
**Status**: 47/47 tasks complete. All four gate commands green (typecheck, lint, test, test:integration).

## Final Gate (run by the executor, output observed)

```
npm run typecheck        → clean, 0 errors
npm run lint              → clean, 0 errors
npm run test               → 13 files, 147/147 tests passing (baseline was 4 files / 68 tests)
npm run test:integration  → 9 files, 84/84 tests passing (baseline was 5 files / 61 tests)
```

`npm run test:e2e` was NOT run (Playwright browsers unavailable in this environment, as
stated up front). One e2e spec was added (`e2e/indexing.spec.ts`) — written, never executed,
and clearly marked as such in its own docblock.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `integration/prediction-qualification.test.ts` | Integration | N/A (new) | ✅ | ✅ | ✅ 6 cases | ➖ |
| 1.2 | `integration/flow.test.ts` (rewritten, not deleted) | Integration | ✅ 30/30 pre-existing kept | ✅ | ✅ | ✅ 2 cases | ➖ |
| 1.3 | `integration/prediction-closing.test.ts` | Integration | N/A (new) | ✅ | ✅ | ✅ 2 cases | ➖ |
| 1.4 | `integration/prediction-closing.test.ts` | Integration | N/A (new) | ✅ | ✅ | ✅ 4 cases | ➖ |
| 1.5 | `integration/prediction-qualification.test.ts` | Integration | N/A (new) | ✅ | ✅ | ✅ 2 groups | ➖ |
| 1.6 | `integration/prediction-closing.test.ts` | Integration | N/A (new) | ✅ | ✅ | ➖ single | ➖ |
| 1.7–1.11 | SQL migrations `600_*`/`610_*`/`620_*` | Integration (all above) | ✅ | ✅ | ✅ (`db:reset` + full integration suite) | ✅ | ✅ fixed a LATERAL/UPDATE syntax bug found during GREEN (see Deviations) |
| 2.1 | `integration/predictions-read.test.ts` | Integration | N/A (new) | ✅ | ✅ | ✅ 2 states (before/after vote) | ✅ extracted `prediction-select.ts` to keep it express-free |
| 2.2–2.3 | covered by 2.1 + `integration/realtime.test.ts` | Integration | ✅ 4/4 pre-existing kept | ✅ | ✅ | ➖ | ➖ |
| 2.4–2.5 | `integration/robots.test.ts` + `e2e/indexing.spec.ts` (written, not run) | Integration + E2E(unrun) | N/A (new) | ✅ | ✅ | ✅ 6 cases | ➖ |
| 3.1–3.5 | `src/lib/prediction.test.ts` | Unit | ✅ 24/24 pre-existing kept | ✅ | ✅ | ✅ many cases | ✅ extracted `closesAtMs()` helper |
| 3.6–3.7 | type-only (`database.types.ts`, `types.ts`) | Unit (via typecheck) | N/A | ✅ (typecheck failed pre-change) | ✅ | ➖ structural | ➖ |
| 3.8 | `src/lib/prediction.test.ts` | Unit | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3.9 | `src/lib/indexing.test.ts` | Unit | N/A (new) | ✅ | ✅ | ✅ 7 cases | ➖ |
| 3.10–3.11 | `src/lib/indexing.test.ts` (drift guard) | Unit | N/A (new) | ✅ | ✅ | ➖ single | ➖ |
| 3.12–3.13 | `src/lib/validation.test.ts` | Unit | N/A (new) | ✅ | ✅ | ✅ many cases | ➖ |
| 3.14 | covered by `src/lib/errors.ts` usage in 6.5/PredictionDetail | Unit | N/A | ✅ | ✅ | ➖ structural | ➖ |
| 4.1–4.3 | covered by typecheck + `integration/predictions-read.test.ts` | Integration/type | ✅ | ✅ | ✅ | ➖ | ➖ |
| 5.1 | `src/components/ui/HelpTip.test.tsx` | Unit (RTL) | N/A (new) | ✅ | ✅ | ✅ 8 cases | ➖ |
| 5.2 | same | Unit | N/A (new) | ✅ | ✅ | ✅ | ➖ |
| 5.3 | `src/components/ui/Segmented.test.tsx` | Unit (RTL) | N/A (new) | ✅ | ✅ | ✅ 2 cases | ➖ |
| 5.4 | same | Unit | N/A (new) | ✅ | ✅ | ➖ | ➖ |
| 6.1 | `src/components/prediction/VoteOption.test.tsx` (rewritten, not deleted) | Unit (RTL) | ✅ 6/6 pre-existing kept (before rewrite) | ✅ | ✅ | ✅ 13 cases total | ➖ |
| 6.2 | same | Unit | ✅ | ✅ | ✅ | ➖ | ➖ |
| 6.3–6.4 | same file, `ParticipationThreshold` describe block | Unit | ✅ 4/4 pre-existing kept | ✅ | ✅ | ✅ 5 cases | ➖ |
| 6.5–6.6 | `src/components/prediction/PredictionCard.test.tsx` (new) + full typecheck for `PredictionDetail.tsx` | Unit (RTL) + type | N/A (new component test); PredictionDetail itself not directly rendered — see Deviations | ✅ | ✅ | ✅ 2 cases (with/without `closes_at`) | ➖ |
| 6.7 | `integration/flow.test.ts` full regression | Integration | ✅ 30/30 | ✅ (ran first, green) | ✅ | ➖ | ➖ |
| 7.1 | `src/components/prediction/PredictionCard.test.tsx` | Unit (RTL) | N/A (new) | ✅ | ✅ | ✅ 2 cases | ➖ |
| 7.2 | covered by `integration/prediction-closing.test.ts` (request/withdraw RPCs) + typecheck of the panel | Integration/type | ✅ | ✅ | ✅ | ➖ | ➖ |
| 7.3 | `src/lib/validation.test.ts` (`roundsBeforeClose`) | Unit | N/A (new) | ✅ | ✅ | ✅ 4 cases | ➖ |
| 7.4–7.6 | `src/components/prediction/CreatePredictionSheet.test.tsx` | Unit (RTL) | N/A (new) | ✅ | ✅ | ✅ 5 cases | ➖ |
| 7.7 | `src/routes/Landing.test.tsx` (hardcode assertions) + CreatePredictionSheet toast/description now computed | Unit | N/A (new) | ✅ | ✅ | ➖ | ➖ |
| 7.8–7.9 | `src/components/prediction/CreatePredictionSheet.test.tsx` | Unit (RTL) | N/A (new) | ✅ | ✅ | ✅ 5 fields checked | ➖ |
| 8.1–8.2 | `src/components/SeoRobots.test.tsx` | Unit (RTL) | N/A (new) | ✅ | ✅ | ✅ 4 cases, both nav directions | ➖ |
| 8.3 | `index.html` (structural, no test — passive doc edit) | — | N/A | ➖ | ✅ | ➖ | ➖ |
| 8.4–8.5 | `src/lib/robots-txt.test.ts` | Unit | N/A (new) | ✅ | ✅ | ✅ 2 cases | ➖ |
| 8.6 | `deploy/Caddyfile` (structural, no automated test — matches task's own scope) | — | N/A | ➖ | ✅ | ➖ | ➖ |
| 8.7–8.8 | `src/routes/Landing.test.tsx` | Unit (RTL) | N/A (new) | ✅ | ✅ | ✅ 3 cases | ➖ |
| 8.9 | `src/routes/Landing.test.tsx` (hardcode assertions) | Unit (RTL) | N/A (new) | ✅ | ✅ | ➖ | ➖ |
| 9.1 | full four-command gate | — | ✅ | — | ✅ (this report) | — | — |

### Test Summary

- **Total tests written this session**: 79 new unit tests, 23 new integration tests (102 total).
- **Total tests passing**: 147 unit / 84 integration = 231.
- **Layers used**: Unit (147, incl. component RTL tests), Integration (84), E2E (1 spec written, 0 run).
- **Approval tests** (refactoring): the pre-existing `integration/flow.test.ts` (30 tests, only 2 lines
  rewritten) and `VoteOption.test.tsx` (rewritten, not deleted) served as the approval/regression net for
  `cast_vote` and the radio semantics.
- **Pure functions created**: `robotsFor` (×2, server+client), `closesAtMs`, `canSeeVotes`,
  `requiredParticipantsPreview`/`requiredCloseRequestsPreview`, `roundsBeforeClose`.

## Work Unit Evidence (per suggested unit in tasks.md)

| Unit | Focused test command run | Runtime harness | Result | Rollback boundary |
|---|---|---|---|---|
| 1 (DB) | `npm run test:integration` | Live dev Postgres via `npm run db:reset` | 84/84 green | Revert `db/migrations/600_*`, `610_*`, `620_*` (additive-only, safe to leave unread) |
| 2 (Server read path) | `npm run test:integration` | Same DB | 84/84 green | Revert `server/src/{routes,realtime,robots,prediction-select}.ts`, `server/src/index.ts` |
| 3 (Client lib) | `npm run test` (`src/lib/*.test.ts`) | jsdom, no DB | 147/147 green | Revert `src/lib/{prediction,validation,errors,indexing,database.types,types}.ts` |
| 4 (Client data layer) | `npm run typecheck` + integration read test | jsdom + live DB | clean / 84/84 | Revert `src/data/predictions.ts`, `realtime.ts`; `GroupShell.tsx`, `History.tsx` |
| 5 (Help affordance) | `npm run test` (`HelpTip`, `Segmented`) | jsdom | 147/147 green | Revert `HelpTip.tsx`, `Segmented.tsx` prop |
| 6 (Two-step voting) | `npm run test` (`VoteOption`, `PredictionCard`) + `npm run test:integration` (`flow.test.ts`) | jsdom + live DB | 147/147 + 84/84 green | Revert `VoteOption.tsx`, `ParticipationThreshold.tsx`, `PredictionCard.tsx`, `PredictionDetail.tsx` |
| 7 (Closing UI) | `npm run test` (`CreatePredictionSheet`, `validation`) | jsdom | 147/147 green | Revert `CreatePredictionSheet.tsx`, `PredictionDetail.tsx` close-request panel |
| 8 (Indexing + assets) | `npm run test` (`SeoRobots`, `Landing`, `robots-txt`) | jsdom | 147/147 green | Revert `SeoRobots.tsx`, `App.tsx` mount, `index.html`, `public/robots.txt`, `deploy/Caddyfile` |
| 9 (Full-suite gate) | all four commands | Live dev Postgres | All green (see Final Gate above) | N/A — verification only |

## Files Changed

### New

- `db/migrations/600_quorum_and_open_close.sql`, `610_functions.sql`, `620_rls_and_grants.sql`
- `server/src/robots.ts`, `server/src/prediction-select.ts`
- `src/lib/indexing.ts`
- `src/components/ui/HelpTip.tsx`
- `src/components/SeoRobots.tsx`
- `public/robots.txt`
- `e2e/indexing.spec.ts` (written, not executed)
- Tests: `integration/prediction-qualification.test.ts`, `integration/prediction-closing.test.ts`,
  `integration/predictions-read.test.ts`, `integration/robots.test.ts`,
  `src/lib/validation.test.ts`, `src/lib/indexing.test.ts`, `src/lib/robots-txt.test.ts`,
  `src/components/ui/HelpTip.test.tsx`, `src/components/ui/Segmented.test.tsx`,
  `src/components/prediction/PredictionCard.test.tsx`,
  `src/components/prediction/CreatePredictionSheet.test.tsx`,
  `src/components/SeoRobots.test.tsx`, `src/routes/Landing.test.tsx`

### Modified

- `db/rpc-functions.json`
- `server/src/routes.ts`, `server/src/realtime.ts`, `server/src/index.ts`
- `src/lib/prediction.ts`, `src/lib/prediction.test.ts` (rewritten), `src/lib/types.ts`,
  `src/lib/database.types.ts`, `src/lib/validation.ts`, `src/lib/errors.ts`
- `src/data/predictions.ts`, `src/data/realtime.ts`
- `src/components/ui/Segmented.tsx`
- `src/components/prediction/VoteOption.tsx`, `VoteOption.test.tsx` (rewritten, not deleted),
  `ParticipationThreshold.tsx`, `PredictionCard.tsx`, `CreatePredictionSheet.tsx`
- `src/routes/PredictionDetail.tsx`, `src/routes/History.tsx`, `src/routes/Landing.tsx`
- `src/components/layout/GroupShell.tsx`
- `src/App.tsx`
- `index.html`
- `deploy/Caddyfile`
- `integration/flow.test.ts` (rewrite of the one flagged block, not deleted),
  `integration/grants.test.ts`, `integration/realtime.test.ts`

### Deliberately untouched

- `supabase/migrations/**` (dead mirror, per proposal — `rules.archive` divergence warning expected/accepted)
- `db/migrations/000_*`–`500_*` (edited only via new additive `600_*` files, per migration policy)

## Deviations from Design

1. **`finalize_predictions` step 4 (close-request quorum) SQL bug found and fixed during GREEN.**
   `design.md` §C's own example used a `LATERAL` subquery inside an `UPDATE ... FROM` that read the
   UPDATE's own target table (`p.id`, `p.group_id`). Postgres rejects this
   (`invalid reference to FROM-clause entry for table "p"`, error 42P10): a `LATERAL` item in an
   `UPDATE`'s `FROM` list cannot see the target relation, only earlier `FROM` items. Fixed by replacing the
   `LATERAL` with two correlated scalar subqueries (one in `SET`, one in `WHERE`) — slightly more repetitive
   SQL text, identical cost characteristics (still gated by `close_request_count > 0`). Caught immediately by
   running `npm run db:reset`, before any test ran against it.
2. **`PredictionDetail.tsx`'s NULL-`closes_at` UI is not covered by a full component render test.**
   Fully mocking `usePrediction`, `useMembers`, `useCastVote`, `useRequestClose`,
   `useWithdrawCloseRequest`, `usePredictionRealtime`, `useAddOption`, `useCancelPrediction`,
   `usePredictionScores`, `useVoteTimeline`, `useAuth`, and router context would need 8+ mocks, which
   strict-tdd's Mock Hygiene Rule flags as "testing at the wrong layer." Coverage for the underlying
   conditional logic lives in `src/lib/prediction.test.ts` (`closesAtMs`, `effectiveStatus`,
   `isOpenForVoting` all NULL-safe and tested), and the same conditional pattern (`closes_at !== null`) is
   verified end-to-end at the component level on `PredictionCard.tsx`, which has no internal data-fetching
   hooks and was testable with 2 legitimate providers (QueryClient, Toast). `PredictionDetail.tsx` compiles
   cleanly under `tsc` with the new nullable `closes_at` type, which is the strongest available signal short
   of a heavily-mocked render test.
3. **Qualification-quorum preset labels (design §G: "Pocos 30% / La mitad 50% / Casi todos 80%") vs. the
   settled default (60%, per the orchestrator's explicit ruling).** `design.md` itself flags this exact
   mismatch as an open, unsettled question ("Default `qualification_percent = 60`... are proposed, not
   settled by the owner"). The orchestrator's ruling settled the *numeric* defaults (60/50) but not the
   preset button scale. I kept the design's exact preset labels/values (30/50/80) unchanged and set the
   default field value to 60 as instructed — the practical effect is that a freshly-opened sheet shows no
   preset visually highlighted until the user taps one (the underlying value is still correctly 60). This is
   cosmetic, not functional: the submitted value is always correct and within `[1,100]`.
4. **`README.md`'s "El umbral no se puede configurar hacia abajo" section (line ~478) still describes the
   old fixed `minimum_participants` behavior.** Out of scope per `tasks.md` (no README task listed);
   flagged here rather than silently left inconsistent. Same for the "los grupos son privados y llevan
   `noindex`" line near the top of the "Decisiones" section, now only partially true (`/` and `/entrar` are
   indexable). Both are documentation-only, zero runtime effect.
5. **`deploy/Caddyfile`** still targets a pre-Express-migration architecture (Kong/Supabase upstream,
   `cantado.tudominio.com` domain) predating the "Supabase replaced" commit referenced in
   `openspec/config.yaml`. I only touched the exact directive task 8.6 named (mirroring the indexing
   allowlist next to the existing `X-Robots-Tag` header), and did not attempt a broader modernization of
   this file — that would be well outside the 47 assigned tasks.

## Issues Found

- None blocking. All four gate commands are green with fresh output captured immediately before this
  report was written (see Final Gate above, and the `npm run db:reset` run that preceded the final
  `test:integration` pass).

## Non-Negotiables Checklist (from the orchestrator's explicit list)

- [x] `drop function if exists public.create_prediction(<exact 13-arg list>)` precedes `create or replace`
      (`db/migrations/610_functions.sql`), with an integration test asserting exactly one `pg_proc` row
      (`integration/prediction-qualification.test.ts`).
- [x] `grant execute on function public.required_participants(...)` (and `required_close_requests`,
      `request_close`, `withdraw_close_request`) `to authenticated` — `db/migrations/620_rls_and_grants.sql`,
      verified callable by `integration/prediction-closing.test.ts`.
- [x] `closed_at` column added; `score_prediction` fixed to
      `coalesce(closes_at, closed_at, resolved_at, now())`, with an integration test proving the earliness
      multiplier is NOT 1.0 for every voter on an open-ended prediction.
- [x] `VoteOption.test.tsx:39-56` rewritten (not deleted) — staging-only assertion + separate confirm-fires
      assertion + `aria-checked` follows staged intent.
- [x] `feedRank`/`sortFeed` in `src/lib/prediction.ts:232,247` are NULL-safe (`closesAtMs()` helper), with
      unit tests proving no throw and correct ordering for `closes_at: null`.
- [x] Server/client indexing allowlist drift test (`src/lib/indexing.test.ts`).
- [x] `qualification_percent` backfilled for pre-existing `proposed`/`active` rows, with an integration test
      proving a 3-member-group row keeps its effective requirement and a 2-member-group row becomes
      qualifiable.
- [x] `Landing.tsx:148-152` and its "48 horas… tres personas" copy rewritten against live values; hardcoded
      `3` at `CreatePredictionSheet.tsx:125`/`:164` replaced with computed requirement text.
- [x] `request_close`/`withdraw_close_request` registered in `db/rpc-functions.json` with correct casts and
      granted to `authenticated`.
- [x] `integration/flow.test.ts:209-221` rewritten (not deleted) — no longer asserts the buggy
      `greatest(3,…)` clamp.

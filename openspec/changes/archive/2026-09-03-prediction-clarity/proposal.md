# Proposal: Prediction Clarity

## Intent

Group predictions are hard to read and easy to get wrong. Eight owner-reported problems, all evidence-backed: the site is fully `noindex` so it cannot be found at all; the "votaron 2 de 3" denominator is a hidden constant, not a real quorum; a single tap casts an irreversible vote; a closing date is mandatory even when nobody knows when the answer arrives; most create-prediction settings are unexplained; two visibility settings look identical. Two are real defects: `greatest(3, …)` makes every prediction in a 2-member group expire unqualified, and `votes_visibility = 'visible'` has no observable effect because the client never reads it.

## Scope

### In Scope

| # | Deliverable |
|---|---|
| 1 | Path-based selective indexing: `/` and `/entrar` indexable; `/g/*`, `/join/*`, `/crear-grupo` stay `noindex, nofollow`. Authoritative in `server/src/index.ts`, mirrored in `deploy/Caddyfile`, plus per-route client meta, `public/robots.txt`, canonical + Open Graph on the landing. |
| 2 | Qualification quorum: percentage of live group members, floor 1, hard-capped at the current member count. Replaces the hidden `minimum_participants = 3`. Progress renders against the live member count. |
| 3 | Two-step voting: tap stages a selection, an explicit "Confirmar" commits. Applied to `PredictionDetail` **and** `PredictionCard`; existing optimistic rollback preserved. |
| 4 | Optional open-ended predictions (`closes_at` nullable) + collaborative early close via `prediction_close_requests` (table, RLS, request/withdraw RPCs, quorum, `finalize_predictions` and `src/lib/prediction.ts` NULL handling). |
| 5 | New accessible `HelpTip` (tap/click toggle, `aria-expanded`, `Escape`), wired via `FieldShell.trailing`/`hint` and a new `Segmented` help slot; short plain-Spanish `?` copy on every non-obvious setting. |
| 6 | Explain the evolutiva anchor ("las rondas se cuentan desde que la creás"), preview rounds-before-close, cross-validate interval against the window (Zod + DB), define evolutiva with no closing date. |
| 7 | Relabel results (numbers) vs votes (names), add `?` help to both, and fix the bug: add `canSeeVotes()` to `src/lib/prediction.ts` and gate the names block on it. |
| 8 | Surface `qualification_hours` as a real, explained field; surface the quorum from #2. |

### Out of Scope

- Public/shareable group pages or any change to who can read private data.
- Backfilling or reconciling `supabase/migrations/` (see Approach).
- Running `npm run test:e2e` (Playwright browsers unavailable). E2E specs are written, not executed.
- Any new option not backed by evidence in the current code.

## Capabilities

### New Capabilities

- `search-indexing`: which routes may be indexed, and where that decision is enforced.
- `prediction-qualification`: quorum definition, scaling, member-count cap, and displayed progress.
- `vote-confirmation`: staged selection and explicit commit on every voting surface.
- `prediction-closing`: optional closing date, close requests, quorum, and finalization.
- `prediction-visibility`: results (counts) vs votes (names), including `visible`.
- `prediction-settings-help`: which settings must be explained and how the help is exposed.

### Modified Capabilities

None — `openspec/specs/` contains no specs yet (only its README).

## Approach

**Indexing is default-deny.** The server keeps sending `noindex, nofollow` for every path and removes it only for an explicit allowlist (`/`, `/entrar`). A new route can never become indexable by accident. The `index.html` blanket meta is replaced by a per-route component; the server header remains authoritative and works without JS.

**Quorum replaces the magic 3.** A prediction stores a percentage; the requirement is computed as `greatest(1, least(member_count, ceil(member_count * pct / 100)))`. A percentage was chosen over an absolute number because the owner asked for a requirement that grows with the group; the `least(member_count, …)` cap is what actually fixes the 2-member bug, and it is the part that must never be dropped. The UI shows both the live denominator and the requirement.

**Early close cannot become a sniping tool.** Only a member who has already voted may request a close, and reaching quorum closes the prediction in the same transaction — no grace window in which a latecomer can vote knowing the outcome.

**Migrations: new files only.** `server/src/migrate.ts` records each applied filename in `public._migrations` and skips it forever after, so editing `100_schema.sql` or `200_functions.sql` in place would apply on a fresh `scripts/db-reset.mjs` (which drops and reapplies everything) but **never** on the deployed database — silent prod/dev divergence. All changes therefore go into new, higher-numbered, additive, idempotent-safe files (`600_*`). Functions must be re-declared there in full; where a signature changes, `drop function if exists` with the exact old argument list must precede `create or replace`, otherwise Postgres creates an overload instead of replacing. Every new or re-signed RPC is re-registered in `db/rpc-functions.json` with correct casts and `grant … to authenticated`.

**`supabase/migrations/` is left untouched.** No code path applies it: `migrate.ts` and `db-reset.mjs` both read only `db/migrations`, and the two sets are already out of sync since the Supabase→Express move. Editing it would produce SQL that is never executed and never tested. The `rules.archive` warning about the two directories diverging is expected here and is accepted deliberately.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `db/migrations/600_*.sql` | New | Nullable `closes_at`, quorum columns, `prediction_close_requests`, RLS, RPCs, `finalize_predictions`, `create_prediction` |
| `db/rpc-functions.json` | Modified | Register request/withdraw close + re-signed `create_prediction` |
| `server/src/index.ts` | Modified | Path-based `X-Robots-Tag` allowlist |
| `deploy/Caddyfile`, `public/robots.txt`, `index.html` | Modified/New | Mirror the allowlist, remove the blanket meta |
| `src/lib/prediction.ts` | Modified | NULL `closes_at` in `effectiveStatus`/`isOpenForVoting`/`feedRank`/`sortFeed`; add `canSeeVotes()` |
| `src/lib/validation.ts` | Modified | Optional close date, interval-vs-window cross-validation, quorum |
| `src/components/prediction/*` | Modified | Confirm step, threshold display, help copy, labels, names block |
| `src/components/ui/HelpTip.tsx`, `Field.tsx`, `Segmented.tsx` | New/Modified | Accessible help affordance and its slots |
| `src/routes/PredictionDetail.tsx`, `src/data/predictions.ts` | Modified | Confirm flow, remove hardcoded `3`, close requests |
| `src/components/SeoRobots.tsx` (or equiv.) | New | Per-route client meta |
| `src/**/__tests__`, `integration/` | Modified | `VoteOption.test.tsx` asserts the current one-tap behavior and must be rewritten |

## Delivery

**`size:exception` — accepted, not trimmed.** Honest estimate is **~1,800–2,400 changed lines**, well above the 800-line review budget. The eight items share the same SQL surface (`create_prediction`, `finalize_predictions`, the qualification columns) and the same form component; splitting them into slices would mean editing the same functions three times and shipping intermediate states where the quorum exists in SQL but not in the UI. One PR to `main`, per the session's `single-pr` strategy. Reviewers should read it in the order of the Scope table.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Privacy regression: a private route becomes indexable.** Top risk. | Med | Default-deny allowlist; server header authoritative and JS-independent; `robots.txt` disallows `/g/`, `/join/`, `/crear-grupo`; integration test asserts `noindex` on every non-allowlisted path, including unknown ones |
| Invite tokens leak via referrer or crawler | Low | `/join/*` stays `noindex, nofollow`; verify no token appears in canonical/OG tags |
| Nullable `closes_at` breaks feed sorting | Med | `feedRank:232` and `sortFeed:247` dereference it unconditionally today; unit tests for NULL ordering before the schema change (strict TDD) |
| `create_prediction` signature change silently creates an overload | Med | Explicit `drop function if exists` with the old argument list; integration test asserts exactly one overload |
| Existing rows lose qualification under the new quorum | Med | Additive columns with defaults derived from current `minimum_participants`; integration test on seeded pre-change rows |
| Two-step voting breaks optimistic rollback | Low | Keep the mutation identical; only the trigger moves. Rewrite `VoteOption.test.tsx` first |
| Regression in the 129 passing tests | Low | Full `typecheck + lint + test + test:integration` gate before and after each work unit |

## Rollback Plan

1. **Client/server:** revert the PR merge commit. Restores the blanket `noindex`, one-tap voting, and the old labels immediately; no data loss.
2. **Database:** the `600_*` migrations are additive only — no column or table is dropped, `minimum_participants` is retained. Reverting the code leaves the new columns unread and harmless. Deleting the `600_*` rows from `public._migrations` re-applies them on next boot, so the down path is: revert code first, drop `prediction_close_requests` and the new columns only if the revert is permanent.
3. **Indexing:** fastest single-point kill switch is restoring the unconditional `X-Robots-Tag` in `deploy/Caddyfile` and redeploying Caddy, without waiting for an app rebuild.

## Dependencies

- Dev Postgres up (`npm run db:start`, `npm run db:reset`) for `npm run test:integration`.
- No new runtime packages expected.

## Success Criteria

- [ ] `/` and `/entrar` return no `noindex`; every other path, including unknown ones, returns `noindex, nofollow` from the server without JS.
- [ ] `public/robots.txt` exists and disallows `/g/`, `/join/`, `/crear-grupo`.
- [ ] A prediction in a 2-member group can qualify; the requirement is never above the live member count.
- [ ] The visible denominator equals the live group member count, and the requirement is shown and explained separately.
- [ ] No voting surface commits on a single tap; committing still rolls back optimistically on error.
- [ ] A prediction can be created with no closing date, and closes only when the close-request quorum is met, by members who already voted.
- [ ] `votes_visibility = 'visible'` renders voter names before reveal, via `canSeeVotes()`.
- [ ] Every non-self-evident create-prediction setting, including `qualification_hours`, has a keyboard- and touch-accessible `?` explanation.
- [ ] The evolutiva interval is validated against the closing window and its round count is previewed.
- [ ] `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:integration` all green, with no test removed to make them pass.

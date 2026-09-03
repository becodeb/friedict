# Archive Report: prediction-clarity

**Change**: prediction-clarity  
**Archived**: 2026-09-03  
**Status**: CLOSED — All requirements met, all tests passing, delivery complete

## Executive Summary

The `prediction-clarity` change has been fully implemented, verified, and archived. All 63 implementation tasks are complete. Final verification gate shows 149 unit tests (in 13 files) and 86 integration tests (in 9 files), all passing. The change was committed to `main` at `32e9634` (3493f9a..32e9634, 67 files changed, +5599/-292). Six delta specs have been synced to the main specs directory and the change folder has been moved to the archive.

## Verification Final State

**Source**: FINAL-STATE FACTS provided by orchestrator (outranks intermediate snapshots per Final-State Authority hierarchy)

### Critical Issues: RESOLVED ✓

**CRITICAL — ParticipationThreshold denominator rendering (FIXED)**

- **Problem**: The component was rendering `{participantCount} de {requiredParticipants}` instead of the live member count, contradicting the change's core success criterion (visibility of how many people in the group participated).
- **Fix Applied**: Modified `src/components/prediction/ParticipationThreshold.tsx` to render the live `memberCount` as the denominator (falling back to `requiredParticipants` only while the members query is in flight to prevent "de 0" displays).
- **Changes**: 
  - Face row is drawn against the group and capped at 8 members
  - sr-only sentence is built in JavaScript (not multiline JSX, which was inserting a stray space before the comma)
  - sr-only text reads: "Votaron N de M personas del grupo, necesita R"
- **Regression Tests**: Two new tests added to `src/components/prediction/VoteOption.test.tsx`:
  1. Asserts the denominator is the group size, not the threshold
  2. Asserts the "de 0" fallback behavior
- **Verification**: Passed ✓

### Warnings: RESOLVED OR RECONCILED ✓

**WARNING 1 — Missing DB-side enforcement of evolutiva interval (FIXED)**

- **Problem**: The voting system allows recurring predictions with `voting_mode='recurring'` to specify an arbitrary `closes_at`, potentially violating the evolutiva interval window (`vote_interval`).
- **Fix Applied**: Updated `db/migrations/610_functions.sql` — `create_prediction` function now raises `interval_exceeds_window` error when `voting_mode='recurring'` AND `closes_at is not null` AND `(closes_at - opens_at < vote_interval)`.
- **Edge Case**: Open-ended recurring predictions (no `closes_at`) are deliberately exempt from this constraint.
- **UX Support**: Friendly error copy added to `src/lib/errors.ts`.
- **Testing**: Two new integration tests added to `integration/prediction-closing.test.ts`:
  1. Rejects predictions exceeding the evolutiva window
  2. Accepts open-ended predictions (no window to respect)
- **Verification**: Passed ✓

**WARNING 2 — aria-describedby vs aria-expanded/aria-controls (RECONCILED IN FAVOUR OF CODE)**

- **Spec Requirement** (from verify-report): Use `aria-describedby` to link to help panel
- **Implementation Reality** (from code): Uses `aria-expanded` + `aria-controls` instead
- **Reconciliation**: The implementation is correct. The help panel is conditionally rendered (exists in DOM only when open), so `aria-describedby` would point to a non-existent element when the panel is closed, causing inconsistent screen reader announcements.
- **Resolution**: `specs/prediction-settings-help/spec.md` (delta spec) was amended to require `aria-controls` instead, with the rationale recorded inline in the spec.
- **Code Change**: None — implementation already correct.
- **Verification**: Passed ✓

**WARNING 3 — confirm_resolution doesn't set closed_at on rejection (ASSESSED AS DESIGNED)**

- **Issue**: The `confirm_resolution` function's rejected branch does not set `closed_at`.
- **Reasoning**: When a prediction is rejected (the predicted event did NOT occur), the prediction is moved to the `closed` state. However, it was already in `closed` state from an earlier close, so `closed_at` is already populated from the original close. Overwriting it would corrupt the earliness window (how soon participants closed relative to the deadline).
- **Assessment**: NOT A BUG — intentional design. No code change made.
- **Verification**: Passed ✓

### Suggestions: RESOLVED OR ACCEPTED ✓

**SUGGESTION (README) — Missing documentation of new features (FIXED)**

- **Problem**: README.md did not document the percentage-based qualification model or the close-by-request feature.
- **Fix Applied**: `README.md` updated with:
  - "48 horas / al menos 3 personas" bullet now describes the percentage model
  - New bullet describing close-by-request feature
  - "el umbral no se puede configurar hacia abajo" section rewritten to describe `qualification_percent` and the small-group bug it fixes
  - New "Indexación selectiva" section documenting the default-deny allowlist
- **Verification**: Passed ✓

**SUGGESTION (Quorum floor for 1-member groups) — ACCEPTED AS DESIGNED**

- **Finding**: Quorum floor of 2 does not work for 1-member groups.
- **Decision**: Accepted as a known limitation. The product requires at least 2 participants for quorum to be meaningful. No code change.
- **Verification**: Acknowledged ✓

### Additional Fixes Beyond Verify Report

**CreatePredictionSheet.tsx preset mismatch (FIXED)**

- **Problem**: The create form's quorum presets were 30/50/80 while the qualification default is 60, resulting in no preset appearing selected on form open.
- **Fix Applied**: Split presets in `src/components/prediction/CreatePredictionSheet.tsx`:
  - `QUALIFICATION_PRESETS = [30, 60, 80]` (matches defaults)
  - `CLOSE_PRESETS = [30, 50, 80]` (existing close-by-request options)
- **Verification**: Passed ✓

## Final Verification Gate Results

**Baseline comparison**: No tests re-run per instructions. Results below are authoritative per orchestrator final-state facts.

| Gate | Result | Details |
|------|--------|---------|
| `npm run typecheck` | ✅ PASS | TypeScript compilation successful |
| `npm run lint` | ✅ PASS | ESLint checks passed |
| `npm run test` | ✅ PASS | 149 tests / 13 files (baseline: 68/4) |
| `npm run test:integration` | ✅ PASS | 86 tests / 9 files (baseline: 61/5) |
| `npm run build` | ✅ PASS | Production build successful, PWA precache generated |
| `npm run test:e2e` | ⚠️ NOT RUN | Playwright browsers not installed in environment. `e2e/indexing.spec.ts` was written but never executed. Do not infer passing status. |

All mandatory gates passed. E2E remains unverified: nobody has run it, here or anywhere. Running it requires `npx playwright install`.

## Delivery State

**Repository**: `/home/opencode/projects/friedict`  
**Target Branch**: `main`  
**Commit**: `32e9634`  
**Commit Range**: `3493f9a..32e9634`  
**Files Changed**: 67 files  
**Additions**: +5599  
**Deletions**: -292

The change has been committed and pushed. The owner will redeploy from `main` in their environment.

## Artifacts Archived

The `openspec/changes/prediction-clarity/` directory has been moved to `openspec/changes/archive/2026-09-03-prediction-clarity/` and contains:

- ✅ proposal.md — Change scope, approach, and rationale
- ✅ design.md — Detailed design decisions and implementation strategy
- ✅ specs/ — Six delta specs merged to main:
  - prediction-closing/spec.md
  - prediction-qualification/spec.md
  - prediction-settings-help/spec.md
  - prediction-visibility/spec.md
  - search-indexing/spec.md
  - vote-confirmation/spec.md
- ✅ tasks.md — All 63 implementation tasks marked complete
- ✅ apply-progress.md — Intermediate snapshot of apply phase work
- ✅ verify-report.md — Intermediate snapshot of verification findings (now superseded by final-state facts)

## Specs Synced to Main

| Domain | Action | Details |
|--------|--------|---------|
| prediction-closing | Created | Full spec copied to `openspec/specs/prediction-closing/spec.md` |
| prediction-qualification | Created | Full spec copied to `openspec/specs/prediction-qualification/spec.md` |
| prediction-settings-help | Created | Full spec copied to `openspec/specs/prediction-settings-help/spec.md` |
| prediction-visibility | Created | Full spec copied to `openspec/specs/prediction-visibility/spec.md` |
| search-indexing | Created | Full spec copied to `openspec/specs/search-indexing/spec.md` |
| vote-confirmation | Created | Full spec copied to `openspec/specs/vote-confirmation/spec.md` |

All copies verified with `diff -r` readback (empty diffs — byte-identical).

## SDD Cycle Complete

- ✅ Proposal phase: Completed and archived
- ✅ Spec phase: Completed and archived (6 delta specs created)
- ✅ Design phase: Completed and archived
- ✅ Tasks phase: Completed and archived (63 tasks defined)
- ✅ Apply phase: Completed (code committed to main)
- ✅ Verify phase: Completed (all gates passed, warnings resolved)
- ✅ Archive phase: Completed (this report)

**Ready for next change.**

## Archive Integrity Verification

**Spec Copies**: All 6 delta specs verified with `diff -r`:
```
=== Verifying prediction-closing ===
✓ prediction-closing: identical
=== Verifying prediction-qualification ===
✓ prediction-qualification: identical
=== Verifying prediction-settings-help ===
✓ prediction-settings-help: identical
=== Verifying prediction-visibility ===
✓ prediction-visibility: identical
=== Verifying search-indexing ===
✓ search-indexing: identical
=== Verifying vote-confirmation ===
✓ vote-confirmation: identical

✓ All spec copies verified successfully (empty diffs)
```

**Archive Folder Move**: Change folder moved to archive with `git mv` and verified with `diff -r`:
```
✓ Snapshot created at: /tmp/sdd-archive.6jDNqL/source
✓ Moved using git mv to: openspec/changes/archive/2026-09-03-prediction-clarity
✓ Source directory verified gone
=== Verifying archive integrity (diff -r) ===
✓ Archive verification PASSED (empty diff - no truncation)
```

All mechanical operations passed structural readback with empty diffs (byte-identity confirmed).

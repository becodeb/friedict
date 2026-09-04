# Prediction Scoring Specification (delta)

## Purpose

A prediction that ran for a year (*quién se casa primero*) should be worth more than one that ran
for an evening (*quién llega tarde*). Today every prediction is worth the same, because
`score_prediction` passes a hardcoded base of `100` (`db/migrations/610_functions.sql:531`).

## ADDED Requirements

### Requirement: Points scale with the actual elapsed time, not the planned one

The base points MUST be scaled by a duration multiplier computed from `closed_at - opens_at` — the
time the prediction ACTUALLY ran — not from `closes_at - opens_at`.

#### Scenario: An open-ended prediction is still scored

- GIVEN a prediction created with `closes_at = NULL` that ran for 200 days before the group closed
  it by quorum
- WHEN it is scored
- THEN the duration multiplier is computed from `closed_at - opens_at`, because there never was a
  planned horizon to compute from

#### Scenario: A date-closed prediction is unsurprising

- GIVEN a prediction with a closing date that closed on that date
- WHEN it is scored
- THEN `closed_at - opens_at` equals the planned window, so the multiplier is exactly what the
  create form previewed

#### Scenario: A prediction closed early scores for the time it actually ran

- GIVEN a prediction planned for a year that the group closed by quorum after a week
- WHEN it is scored
- THEN the multiplier reflects one week, not one year

### Requirement: The duration multiplier is logarithmic, floored at 1.0 and capped at 3.0

The multiplier MUST be `clamp(1 + 0.75 * log10(days), 1.0, 3.0)`, where `days` is the actual
elapsed time in days, floored at 1 so sub-day predictions clamp to exactly 1.0×. It MUST be rounded
to two decimals, matching how the existing multipliers are stored.

Nothing may become worth LESS than it is today: 1.0× is the floor and is the current behaviour.

#### Scenario: A one-evening prediction is worth exactly what it is worth today

- GIVEN a prediction that ran for four hours
- WHEN the multiplier is computed
- THEN it is 1.0, and the awarded points are identical to today's

#### Scenario: Known reference points

- GIVEN elapsed times of 1, 10, 100 and 365 days
- WHEN the multiplier is computed
- THEN it is approximately 1.0×, 1.75×, 2.5× and 2.9× respectively

#### Scenario: The cap holds

- GIVEN a prediction that ran for ten years
- WHEN the multiplier is computed
- THEN it is 3.0, never more
- Reason: linear scaling would make a year worth 365× an evening and turn the ranking into
  "whoever left something open longest"

#### Scenario: The existing multipliers are untouched

- GIVEN any prediction
- WHEN it is scored
- THEN the rarity, earliness and conviction multipliers are computed exactly as before; this
  change scales only the base

### Requirement: SQL and TypeScript stay byte-for-byte equivalent

`public.calculate_points` MUST remain `immutable` and MUST remain identical to
`calculatePoints()` in `src/lib/scoring.ts`. The duration multiplier MUST likewise exist in both,
and `integration/scoring-parity.test.ts` MUST be extended to cover the duration dimension over a
grid.

#### Scenario: Parity over the duration grid

- GIVEN a grid of elapsed times spanning sub-day, 1, 10, 100, 365 and 4000 days, including the
  clamp boundaries
- WHEN the SQL helper and the TypeScript mirror are compared
- THEN they return exactly the same value for every point in the grid

#### Scenario: `calculate_points` itself is unchanged

- GIVEN the existing parity grid over share, sample size, earliness and conviction
- WHEN it is run after this change
- THEN it still passes unmodified, because the scaling happens in the base argument and not in the
  formula

#### Scenario: The helper is immutable

- GIVEN the duration multiplier function
- WHEN its volatility is inspected in `pg_proc`
- THEN it is `immutable`, so it can be inlined and used in an index or a generated expression later

### Requirement: The person can see why a prediction was worth more

The duration multiplier MUST be stored on the score row alongside the existing three, and the
existing `explainScore` breakdown used by `PredictionDetail.tsx:506-523` MUST be extended to
include it. No second explanation path may be invented.

#### Scenario: The breakdown names the duration

- GIVEN a resolved prediction that ran for 100 days and a member who scored on it
- WHEN they open the prediction detail
- THEN the sentence explaining their points includes the duration multiplier and says in plain
  Spanish that it is because the prediction lasted that long

#### Scenario: The stored multiplier is what is shown

- GIVEN a score row
- WHEN the breakdown is rendered
- THEN it reads the persisted `duration_multiplier`, so the explanation always reconciles with the
  points that were actually awarded, even if the formula changes later

#### Scenario: The create form previews the reward

- GIVEN the create-prediction form
- WHEN a closing date is chosen
- THEN the form states approximately how much the prediction will be worth if it runs that long
- AND when the close mode is open-ended, it states that the longer it runs the more it is worth, up
  to the cap

#### Scenario: A 1.0× multiplier is not noise

- GIVEN a prediction that ran under a day, so the multiplier is exactly 1.0
- WHEN the breakdown is rendered
- THEN the duration factor is omitted from the sentence rather than shown as "× 1.00"

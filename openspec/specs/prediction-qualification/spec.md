# Prediction Qualification Specification

## Purpose

Replace the hidden fixed quorum (`minimum_participants` defaulting to a magic `3`, floored by `greatest(3, …)`) with a percentage of the live group member count, hard-capped at that same live count, so a prediction in any group size — including a 2-member group — can qualify.

## Requirements

### Requirement: Qualification requirement scales with and is capped by live membership

The system MUST compute the qualification requirement as `greatest(1, least(member_count, ceil(member_count * qualification_pct / 100)))`, evaluated against the group's CURRENT live member count, not a snapshot. The requirement MUST NEVER exceed the live member count.

#### Scenario: Two-member group can qualify (bug fix)

- GIVEN a group with exactly 2 members and a prediction with `qualification_pct = 60`
- WHEN the requirement is computed
- THEN required = `ceil(2 * 0.6) = 2`, capped at `member_count = 2` → required = 2
- AND once both members vote, the prediction qualifies

#### Scenario: Requirement rises as the group grows

- GIVEN a prediction created when the group had 2 members (`qualification_pct = 60`, required = 2)
- WHEN the group grows to 5 members before the prediction qualifies
- THEN the requirement recomputes live to `ceil(5 * 0.6) = 3`

#### Scenario: Floor of 1 applies when the percentage rounds to 0

- GIVEN a group with 1 member and `qualification_pct = 10`
- WHEN the requirement is computed
- THEN `ceil(1 * 0.10) = 1`, and the floor of 1 still yields required = 1 (never 0)

#### Scenario: Cap never exceeds live member count

- GIVEN a group with 4 members and `qualification_pct = 100`
- WHEN the requirement is computed
- THEN required = 4, never greater than the live member count even if members later leave and count drops

### Requirement: Displayed progress uses the live denominator

The UI MUST show the current live member count as the denominator and the computed requirement as a separately labeled number — never the old hardcoded `3`.

#### Scenario: Progress reflects live group size

- GIVEN a 2-member group where both members voted
- WHEN qualification progress is rendered
- THEN it shows "2 de 2", not a stale "2 de 3"

#### Scenario: Landing demo copy matches the new model

- GIVEN the landing page's example `ParticipationThreshold`
- WHEN rendered
- THEN its hardcoded props and body copy ("si en 48 horas no eligieron al menos tres personas") are updated to describe a percentage-of-group quorum, not a fixed "three people"

### Requirement: Pre-existing rows keep their qualification status across the migration

Additive quorum columns MUST be backfilled with defaults derived from each row's existing `minimum_participants`, so no already-qualified prediction becomes unqualified, and previously-unqualifiable rows in small groups become qualifiable going forward.

#### Scenario: Already-qualified row stays qualified

- GIVEN a pre-existing row with `minimum_participants = 3`, `participant_count = 3` (qualified under old rules)
- WHEN the `600_*` migration backfills `qualification_pct`/cap columns from the old value
- THEN `hasQualified` still evaluates true for that row after migration

#### Scenario: Previously-stuck 2-member group row becomes qualifiable

- GIVEN a pre-existing row with `minimum_participants = 3` in a group that only ever had 2 members (never qualifiable under the old rule)
- WHEN the migration derives its `qualification_pct` and the live-member-count cap now applies
- THEN the computed requirement is `<= 2`, so the row can qualify going forward

### Requirement: `qualification_hours` is surfaced as a real, explained field

The create-prediction form MUST expose `qualification_hours` as a visible, editable field (not a hidden default), paired with a help affordance (see `prediction-settings-help`).

#### Scenario: qualification_hours is visible on create

- GIVEN the create-prediction form
- WHEN rendered
- THEN a `qualification_hours` input is present, showing its current/default value, not silently applied

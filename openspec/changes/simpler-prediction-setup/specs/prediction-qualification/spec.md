# Prediction Qualification Specification (delta)

> This delta partially reverses `2026-09-03-prediction-clarity`. That change was right that a
> hidden `minimum_participants = 3` was a bug and right that a percentage of live membership
> beats a magic constant. It was wrong that the knob belongs on the prediction, and wrong that a
> prediction can fail an exam it never signed up for.

## MODIFIED Requirements

### Requirement: Qualification requirement scales with and is capped by live membership

The system MUST compute the qualification requirement as `greatest(1, least(member_count,
ceil(member_count * qualification_pct / 100)))`, evaluated against the group's CURRENT live
member count, not a snapshot. The requirement MUST NEVER exceed the live member count.
`qualification_pct` MUST be read from `groups.qualification_percent`, NOT from a per-prediction
column — `predictions.qualification_percent` is dropped by this change. The requirement is only
consulted when `groups.qualification_enabled` is true.

#### Scenario: Two-member group can qualify (bug fix, preserved)

- GIVEN a group with exactly 2 members, `qualification_enabled = true` and
  `qualification_percent = 60`
- WHEN the requirement is computed
- THEN required = `ceil(2 * 0.6) = 2`, capped at `member_count = 2` → required = 2
- AND once both members vote, the prediction qualifies

#### Scenario: Requirement rises as the group grows

- GIVEN a prediction created when the group had 2 members (`qualification_percent = 60`,
  required = 2)
- WHEN the group grows to 5 members before the prediction qualifies
- THEN the requirement recomputes live to `ceil(5 * 0.6) = 3`

#### Scenario: Floor of 1 applies when the percentage rounds to 0

- GIVEN a group with 1 member and `qualification_percent = 10`
- WHEN the requirement is computed
- THEN `ceil(1 * 0.10) = 1`, and the floor of 1 still yields required = 1 (never 0)

#### Scenario: Cap never exceeds live member count

- GIVEN a group with 4 members and `qualification_percent = 100`
- WHEN the requirement is computed
- THEN required = 4, never greater than the live member count even if members later leave and
  count drops

#### Scenario: Changing the group percentage changes every open prediction at once

- GIVEN a 10-member group with `qualification_percent = 30` and three predictions in `proposed`
- WHEN an admin raises the percentage to 60
- THEN all three predictions immediately require 6 participants, with no write to any prediction
  row

### Requirement: Displayed progress uses the live denominator

The UI MUST show the current live member count as the denominator and the computed requirement
as a separately labeled number — never a hardcoded constant. The progress widget MUST only be
rendered for a prediction whose status is `proposed`, which — since a prediction can only be
born `proposed` when its group has `qualification_enabled = true` — is exactly the set of
predictions for which a threshold exists.

#### Scenario: Progress reflects live group size

- GIVEN a 2-member group where both members voted
- WHEN qualification progress is rendered
- THEN it shows "2 de 2", not a stale "2 de 3"

#### Scenario: No progress widget when qualification is off

- GIVEN a group with `qualification_enabled = false`
- WHEN any of its predictions is rendered in the feed or on the detail screen
- THEN no `ParticipationThreshold` widget and no "En prueba" badge appear anywhere

#### Scenario: Landing demo copy matches the opt-in model

- GIVEN the landing page's example `ParticipationThreshold` and its surrounding card copy
- WHEN rendered
- THEN the copy describes qualification as an **opt-in group setting that is off by default**,
  states that a prediction never expires, and does not promise a fixed number of people or a
  time limit

## REMOVED Requirements

### Requirement: `qualification_hours` is surfaced as a real, explained field

(Reason: nothing expires any more. The owner's central objection is that they want to leave a
prediction that might resolve in a year without caring whether people take two months or a year
to answer. A visible field for a deadline that no longer exists is worse than a hidden one.)

(Migration: `predictions.qualification_deadline` becomes nullable and stops being written.
Existing non-null values are kept as an audit trail and never read again. The
`finalize_predictions` expire-by-deadline step is deleted, so no code path produces `expired`
from this point on. `create_prediction` and `create_prediction_from_template` both drop their
`p_qualification_hours` parameter. Rows already in `expired` stay `expired`; nothing revives
them.)

### Requirement: Pre-existing rows keep their qualification status across the migration

(Reason: superseded. That requirement described the additive `600_*` backfill from
`minimum_participants` into `predictions.qualification_percent`. This change **drops** that
column, so the requirement no longer describes anything that exists.)

(Migration: every group starts at the new defaults — `qualification_enabled = false`,
`qualification_percent = 60` — and every prediction still in `proposed` is promoted to `active`
by `710_functions.sql`, because with the toggle off there is no gate left to pass. Per-prediction
quorum tuning is lost: any prediction that carried a non-default `qualification_percent` now
follows its group's single setting.)

## ADDED Requirements

### Requirement: A prediction never expires

No code path may transition a prediction to `expired`. `finalize_predictions` MUST NOT contain
an expire-by-deadline step, and the client's `effectiveStatus` MUST NOT derive `expired` from
`qualification_deadline`. The `expired` enum value and its labels MUST be kept so pre-existing
rows still render correctly.

#### Scenario: A prediction in prueba with no votes stays in prueba forever

- GIVEN a group with `qualification_enabled = true` and a prediction in `proposed` with 0
  participants
- WHEN a year of clock time passes and `finalize_predictions` runs repeatedly
- THEN its status is still `proposed`, never `expired`

#### Scenario: `effectiveStatus` never returns `expired` for a live row

- GIVEN a `proposed` prediction with any `qualification_deadline`, including one long past
- WHEN `effectiveStatus` is evaluated at any `now`
- THEN it returns `proposed`, `active` or `closed` — never `expired`

#### Scenario: A pre-existing expired row still renders

- GIVEN a row whose status is already `expired` from before this change
- WHEN it is rendered
- THEN `effectiveStatus` returns `expired` unchanged and the "No juntó gente" label still shows

### Requirement: Predictions are born open unless the group opted in

`create_prediction` MUST set `status = 'active'` when `groups.qualification_enabled` is false
and `status = 'proposed'` when it is true. The status MUST NOT be derivable from any client
parameter.

#### Scenario: Default group, prediction is immediately open

- GIVEN a group that never touched its settings
- WHEN a member creates a prediction
- THEN its status is `active` and it is votable straight away

#### Scenario: The client cannot force the status

- GIVEN a caller hitting the `create_prediction` RPC directly
- WHEN they attempt to pass a status or `is_default` argument
- THEN the call fails, because no such parameter exists in the signature

# Vote Confirmation Specification

## Purpose

Replace one-tap irreversible voting with a two-step stage-then-confirm flow, on every surface that lets a member vote, while preserving the existing optimistic-update/rollback contract.

## Requirements

### Requirement: Selecting an option only stages it

Tapping/clicking an option MUST update local staged-selection state and MUST NOT trigger any vote mutation or network call.

#### Scenario: Tap stages without committing

- GIVEN an open prediction with no staged selection
- WHEN the user taps option "Sí"
- THEN "Sí" becomes visually staged/selected
- AND no vote mutation is sent

#### Scenario: Changing the staged selection before confirming sends nothing

- GIVEN option "Sí" is staged
- WHEN the user taps option "No" before confirming
- THEN staging moves to "No"
- AND across the whole tap→re-tap sequence, zero vote mutations were sent

### Requirement: An explicit confirm control commits the staged vote

A distinct "Confirmar" control MUST be the only trigger that sends the vote mutation, and it MUST be present on every voting surface: the prediction detail screen and the feed card (`PredictionCard`).

#### Scenario: Confirm commits the staged selection

- GIVEN option "Sí" is staged on the detail screen
- WHEN the user activates "Confirmar"
- THEN exactly one vote mutation is sent for "Sí"
- AND the UI updates optimistically before server confirmation

#### Scenario: Confirm is available on the feed card

- GIVEN an open prediction card in the feed that the user has not voted on
- WHEN the user stages an option on the card
- THEN a "Confirmar" control appears on the card itself, without navigating to the detail screen

#### Scenario: No confirm control, no commit

- GIVEN a staged selection
- WHEN the user navigates away without activating "Confirmar"
- THEN no vote mutation was ever sent for that staging

### Requirement: Optimistic update and rollback are preserved

The confirm action MUST use the existing optimistic-update mutation and roll back to the prior state on server rejection, exactly as before this change — only the trigger moved from tap to confirm.

#### Scenario: Server rejection rolls back

- GIVEN the user confirms a vote and the server rejects it (e.g. prediction closed concurrently)
- WHEN the rejection is received
- THEN the UI reverts to its pre-confirm state and surfaces an error

### Requirement: A confirmed `recurring` vote stays locked for its cycle

Confirming a vote on a `recurring` (evolutiva) prediction MUST lock further changes for the current cycle, matching `voteAvailability`'s `cycle_used` reason, until `nextCycleAt`.

#### Scenario: Recurring vote locks after confirm

- GIVEN a `recurring` prediction with no vote yet for the current cycle
- WHEN the user stages and confirms an option
- THEN option controls become disabled for that cycle
- AND `voteAvailability` reports `canVote: false, reason: 'cycle_used'` with the correct `nextAt`

### Requirement: `VoteOption` no longer commits on select

`VoteOption`'s selection callback (`onSelect`) MUST only stage a choice; a separate callback/control MUST perform the commit. The prior one-tap-commits contract in `VoteOption.test.tsx:39-56` MUST be rewritten to assert staging-only on tap and commit-only-on-confirm — not deleted.

#### Scenario: Rewritten test asserts staging, not commit

- GIVEN the rewritten `VoteOption.test.tsx`
- WHEN a radio option is tapped
- THEN the test asserts the stage callback fired and the commit/mutation callback did NOT fire
- AND a separate test asserts the commit callback fires only when the confirm control activates

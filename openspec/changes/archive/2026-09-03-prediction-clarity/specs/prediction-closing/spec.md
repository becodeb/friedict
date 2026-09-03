# Prediction Closing Specification

## Purpose

Make `closes_at` optional, add a collaborative early-close request/quorum mechanism separate from the qualification quorum, and make date-dependent logic (`effectiveStatus`, `feedRank`, `sortFeed`) NULL-safe.

## Requirements

### Requirement: `closes_at` is optional at creation

The system MUST accept `closes_at = NULL` when creating a prediction (client validation and DB column both nullable).

#### Scenario: Create with no closing date

- GIVEN the create-prediction form with the closing-date field left empty
- WHEN submitted
- THEN the prediction is created with `closes_at = NULL` and no validation error

### Requirement: Time-based closing is skipped when `closes_at` is NULL

`effectiveStatus` MUST NOT auto-close a prediction by date when `closes_at` is NULL; it MUST remain open indefinitely until an explicit close-request quorum is reached or another terminal transition applies.

#### Scenario: Never auto-closes by date

- GIVEN a prediction with `closes_at = NULL`, status `active`
- WHEN `effectiveStatus` is evaluated at any `now`, including far in the future
- THEN it does not return `closed` due to a date comparison

#### Scenario: Evolutiva with no closing date keeps producing rounds

- GIVEN a `recurring` prediction with `closes_at = NULL`
- WHEN cycles elapse past several `nextCycleAt` boundaries
- THEN it keeps opening new rounds indefinitely — no round cap — until a close request reaches quorum

### Requirement: Feed ranking and sorting are NULL-safe for `closes_at`

`feedRank` (`src/lib/prediction.ts:232`) and `sortFeed` (`:247`) MUST NOT dereference `closes_at` unconditionally; a NULL `closes_at` MUST produce a defined, non-throwing rank and a deterministic sort position.

#### Scenario: feedRank does not throw on NULL closes_at

- GIVEN a prediction with `closes_at = NULL`, status `active`
- WHEN `feedRank` is called
- THEN it returns a number without throwing, and does not fall into the "closing within 24h" tier (treated as not-imminent)

#### Scenario: sortFeed orders NULL-closes_at predictions deterministically

- GIVEN two `active` predictions with equal `feedRank` tier, one with `closes_at = NULL` and one with a future date
- WHEN `sortFeed` orders them
- THEN the comparison does not throw, and the NULL one sorts consistently after dated ones within the same tier (defined tie-break, not `NaN`-driven)

### Requirement: A separate close-request quorum, floor 2, ends an open-ended or dated prediction early

`prediction_close_requests` MUST track one request per voting member. Reaching `close_quorum` (its own setting, independent of the qualification quorum, minimum 2) MUST close the prediction in the same transaction as the request that reaches it, with no grace window.

#### Scenario: Reaching close quorum closes immediately

- GIVEN `close_quorum = 2` and one existing close request from a member who voted
- WHEN a second member who has already voted submits a close request
- THEN the prediction transitions to `closed` in that same request's transaction

#### Scenario: Only a member who has voted may request a close

- GIVEN a group member who has NOT cast a vote on the prediction
- WHEN they call the request-close RPC
- THEN it is rejected and no request row is created

- Reason: prevents a forgetful member from casting a late vote once the outcome is effectively known.

#### Scenario: Withdraw a close request

- GIVEN a member has an active close request and the prediction is still below `close_quorum`
- WHEN they withdraw it
- THEN their request row is removed and the request count decreases; the prediction stays open

### Requirement: Evolutiva interval is validated against the closing window

When a closing date is set on a `recurring` prediction, the `vote_interval` MUST fit within `[opens_at, closes_at]`; both the client (Zod) and the DB MUST reject an interval that does not fit.

#### Scenario: Interval larger than the window is rejected client-side

- GIVEN evolutiva creation with `opens_at`..`closes_at` spanning 24h and `vote_interval` of 48h
- WHEN the form is validated
- THEN Zod validation fails with an explicit error before submit

#### Scenario: DB rejects the same case if client validation is bypassed

- GIVEN the same oversized interval sent directly to the create RPC
- WHEN the DB constraint evaluates it
- THEN the insert/update is rejected

#### Scenario: Rounds-before-close preview

- GIVEN a valid `opens_at`/`closes_at` window and `vote_interval`
- WHEN previewing the evolutiva settings
- THEN the UI shows the computed number of rounds before close (derived from the window and interval)

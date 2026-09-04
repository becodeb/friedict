# Prediction Closing Specification (delta)

## MODIFIED Requirements

### Requirement: A group-level close quorum, floor 1, ends an open-ended or dated prediction early

`prediction_close_requests` MUST track one request per voting member. The requirement MUST come
from `groups.close_request_quorum` — an absolute COUNT with an absolute floor of **1**, capped at
the live member count — NOT from a per-prediction percentage. `predictions.close_percent` is
dropped by this change. Reaching the requirement MUST close the prediction in the same
transaction as the request that reaches it, with no grace window.

#### Scenario: One request closes it when the group set the quorum to 1

- GIVEN `close_request_quorum = 1` and a member who has already voted
- WHEN they submit a close request
- THEN the prediction transitions to `closed` in that same request's transaction

#### Scenario: Reaching a higher quorum closes immediately

- GIVEN `close_request_quorum = 2` and one existing close request from a member who voted
- WHEN a second member who has already voted submits a close request
- THEN the prediction transitions to `closed` in that same request's transaction

#### Scenario: Only a member who has voted may request a close

- GIVEN a group member who has NOT cast a vote on the prediction
- WHEN they call the request-close RPC
- THEN it is rejected with `must_vote_first` and no request row is created

- Reason: prevents a forgetful member from casting a late vote once the outcome is effectively
  known.

#### Scenario: Withdraw a close request

- GIVEN a member has an active close request and the prediction is still below the requirement
- WHEN they withdraw it
- THEN their request row is removed and the request count decreases; the prediction stays open

#### Scenario: The requirement is capped at the live member count

- GIVEN a group of 2 members with `close_request_quorum = 5`
- WHEN the requirement is computed
- THEN it is 2, so two members can still close the prediction

#### Scenario: A departed member's request stops counting

- GIVEN a standing close request from someone who then leaves the group
- WHEN `finalize_predictions` re-evaluates the prediction
- THEN that request is not counted, because live membership is the authority and
  `predictions.close_request_count` is only a cheap gate

### Requirement: Evolutiva interval is validated against the closing window

When a closing date is set on a `recurring` prediction, the `vote_interval` MUST fit within
`[opens_at, closes_at]`; both the client (Zod) and the DB MUST reject an interval that does not
fit. With no closing date the interval is unbounded.

#### Scenario: Interval larger than the window is rejected client-side

- GIVEN evolutiva creation with `opens_at`..`closes_at` spanning 24h and `vote_interval` of 48h
- WHEN the form is validated
- THEN Zod validation fails with an explicit error before submit

#### Scenario: DB rejects the same case if client validation is bypassed

- GIVEN the same oversized interval sent directly to the create RPC
- WHEN the DB constraint evaluates it
- THEN the insert/update is rejected with `interval_exceeds_window`

#### Scenario: Rounds-before-close preview

- GIVEN a valid `opens_at`/`closes_at` window and `vote_interval`
- WHEN previewing the evolutiva settings
- THEN the UI shows the computed number of rounds before close (derived from the window and
  interval)

#### Scenario: Open-ended evolutiva has no round cap

- GIVEN a `recurring` prediction created with no closing date
- WHEN the form is validated and the RPC runs
- THEN any interval within the column's own sanity bounds is accepted, and rounds keep opening
  indefinitely until the close quorum is reached

## ADDED Requirements

### Requirement: The close requirement is delivered to the client, computed server-side

`PREDICTION_SELECT` MUST derive `close_required` from the prediction's group row and the live
member count, so no client ever computes it from a group setting it may not have loaded.

#### Scenario: `close_required` rides on the prediction row

- GIVEN a member reading the feed or a prediction detail
- WHEN the API returns a prediction
- THEN it carries `member_count`, `required_participants`, `close_required` and
  `my_close_request`, with `close_required` already capped at the live member count

#### Scenario: Changing the group quorum changes every open prediction's requirement

- GIVEN a group with three open-ended predictions and `close_request_quorum = 3`
- WHEN an admin lowers it to 1
- THEN the next read of any of those predictions reports `close_required = 1`, with no write to
  any prediction row

### Requirement: `closed_at` is set on every closing path

Every transition into `closed` MUST write `closed_at = now()`, because the duration multiplier in
`prediction-scoring` reads it as the actual end of the prediction.

#### Scenario: Closing by date sets `closed_at`

- GIVEN a prediction whose `closes_at` has passed
- WHEN `finalize_predictions` closes it
- THEN `closed_at` is non-null

#### Scenario: Closing by quorum sets `closed_at`

- GIVEN a close request that reaches the group quorum
- WHEN `request_close` closes the prediction
- THEN `closed_at` is non-null, set in that same transaction

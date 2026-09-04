# Vote Change Window Specification (delta)

## Purpose

Close a real exploit in the shipped product. `voting_mode = 'single'` currently lets anyone change
their vote until `closes_at` (`db/migrations/610_functions.sql:436-439`), so somebody who learns
the real answer before the close switches their vote and collects the points. A per-prediction
vote-change window, enforced in the database, makes the vote settle.

## ADDED Requirements

### Requirement: A vote-change window is stored per prediction and supports four values

`public.predictions` MUST carry `vote_change_window interval` (nullable) with
`check (vote_change_window is null or vote_change_window >= interval '0')` and a column default of
`interval '15 minutes'`. `NULL` means "editable until the prediction closes"; `interval '0'` means
"never editable". Any other non-negative interval is a real window. The four values the product
offers — until close, 1 day, 15 minutes, never — MUST be data in that column, not four branches in
code.

#### Scenario: NULL means editable until close

- GIVEN a `single` prediction with `vote_change_window = NULL`, still open
- WHEN a member who voted three days ago changes their vote
- THEN the change is accepted

#### Scenario: Zero means never editable

- GIVEN a `single` prediction with `vote_change_window = interval '0'`
- WHEN the member who already voted tries to change their vote in a later transaction
- THEN it is rejected with `vote_locked`

#### Scenario: A negative window cannot be stored

- GIVEN an attempt to store `vote_change_window = interval '-1 hour'`
- WHEN the write is evaluated
- THEN the CHECK constraint rejects it

#### Scenario: A fifth value needs no schema change

- GIVEN a future product decision to offer "1 hour"
- WHEN `interval '1 hour'` is stored
- THEN `cast_vote` enforces it correctly with no migration and no new branch

### Requirement: The window is anchored to the voter's own first cast, and cannot ratchet

`public.prediction_votes` MUST carry `first_cast_at timestamptz not null default now()`, written
once when the vote row is created and NEVER rewritten by the `on conflict … do update` branch of
`cast_vote`. The window MUST be evaluated as `now() <= first_cast_at + vote_change_window`.

The anchor MUST NOT be the prediction's creation time, and MUST NOT be `updated_at`.

#### Scenario: Re-voting inside the window does not extend it

- GIVEN a prediction with a 15-minute window and a member who voted at T
- WHEN they change their vote at T+14 minutes, and again at T+16 minutes
- THEN the change at T+14 is accepted, `first_cast_at` is still T, and the change at T+16 is
  rejected with `vote_locked`
- Reason: anchoring on `updated_at` would let anyone hold the window open forever by re-voting
  every 14 minutes

#### Scenario: Every voter gets the same window regardless of when they arrive

- GIVEN a prediction with a 1-day window, created a month ago
- WHEN somebody votes for the first time today
- THEN they have a full day to correct it
- Reason: anchoring to prediction creation would give early voters a long window and late voters
  none, which is unfair and cannot be explained in one sentence

#### Scenario: `first_cast_at` survives the upsert

- GIVEN a member who voted and then changed their vote inside the window
- WHEN the vote row is read
- THEN `first_cast_at` is unchanged and `updated_at` has moved

#### Scenario: Existing votes are backfilled from `created_at`

- GIVEN vote rows that predate this change
- WHEN the migration runs
- THEN their `first_cast_at` equals their `created_at`, so the window applies from when they
  actually voted

### Requirement: The lockout is enforced in `cast_vote`, not only in the UI

`public.cast_vote` MUST reject a vote change outside the window with `vote_locked` (`22023`),
before writing anything. The client MUST mirror the rule so the control is disabled and explained,
but the client is never the authority.

#### Scenario: The RPC rejects a late change even if the UI is bypassed

- GIVEN a prediction with a 15-minute window and a vote cast an hour ago
- WHEN the `cast_vote` RPC is called directly with a different option
- THEN it raises `vote_locked` and the stored `option_id` is unchanged

#### Scenario: A first vote is never locked

- GIVEN a prediction with `vote_change_window = interval '0'` and a member who has not voted
- WHEN they cast their first vote
- THEN it is accepted — the window governs changes, not the first cast

#### Scenario: The client mirrors the rule

- GIVEN a `single` prediction whose window has elapsed for the current user
- WHEN `voteAvailability` is evaluated
- THEN it reports `canVote: false` with reason `vote_locked`, the options are not selectable, and
  the copy explains that the vote is settled

#### Scenario: The copy stops promising unlimited changes

- GIVEN any surface that today says "Podés cambiarlo hasta el cierre"
  (`src/components/prediction/PredictionCard.tsx:267`, `src/routes/PredictionDetail.tsx:331`)
- WHEN the prediction has a finite window
- THEN the copy states the real window instead, e.g. "Tenés 15 minutos para corregir tu voto"
  and, once elapsed, "Tu voto quedó firme"

### Requirement: `recurring` predictions keep their hard per-cycle lock

A `recurring` prediction MUST continue to reject a second vote in the same cycle with
`cycle_vote_used`, independently of `vote_change_window`.

#### Scenario: The per-cycle lock is unchanged

- GIVEN a `recurring` prediction with any `vote_change_window`
- WHEN a member votes twice in the same cycle
- THEN the second attempt is rejected with `cycle_vote_used`

#### Scenario: A new cycle is a new vote, not a change

- GIVEN a `recurring` prediction whose interval has elapsed
- WHEN the member votes again
- THEN a new vote row is created for the new cycle with its own `first_cast_at`, and the window
  never blocks it

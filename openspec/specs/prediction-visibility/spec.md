# Prediction Visibility Specification

## Purpose

Clearly separate "results" (vote counts/percentages, `results_visibility`) from "votes" (who voted for what, `votes_visibility`), and fix the client-side defect where `votes_visibility = 'visible'` has no observable effect because `PredictionDetail.tsx:149` gates the names block on `revealed` alone and never consults visibility.

## Requirements

### Requirement: Voter names respect `votes_visibility`, not just reveal state

The client MUST render voter names when `can_see_votes()`'s logic is satisfied — `votes_visibility <> 'anonymous'` AND (`votes_visibility = 'visible'` OR the prediction is revealed, i.e. `status` in `closed`/`resolving`/`resolved`) — mirroring `db/migrations/300_rls.sql:75-93`. This MUST work even before reveal, not only after it.

#### Scenario: `visible` shows names before reveal (bug fix)

- GIVEN a prediction with `status = 'active'` (not revealed) and `votes_visibility = 'visible'`
- WHEN a group member views the detail screen
- THEN voter names are rendered next to their chosen option, even though the prediction has not closed

#### Scenario: `anonymous` never shows names, even after reveal

- GIVEN a prediction with `status = 'resolved'` (revealed) and `votes_visibility = 'anonymous'`
- WHEN viewed
- THEN no voter names are rendered, only counts/results per `results_visibility`

#### Scenario: `on_close` shows names only after reveal

- GIVEN a prediction with `votes_visibility = 'on_close'`
- WHEN viewed while `status = 'active'`
- THEN no names are shown
- WHEN viewed after `status` becomes `closed`
- THEN names are shown

### Requirement: `canSeeVotes()` mirrors the DB policy client-side

`src/lib/prediction.ts` MUST export `canSeeVotes(prediction, status)` implementing the same three-part rule as `public.can_see_votes()`, and `PredictionDetail.tsx` MUST gate the voter-names block on this function instead of `revealed` alone.

#### Scenario: canSeeVotes unit coverage

- GIVEN `{ votes_visibility: 'visible' }`, status `'active'`
- WHEN `canSeeVotes` is called
- THEN it returns `true`
- GIVEN `{ votes_visibility: 'anonymous' }`, status `'resolved'`
- WHEN called
- THEN it returns `false`
- GIVEN `{ votes_visibility: 'on_close' }`, status `'proposed'`
- WHEN called
- THEN it returns `false`

### Requirement: Results and votes settings are visually and semantically distinct

The create/edit UI MUST label and explain "quién votó qué" (votes) and "cuántos votos tiene cada opción" (results) as two separate, differently-worded settings, each with its own help affordance — they currently "look identical."

#### Scenario: Two distinct labeled controls

- GIVEN the prediction settings form
- WHEN rendered
- THEN a `results_visibility` control and a `votes_visibility` control are each labeled with plain-Spanish text that describes what each one reveals, and neither reuses the other's label text

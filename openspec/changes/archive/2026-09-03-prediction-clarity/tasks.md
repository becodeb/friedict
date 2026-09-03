# Tasks: Prediction Clarity

> Size note: this task list exceeds the usual 530-word budget on purpose, for the same reason `design.md`
> does — eight deliverables share one SQL surface and one form component, and the seven high-risk items the
> owner named (drop-before-replace, a missing grant, a NULL-earliness landmine, a test that must be rewritten
> not deleted, two NULL-unsafe functions, an allowlist-drift guard, a backfill) each need their own explicit,
> unambiguous task or they get silently got wrong in `sdd-apply`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,800–2,400 (per `design.md` Delivery section) |
| Session review budget | 800 lines, `size:exception` already recorded and accepted by the owner |
| 400-line budget risk | High |
| Chained PRs recommended | No — owner explicitly rejected chaining; wants one push to `main` |
| Suggested split | Single PR; work units below are review-reading order, not separate PRs |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units (review-reading order within the one PR)

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | DB: quorum, nullable `closes_at`, close requests, `create_prediction` re-sign | PR 1 (only) | `npm run test:integration` | Live dev Postgres, `npm run db:reset` | Revert PR; `600_*` files are additive-only, safe to leave unread |
| 2 | Server read path: `PREDICTION_SELECT` derived fields, robots allowlist | PR 1 (only) | `npm run test:integration` | Same DB + `npm run dev:server` | Revert PR; server falls back to old header/select |
| 3 | Client lib: NULL-safe `prediction.ts`, `canSeeVotes`, `indexing.ts`, validation | PR 1 (only) | `npm run test` | jsdom, no DB | Revert PR; pure functions, no persisted state |
| 4 | UI: `HelpTip`, two-step voting, close-request panel, form IA | PR 1 (only) | `npm run test` | jsdom, no DB | Revert PR; client-only |
| 5 | Static assets + landing demo copy | PR 1 (only) | `npm run test` | jsdom + manual `robots.txt` read | Revert PR |
| 6 | Full-suite gate | PR 1 (only) | `npm run typecheck && npm run lint && npm run test && npm run test:integration` | Live dev Postgres | N/A — verification only |

## Phase 1: Database Foundations (SQL first — nothing downstream compiles against it yet)

- [x] 1.1 RED — new `integration/prediction-qualification.test.ts`: 2-member group qualifies (cap = count), floor of 1, requirement never exceeds live count after a member leaves, requirement rises when a member joins. **Also assert `select count(*) from pg_proc where proname='create_prediction'` equals 1** (high-risk item 1).
- [x] 1.2 RED — rewrite `integration/flow.test.ts:209-221`: stop asserting the old `greatest(3,…)` clamp (`expect(rows[0]!.minimum_participants).toBe(3)`); assert the new `qualification_percent`/`required_participants` behavior instead. Rewritten, not deleted — this is itself the RED step.
- [x] 1.3 RED — integration test: `required_participants`/`required_close_requests`/`request_close`/`withdraw_close_request` are callable (not `permission denied`) by the `authenticated` role (high-risk item 2 — a missing grant 403s the whole read path).
- [x] 1.4 RED — integration test: close-request quorum closes in the *same transaction* as the request that meets it (status already `closed` on the RPC's own return); `must_vote_first` rejection for a non-voter; withdraw lowers the count and never reopens; a member leaving lowers the requirement and `finalize_predictions` closes the row.
- [x] 1.5 RED — integration test: seed a pre-existing `proposed`/`active` row with `minimum_participants = 3`; after backfill, `hasQualified` stays true where it was true, and a 2-member-group row becomes qualifiable (high-risk item 7).
- [x] 1.6 RED — integration test: `score_prediction` earliness on an open-ended (`closes_at = null`) prediction is **not** 1.0 for every voter (high-risk item 3 — `greatest()` ignores NULLs).
- [x] 1.7 GREEN — `db/migrations/600_quorum_and_open_close.sql`: add `qualification_percent`, `close_percent`, `close_request_count`, `closed_at` columns; backfill `qualification_percent` for pre-existing `proposed`/`active` rows per the design formula; drop/recreate `predictions_window` and `predictions_qualification_within_window` NULL-tolerant; `closes_at drop not null`; create `prediction_close_requests` (composite PK, index, `select`-only grant, RLS enabled); create `required_participants`, `required_close_requests`, `group_member_count`.
- [x] 1.8 GREEN — `db/migrations/610_functions.sql`, opening with **`drop function if exists public.create_prediction(uuid, text, text[], timestamptz, text, public.option_source, public.voting_mode, interval, boolean, public.results_visibility, public.votes_visibility, smallint, integer)` before any `create or replace`** (high-risk item 1). Re-declare `refresh_prediction_counts`, `finalize_predictions` (counts CTE + new step 4 close-on-quorum), `create_prediction` (new 13-arg signature, `p_qualification_percent`/`p_close_percent` replace `p_minimum_participants`), `cast_vote`, `add_prediction_option`, `score_prediction` (fix: `v_close := coalesce(closes_at, closed_at, resolved_at, now())`), `notify_change` (emits `required_participants`). New `request_close`, `withdraw_close_request`.
- [x] 1.9 GREEN — `db/migrations/620_rls_and_grants.sql`: RLS `prediction_close_requests_select_own_or_visible`; **`grant execute on function public.required_participants(...), public.required_close_requests(...), public.request_close(uuid), public.withdraw_close_request(uuid), public.create_prediction(new 14-arg signature) to authenticated`** (high-risk item 2 — dropping a function also drops its grant); `revoke execute on function public.group_member_count(uuid) from public, anon, authenticated`.
- [x] 1.10 GREEN — `db/rpc-functions.json`: register `request_close`, `withdraw_close_request`; replace `create_prediction.params.p_minimum_participants` with `p_qualification_percent`/`p_close_percent`.
- [x] 1.11 `npm run db:reset && npm run test:integration` — 1.1–1.6 all GREEN. `supabase/migrations/` left untouched (deliberate, per proposal).

## Phase 2: Server Read Path

- [x] 2.1 RED — integration test: `GET` a prediction row includes `member_count`, `required_participants`, `close_required`, `my_close_request`.
- [x] 2.2 GREEN — `server/src/routes.ts` `PREDICTION_SELECT` (~L35-75): lateral join on `group_members` + the 4 derived fields.
- [x] 2.3 GREEN — `server/src/realtime.ts` (~L33): event shape emits `required_participants`, not `minimum_participants`.
- [x] 2.4 RED — integration test on `server/src/index.ts`: `/g/x`, `/join/tok`, `/crear-grupo`, `/assets/*`, and an unknown path all send `X-Robots-Tag: noindex, nofollow`; `/` and `/entrar` do not.
- [x] 2.5 GREEN — new `server/src/robots.ts` (allowlist + helper); `server/src/index.ts:79,89` use it instead of the two unconditional writes.

## Phase 3: Shared Client Logic

- [x] 3.1 RED — `src/lib/prediction.test.ts`: `feedRank` (`:232`) does not throw and does not rank an open-ended active prediction as "closing within 24h" when `closes_at` is null (high-risk item 5).
- [x] 3.2 RED — same file: `sortFeed` (`:247`) does not throw and sorts null-`closes_at` predictions deterministically last within their rank tier (high-risk item 5).
- [x] 3.3 RED — `effectiveStatus`/`isOpenForVoting` with `closes_at: null` never auto-close by date, at any `now`.
- [x] 3.4 RED — `canSeeVotes()` truth table: `visible`×`active`→true, `anonymous`×`resolved`→false, `on_close`×`proposed`→false.
- [x] 3.5 RED — `StatusInput`/qualification helpers at member counts 1, 2, 3, 7 (2-member group qualifies).
- [x] 3.6 GREEN — `src/lib/database.types.ts`: nullable `closes_at`; new columns; new `create_prediction` RPC args.
- [x] 3.7 GREEN — `src/lib/types.ts`: `Prediction` gains `member_count`, `required_participants`, `close_required`, `my_close_request`.
- [x] 3.8 GREEN — `src/lib/prediction.ts`: `StatusInput` requires `required_participants` (no optional fallback — an optional field would reintroduce the hidden-3 bug); NULL-guard `effectiveStatus`/`isOpenForVoting`; fix `feedRank:232` (`closesIn = closes_at === null ? Infinity : …`) and `sortFeed:247` (`closesAtMs()` helper, null → `Infinity`) (high-risk item 5); add `canSeeVotes(prediction, status)`.
- [x] 3.9 GREEN — new `src/lib/indexing.ts`: `INDEXABLE_PATHS` set, `robotsFor(pathname)`, default-deny, single-trailing-slash-only normalization, no case folding, no prefix matching.
- [x] 3.10 RED — drift guard test (unit): `readFileSync` both `src/lib/indexing.ts` and `server/src/robots.ts`, assert the same literal allowlist (mirrors the existing `db/rpc-functions.json` drift technique in `integration/helpers.ts`) (high-risk item 6).
- [x] 3.11 GREEN — reconcile 2.5/3.9 allowlists so 3.10 passes.
- [x] 3.12 RED — `src/lib/validation.ts` tests: interval-vs-window rejected when `closeMode==='date'` and the window is too small; accepted (unbounded) when `closeMode==='open'`.
- [x] 3.13 GREEN — `src/lib/validation.ts`: `closeMode: z.enum(['date','open'])`; `closesAt` required only when dated; `qualificationPercent`/`closePercent` bounded 1–100; interval-vs-window cross-validation.
- [x] 3.14 GREEN — `src/lib/errors.ts`: add `must_vote_first`.

## Phase 4: Client Data Layer

- [x] 4.1 GREEN — `src/data/predictions.ts`: drop `p_minimum_participants: 3`; send `qualificationPercent`/`closePercent` and optional `closesAt`; add `useRequestClose`/`useWithdrawCloseRequest`. `useCastVote`'s mutation body stays byte-identical — only its call site moves in Phase 6.
- [x] 4.2 GREEN — `src/components/layout/GroupShell.tsx` (~L64) toast reads `required_participants`.
- [x] 4.3 GREEN — `src/routes/History.tsx` (~L87-88,144): `resolved_at ?? closed_at ?? closes_at ?? created_at`.

## Phase 5: Help Affordance

- [x] 5.1 RED — `src/components/ui/HelpTip.test.tsx`: trigger is a real `<button>` reachable via Tab; toggles on click/tap; `Enter`/`Space` opens; `Escape` closes and returns focus to the trigger; outside `pointerdown` closes; `aria-expanded` flips; panel is `role="note"` and not a focus trap.
- [x] 5.2 GREEN — new `src/components/ui/HelpTip.tsx` per `design.md` §E (`aria-expanded` + `aria-controls`, sibling `role="note"` panel).
- [x] 5.3 RED — `Segmented` renders its new `help` node inside the `<legend>` row.
- [x] 5.4 GREEN — `src/components/ui/Segmented.tsx`: optional `help?: ReactNode` prop.

## Phase 6: Two-Step Voting

- [x] 6.1 RED — **rewrite `src/components/prediction/VoteOption.test.tsx:39-56`** (currently `'avisa el voto al tocarla'`, asserting one-tap commit): replace with a staging-only assertion on tap (stage callback fires, commit does not) plus a separate test asserting commit fires only on confirm, and `aria-checked` follows staged intent. **Rewritten, never deleted** (high-risk item 4).
- [x] 6.2 GREEN — `src/components/prediction/VoteOption.tsx`: new `staged` prop, `data-staged` attribute, `aria-checked={staged ? true : selected}`, `data-committed` + sr-only "tu voto guardado" suffix.
- [x] 6.3 RED — `ParticipationThreshold` test: renamed `requiredParticipants`/new `memberCount` props render 2 filled faces in a 2-member group.
- [x] 6.4 GREEN — `src/components/prediction/ParticipationThreshold.tsx`: `minimumParticipants` → `requiredParticipants`, add `memberCount`, cap the face row at `requiredParticipants`.
- [x] 6.5 GREEN — `src/routes/PredictionDetail.tsx`: staged state + `voteKey` reset pattern (design §D); "Confirmar"/"Cambiar mi voto" button; `role="status"` announcement; move `castVote.mutate(...)` from `onSelect` into the confirm handler; NULL `closes_at` guards (`Countdown` only when non-null, else "sin fecha de cierre" sticker + close-request progress); voter-names block gated on `canSeeVotes()` instead of `revealed` alone.
- [x] 6.6 GREEN — `src/components/prediction/PredictionCard.tsx`: same staging + `size="sm"` Confirm button in the footer, mounted only while `staged !== null`; NULL `closes_at` guard.
- [x] 6.7 Regression: `npm run test:integration` — existing `cast_vote` assertions in `integration/flow.test.ts` still pass unmodified.

## Phase 7: Prediction Closing UI

- [x] 7.1 RED — unit test: `PredictionDetail`/`PredictionCard` render no `Countdown` when `closes_at` is null.
- [x] 7.2 GREEN — wire `useRequestClose`/`useWithdrawCloseRequest` into `PredictionDetail.tsx`'s close-request panel (request/withdraw buttons, progress vs. `close_required`).
- [x] 7.3 RED — unit test: rounds-before-close preview value derived from window/interval.
- [x] 7.4 GREEN — `CreatePredictionSheet.tsx` Zone 2: `Segmented` "¿Cuándo cierra?" (`Con fecha` / `Cuando lo pida el grupo`); `datetime-local` only when dated; close-quorum `Segmented` only when open-ended.
- [x] 7.5 GREEN — `CreatePredictionSheet.tsx` Zone 3: rounds-before-close preview line for evolutiva.
- [x] 7.6 GREEN — `CreatePredictionSheet.tsx` Zone 4 regroup: "Para que la predicción quede" (quorum `Segmented` 30/50/80 + `qualification_hours` + live sentence "Con N personas en el grupo, necesita M."), "Quién ve qué" (relabeled results/votes), "Extras".
- [x] 7.7 Fix hardcoded `3`: `CreatePredictionSheet.tsx:125` success toast (`'Queda en prueba: necesita 3 personas para seguir.'`) and `:164` sheet description (`'Empieza en prueba. Si en 48 horas la eligen 3 personas, queda.'`) — rewrite both against the live requirement/percentage, dropping the "48 horas… tres personas" wording (high-risk item 8).
- [x] 7.8 GREEN — wire `HelpTip` to every field the spec requires: `qualification_percent`, `qualification_hours`, closing date, evolutiva `vote_interval` (copy states rounds are counted from creation), `results_visibility`, `votes_visibility`, `close_percent`.
- [x] 7.9 RED — unit test: every field in 7.8 has an adjacent non-empty `HelpTip`.

## Phase 8: Search Indexing UI + Static Assets

- [x] 8.1 RED — `src/components/SeoRobots.test.tsx`: meta tag sets/updates across two `MemoryRouter` navigations, both directions (private→indexable and back).
- [x] 8.2 GREEN — new `src/components/SeoRobots.tsx`; mount `<SeoRobots />` in `src/App.tsx` (~L66-68), above `<Routes>`.
- [x] 8.3 GREEN — remove the blanket `<meta name="robots">` from `index.html:19`.
- [x] 8.4 GREEN — new `public/robots.txt`: `User-agent: *`, `Allow: /`, `Disallow: /g/`, `/join/`, `/crear-grupo`.
- [x] 8.5 RED — unit test asserting `public/robots.txt` content.
- [x] 8.6 GREEN — mirror the same allowlist matcher in `deploy/Caddyfile:44` (kept as the fastest kill switch).
- [x] 8.7 GREEN — `Landing.tsx` canonical + Open Graph tags: bare site origin, no query string or path segment.
- [x] 8.8 RED — unit test: canonical/OG equal the site root exactly.
- [x] 8.9 Fix hardcoded demo: `Landing.tsx:148-152` (`participantCount={2} minimumParticipants={3}`) → live percentage-of-group copy; rewrite the "si en 48 horas no eligieron al menos tres personas" body text (high-risk item 8).

## Phase 9: Full-Suite Verification

- [x] 9.1 Run `npm run typecheck && npm run lint && npm run test && npm run test:integration` — all four green, no pre-existing test removed (only `VoteOption.test.tsx` and `integration/flow.test.ts:209-221` are rewritten, per strict TDD). Do not run `npm run test:e2e` — Playwright browsers are unavailable in this environment; any e2e spec added stays written, not executed.

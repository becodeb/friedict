# Prediction Settings Help Specification

## Purpose

Provide a real, accessible help affordance (`HelpTip`) for every non-obvious create-prediction setting. The existing `src/components/ui/Tooltip.tsx` is pure CSS `:hover` and is inoperable by keyboard or touch, so it does not satisfy this need.

## Requirements

### Requirement: HelpTip is a real, keyboard- and touch-operable disclosure

`HelpTip`'s trigger MUST be a real `<button type="button">` (not a styled `span`/`div`), independently focusable and activatable by keyboard, mouse, and touch — never relying on CSS `:hover` alone.

#### Scenario: Trigger is a real button

- GIVEN a `HelpTip` in the DOM
- WHEN inspected
- THEN the trigger element's role/tag is `button`, reachable via Tab

#### Scenario: Touch activation opens the help

- GIVEN a touch-only device (no hover capability)
- WHEN the user taps the `HelpTip` trigger
- THEN the help panel toggles open — behavior the hover-only `Tooltip` cannot provide

### Requirement: Correct ARIA state and association

The trigger MUST carry `aria-expanded` reflecting open/closed state, and MUST carry `aria-controls` pointing to the id of the help text element it reveals.

> **Reconciled after implementation.** This requirement originally called for
> `aria-describedby`. That was wrong for this control. The help panel is
> conditionally rendered, so while it is closed the referenced id does not
> exist in the DOM and the description resolves to nothing; screen readers
> announce an appearing/disappearing description inconsistently. A `?` that
> reveals a panel is a **disclosure**, and `aria-expanded` + `aria-controls`
> is the pattern that behaves identically across touch, keyboard and AT. The
> spec was corrected to match the implementation rather than degrading working
> assistive-technology behaviour to satisfy the earlier wording.

#### Scenario: aria-expanded toggles

- GIVEN the help panel is closed
- WHEN inspected
- THEN the trigger has `aria-expanded="false"`
- WHEN the user opens it
- THEN the trigger has `aria-expanded="true"`

#### Scenario: aria-controls links to the help text

- GIVEN the help panel is open
- WHEN inspected
- THEN the trigger's `aria-controls` value matches the `id` of the element containing the help copy

### Requirement: Full keyboard operation, including Escape to dismiss

The trigger MUST open on `Enter`/`Space` when focused. When open, `Escape` MUST close the panel and return focus to the trigger.

#### Scenario: Enter/Space opens

- GIVEN the trigger is focused and closed
- WHEN the user presses `Enter` or `Space`
- THEN the panel opens

#### Scenario: Escape closes and returns focus

- GIVEN the panel is open
- WHEN the user presses `Escape`
- THEN the panel closes
- AND focus returns to the trigger

### Requirement: Every non-obvious create-prediction setting has adjacent help

The create-prediction form MUST wire a `HelpTip` (via `FieldShell.trailing`/`hint` or the new `Segmented` help slot) to each of: qualification quorum (`qualification_pct`), `qualification_hours`, closing date (optional), evolutiva `vote_interval`, `results_visibility`, `votes_visibility`, and `close_quorum`.

#### Scenario: Every listed field has help

- GIVEN the create-prediction form
- WHEN rendered
- THEN each field in the list above has an adjacent `HelpTip` with non-empty, specific plain-Spanish copy

#### Scenario: Evolutiva help explains the anchor and previews rounds

- GIVEN the `vote_interval` field on a `recurring` prediction
- WHEN its `HelpTip` is opened
- THEN the copy states that rounds are counted from creation time (`opens_at = now()`), e.g. "las rondas se cuentan desde que la creás" — not from a fixed calendar boundary
- AND the surrounding UI shows the rounds-before-close preview (see `prediction-closing`)

#### Scenario: qualification_hours help explains its effect

- GIVEN the `qualification_hours` field
- WHEN its `HelpTip` is opened
- THEN the copy explains it is the deadline to reach the qualification quorum before the prediction expires unqualified — distinct from the closing date

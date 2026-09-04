# Prediction Presets Specification (delta)

## Purpose

Make the create-prediction form's default path be: write the question, write the options, pick a
preset, done. Presets are the front door, NOT a replacement for the individual settings — the
owner asked for both: *"quizá en vez de tantas opciones que haya como presets"* and, immediately
after, *"pero que se puedan cambiar las opciones individuales"*.

## ADDED Requirements

### Requirement: Four presets, each a named combination of existing settings

The form MUST offer exactly these four choices, and choosing one MUST set the underlying fields to
exactly these values.

| Preset | `voting_mode` | `results_visibility` | `votes_visibility` | vote-change window |
|---|---|---|---|---|
| A libro abierto | `single` | `always` | `visible` | until close (`NULL`) |
| A ciegas *(default)* | `single` | `on_close` | `on_close` | 15 minutes |
| Evolutiva | `recurring` | `on_close` | `on_close` | never (`interval '0'`) |
| A medida | — | — | — | — |

The copy MUST match the owner's descriptions, in Rioplatense Spanish:

- **A libro abierto** — "Cambiás el voto cuando quieras. Ves los números y quién votó qué, siempre."
- **A ciegas** — "Un voto. Lo corregís 15 minutos y se traba. Nadie ve nada hasta el cierre."
- **Evolutiva** — "Un voto por ronda, cada X días. La ronda cerrada no se toca nunca. Al cerrar se
  ve cómo fue cambiando."
- **A medida** — "Todos los campos abiertos."

#### Scenario: "A ciegas" is the default

- GIVEN the create-prediction form freshly opened
- WHEN rendered
- THEN "A ciegas" is the selected preset, and the underlying values are `single` / `on_close` /
  `on_close` / 15 minutes

#### Scenario: Choosing a preset fills every field it owns

- GIVEN the form with "A ciegas" selected
- WHEN the user picks "A libro abierto"
- THEN `votingMode` becomes `single`, `resultsVisibility` becomes `always`, `votesVisibility`
  becomes `visible` and the vote-change window becomes "until close" — all four at once

#### Scenario: Evolutiva still asks for its interval

- GIVEN the user picks "Evolutiva"
- WHEN the form re-renders
- THEN the "cada cuántos días se puede volver a votar" field is visible and required, because the
  preset's own description says "cada X días"

#### Scenario: "A medida" opens every field

- GIVEN the user picks "A medida"
- WHEN the form re-renders
- THEN the advanced panel is expanded and every individual field is editable, with no value
  silently forced

### Requirement: Any individual field can still be overridden

The advanced panel MUST remain, and MUST let the user change `voting_mode`,
`results_visibility`, `votes_visibility`, the vote-change window and `allow_new_options`
individually, whichever preset is selected.

#### Scenario: Overriding one field keeps the rest

- GIVEN "A ciegas" selected
- WHEN the user changes only `votesVisibility` to `visible`
- THEN `votingMode`, `resultsVisibility` and the window keep their "A ciegas" values

#### Scenario: The overridden value is what gets submitted

- GIVEN a preset chosen and then one field overridden
- WHEN the form is submitted
- THEN the RPC receives the overridden combination, not the preset's original values

### Requirement: A combination that matches no preset is shown honestly as "A medida"

The selected preset MUST be **derived** from the current field values on every render, never held
as independent state. When the values match no preset, the UI MUST show "A medida" as selected —
it MUST NOT keep showing a preset whose values no longer apply.

#### Scenario: Overriding a field flips the row to "A medida"

- GIVEN "A ciegas" selected
- WHEN the user changes `resultsVisibility` to `always` in the advanced panel
- THEN the preset row shows "A medida" selected, not "A ciegas"

#### Scenario: Returning to an exact match re-selects that preset

- GIVEN the row showing "A medida" after an override
- WHEN the user changes that field back to the preset's value
- THEN the row shows the matching preset selected again, with no extra interaction

#### Scenario: Derivation is a pure function

- GIVEN any combination of the four underlying values
- WHEN the preset is derived
- THEN it returns exactly one preset id or `custom`, deterministically, with no React state
  involved

### Requirement: Presets are not persisted on the prediction row

The database MUST NOT store which preset was chosen. Only the underlying columns are persisted.

#### Scenario: No preset column exists

- GIVEN the `predictions` table after this change
- WHEN its columns are inspected
- THEN there is no `preset` column, and the four settings are the complete representation

#### Scenario: Redefining a preset never rewrites old predictions

- GIVEN predictions created under "A ciegas" with a 15-minute window
- WHEN a future product decision changes "A ciegas" to 30 minutes
- THEN the existing predictions keep their 15-minute window, because what was persisted is the
  window and not the label

### Requirement: The form's default path is question, options, preset

The always-visible part of the form MUST be: the question, the context, the option type, the
options, the preset row, and the closing choice. Every other setting MUST live behind the
collapsed advanced panel.

#### Scenario: A person can create a prediction without opening the advanced panel

- GIVEN the create-prediction form
- WHEN a user fills the question and two options, leaves "A ciegas" selected and submits
- THEN the prediction is created successfully, with no advanced panel interaction

#### Scenario: The closing choice is not owned by any preset

- GIVEN any preset selected
- WHEN it is applied
- THEN the "¿Cuándo cierra?" choice and any closing date are left untouched
- Reason: a preset that silently set a closing date would surprise the user; when a prediction
  ends is a different question from how it is played

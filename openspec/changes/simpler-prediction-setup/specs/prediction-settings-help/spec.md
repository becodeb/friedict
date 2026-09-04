# Prediction Settings Help Specification (delta)

## MODIFIED Requirements

### Requirement: Every non-obvious create-prediction setting has adjacent help

The create-prediction form MUST wire a `HelpTip` (via `FieldShell.trailing`/`hint` or the
`Segmented` help slot) to each of: the preset row, close mode (date vs open-ended), evolutiva
`vote_interval`, and — inside the advanced panel — `voting_mode`, `results_visibility`,
`votes_visibility` and the vote-change window.

It MUST NOT render help for `qualification_percent`, `qualification_hours` or `close_percent` —
those three fields no longer exist on this form. The group settings screen MUST carry the
equivalent help for the settings that moved there: the qualification toggle, the qualification
percentage (only while the toggle is on) and the close quorum.

#### Scenario: Every remaining field has help

- GIVEN the create-prediction form with the advanced panel expanded
- WHEN rendered
- THEN the preset row, close mode, voting mode, results visibility, votes visibility and the
  vote-change window each have an adjacent `HelpTip` with non-empty, specific plain-Spanish copy

#### Scenario: The removed fields have no help because they have no field

- GIVEN the create-prediction form with the advanced panel expanded and close mode set to
  "Cuando lo pida el grupo"
- WHEN rendered
- THEN no control and no `HelpTip` exists for "cuánta gente tiene que votar", "cuánto tiempo tiene
  para juntar gente" or "cuánta gente tiene que pedir el cierre"

#### Scenario: The preset help explains that presets are a starting point

- GIVEN the preset row
- WHEN its `HelpTip` is opened
- THEN the copy says the preset fills the settings below and that any one of them can still be
  changed afterwards

#### Scenario: The vote-change window help explains the anchor

- GIVEN the vote-change window control
- WHEN its `HelpTip` is opened
- THEN the copy states that the clock starts when **you** vote, not when the prediction was
  created, e.g. "el reloj arranca cuando votás vos"
- AND it says why the lock exists: so nobody que se entera después pueda cambiar el voto

#### Scenario: Evolutiva help explains the anchor and previews rounds

- GIVEN the `vote_interval` field on a `recurring` prediction
- WHEN its `HelpTip` is opened
- THEN the copy states that rounds are counted from creation time (`opens_at = now()`), e.g.
  "las rondas se cuentan desde que la creás" — not from a fixed calendar boundary
- AND the surrounding UI shows the rounds-before-close preview

#### Scenario: Open-ended close mode explains where the rule now lives

- GIVEN close mode set to "Cuando lo pida el grupo"
- WHEN the form is rendered
- THEN it states in plain Spanish how many people the group currently needs to close a
  prediction, and that the number is changed in the group settings — not on this form

#### Scenario: Group settings carry the help that moved

- GIVEN the group settings screen viewed by an admin
- WHEN rendered
- THEN the qualification toggle and the close quorum each have a `HelpTip`, and the qualification
  percentage has one too whenever it is visible

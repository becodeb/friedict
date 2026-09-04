# Group Settings Specification (delta)

## ADDED Requirements

### Requirement: The group owns the close quorum, as an absolute count with floor 1

`public.groups` MUST carry `close_request_quorum smallint not null default 1
check (close_request_quorum >= 1)`. It is an absolute COUNT of members who must request a close,
NOT a percentage. The effective requirement MUST be `least(live_member_count,
close_request_quorum)` with an absolute floor of 1, evaluated against the group's CURRENT live
member count. It fully replaces `predictions.close_percent`.

#### Scenario: One request is enough when the group trusts itself

- GIVEN a group with `close_request_quorum = 1` and an open-ended prediction
- WHEN a member who has already voted requests the close
- THEN the prediction transitions to `closed` in that same request's transaction

#### Scenario: The quorum is capped at the live member count

- GIVEN a group of 3 members with `close_request_quorum = 10`
- WHEN the requirement is computed
- THEN it is 3, never 10, so the prediction is not made permanently uncloseable

#### Scenario: The quorum can never be stored below 1

- GIVEN an attempt to set `close_request_quorum = 0` through the RPC or directly
- WHEN the write is evaluated
- THEN the CHECK constraint rejects it

#### Scenario: A member leaving lowers the requirement

- GIVEN a group of 3 with `close_request_quorum = 3` and 2 standing close requests
- WHEN one member who has NOT requested the close leaves the group
- THEN the requirement drops to 2 and `finalize_predictions` closes the prediction

### Requirement: Qualification is a per-group toggle, default OFF

`public.groups` MUST carry `qualification_enabled boolean not null default false` and
`qualification_percent smallint not null default 60 check (qualification_percent between 1 and 100)`.
With the toggle OFF a prediction MUST be born `active`; with it ON a prediction MUST be born
`proposed` and flip to `active` when the group-level threshold is met.

#### Scenario: Default group creates predictions already open

- GIVEN a newly created group (no settings touched)
- WHEN a member creates a prediction
- THEN its status is `active`, with no "En prueba" badge, no `ParticipationThreshold` widget and
  no participation gate

#### Scenario: Toggle ON reinstates the qualification gate

- GIVEN a group with `qualification_enabled = true` and `qualification_percent = 60`
- WHEN a member creates a prediction in a 5-member group
- THEN its status is `proposed`, and it flips to `active` once 3 distinct members have voted

#### Scenario: The percentage knob is hidden while the toggle is off

- GIVEN a group with `qualification_enabled = false`
- WHEN an admin opens the group settings screen
- THEN the qualification percentage control is not rendered at all

#### Scenario: Turning the toggle off releases predictions already in prueba

- GIVEN a group with `qualification_enabled = true` and a prediction in `proposed`
- WHEN an admin turns the toggle off
- THEN that prediction becomes `active` in the same transaction, and no prediction is left
  waiting for a gate that no longer exists

### Requirement: Group settings are changed only through an admin-gated RPC

`public.update_group_settings(p_group_id uuid, p_close_request_quorum smallint,
p_qualification_enabled boolean, p_qualification_percent smallint)` MUST be `security definer`,
MUST reject a caller for whom `public.is_group_admin(p_group_id)` is false with `admin_only`
(`42501`), MUST be registered in `db/rpc-functions.json` with correct casts, and MUST be granted
to `authenticated` only after an explicit `revoke ... from public, anon, authenticated`.

#### Scenario: A plain member cannot change the settings

- GIVEN a group member whose role is `member`
- WHEN they call `update_group_settings`
- THEN it raises `admin_only` and no column changes

#### Scenario: An admin changes the settings

- GIVEN a group member whose role is `admin` or `owner`
- WHEN they call `update_group_settings`
- THEN the group row is updated and returned

#### Scenario: A non-member cannot even probe the group

- GIVEN a user who is not a member of the group
- WHEN they call `update_group_settings` with that group's id
- THEN it raises `admin_only` and nothing is written

#### Scenario: Omitted parameters leave their column untouched

- GIVEN an admin who sends only `p_close_request_quorum`
- WHEN the RPC runs
- THEN `qualification_enabled` and `qualification_percent` keep their current values

### Requirement: A non-admin sees the settings but cannot edit them

The group settings screen MUST render the three settings to every member. For a non-admin they
MUST be read-only values with an explicit line saying only an admin can change them — never
disabled-looking controls with no explanation.

#### Scenario: Non-admin sees values, not controls

- GIVEN a member whose role is `member`
- WHEN they open the group settings screen
- THEN the three settings are shown as read-only text, no form control is focusable, and a line
  states that only whoever administers the group can change them

#### Scenario: Admin sees editable controls

- GIVEN a member whose role is `owner` or `admin`
- WHEN they open the group settings screen
- THEN a toggle, a save button and (only if the toggle is on) the percentage control are
  rendered and operable

### Requirement: "Los del grupo" options track live membership

For a prediction with `option_type = 'members'`, joining the group MUST add that member as an
option to every still-open (`proposed` or `active`) `members` prediction in that group. Leaving
the group MUST NOT remove the option.

#### Scenario: A late joiner becomes a votable option

- GIVEN a group of 3 with an open `option_type = 'members'` prediction
- WHEN a fourth person joins through an invite
- THEN the prediction has 4 options and the new member is votable

#### Scenario: Leaving never deletes an option, and never deletes votes

- GIVEN an open `members` prediction where two people already voted for member X's option
- WHEN X leaves the group
- THEN X's option still exists and both votes are still there
- Reason: `prediction_votes.option_id` is `on delete cascade`
  (`db/migrations/100_schema.sql:238`), so deleting the option would silently erase other
  people's votes and change `participant_count`

#### Scenario: Rejoining does not create a second option

- GIVEN a member who left the group and whose option is still on an open prediction
- WHEN they rejoin through an invite
- THEN no duplicate option is created

#### Scenario: Two members with the same display name both get an option

- GIVEN an open `members` prediction already carrying the option "Juan"
- WHEN a second member whose `display_name` is also "Juan" joins
- THEN both are votable as distinct options, and `unique (prediction_id, label)` is not violated

#### Scenario: Renaming a profile does not rewrite existing option labels

- GIVEN a member with an option labelled "Juan" on an open prediction
- WHEN they change their display name to "Juancito" via `upsert_profile`
- THEN the existing option label stays "Juan", the votes cast for it are untouched, and only
  options created after the rename use the new name

#### Scenario: Closed predictions are not touched

- GIVEN a `closed` or `resolved` `members` prediction
- WHEN a new member joins the group
- THEN no option is added to it

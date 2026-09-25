## ADDED Requirements

### Requirement: Material corporation-role evidence events
The system SHALL record a versioned character corporation-role event in the same PostgreSQL transaction as each accepted semantic role transition. A transition containing one or more removed roles SHALL record `character.corporation-role-loss-confirmed`; a transition containing additions and no removals SHALL record `character.corporation-roles-changed`. Successful unchanged revalidation, transient refresh failure, and superseded observations SHALL NOT produce a material role-change event.

#### Scenario: Fresh observation confirms role loss
- **WHEN** an accepted fresh role observation removes one or more roles from the current canonical observation
- **THEN** the transaction records one `character.corporation-role-loss-confirmed` event with safe source identity and previous and current opaque revisions

#### Scenario: Fresh observation adds roles only
- **WHEN** an accepted fresh role observation adds one or more roles without removing any current role
- **THEN** the transaction records one `character.corporation-roles-changed` event with safe source identity and previous and current opaque revisions

#### Scenario: Initial observation becomes current
- **WHEN** a source binding receives its first accepted role observation
- **THEN** the system converges current authority in that transaction without describing the initial observation as a role change or confirmed loss

#### Scenario: Roles revalidate unchanged
- **WHEN** a successful refresh preserves semantically identical canonical role sets
- **THEN** the system advances freshness without recording a role-change event

#### Scenario: Refresh is unavailable
- **WHEN** a transient failure prevents a fresh role comparison
- **THEN** the system records no role-change or confirmed-loss event

### Requirement: Corporation-role event payloads are private-data free
Corporation-role event payloads SHALL contain only the character, account, ownership lifecycle, affiliation period revision, organization version, authority corporation, authorization generation, and opaque previous and current revision identities needed for convergent handling. They MUST NOT contain role names, role arrays, raw ESI data, conditional validators, cache identities, tokens, credentials, or secret material.

#### Scenario: Role event is persisted and relayed
- **WHEN** a material role transition commits and its event is published
- **THEN** PostgreSQL contains only the validated safe payload and the queue job contains only the stable event identifier

#### Scenario: Producer includes raw role content
- **WHEN** a producer attempts to place a role name or role collection in a corporation-role event payload
- **THEN** event validation rejects the payload before the role transition commits

### Requirement: Corporation-role event consumers converge from current evidence
Every corporation-role event consumer SHALL recompute its result from current durable evidence or key durable effects by event identifier. Delayed, repeated, or out-of-order events MUST NOT revive a superseded lifecycle, role revision, organization version, authority source, or corporation-source eligibility.

#### Scenario: Confirmed-loss event is delivered repeatedly
- **WHEN** at-least-once relay executes the same confirmed-loss event more than once
- **THEN** dependent authority and collection eligibility converge to the same result as one successful execution

#### Scenario: Older event arrives after reauthorization
- **WHEN** an event for an earlier authorization generation is handled after a newer generation and role revision became current
- **THEN** the consumer preserves the newer current state and does not reapply the older transition

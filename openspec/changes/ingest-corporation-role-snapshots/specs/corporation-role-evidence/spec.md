## Purpose

Defines authoritative, source-character-specific corporation-role evidence for organization authority and role-gated corporation operations without exposing raw private EVE role data.

## ADDED Requirements

### Requirement: Corporation-role observations are source-bound
The system SHALL obtain corporation roles through the registered character corporation-role operation using the exact source character and least-privilege scope. It SHALL persist an observation only when the character ownership lifecycle, account owner, current organization version, observed corporation affiliation period, authorization generation, and required scope still match the authority context that initiated the observation. Facts from different characters, affiliation periods, or lifecycles MUST NOT be combined into one role observation.

#### Scenario: Current source observation succeeds
- **WHEN** ESI returns validated roles for a source character whose lifecycle, organization version, corporation affiliation period, authorization generation, and required scope remain current
- **THEN** the system persists those roles as the current source-bound observation with its validation and freshness metadata

#### Scenario: Source binding changes during collection
- **WHEN** a character is detached, transferred, reauthorized, changes corporation, or belongs to a superseded organization version before a fetched role observation is committed
- **THEN** the system rejects that observation as superseded and it cannot become current evidence

#### Scenario: Another character has the required role
- **WHEN** one attached character supplies the required scope or affiliation and another attached character holds the required role
- **THEN** neither character receives qualifying role evidence unless one character independently satisfies the complete source-bound predicate

### Requirement: Affiliation periods fence cached role evidence
Every current character affiliation SHALL carry an opaque period revision that changes when its observed corporation or alliance changes and remains stable across unchanged affiliation revalidation. Corporation-role cache identity and persisted role evidence SHALL include that period revision. A role result MAY become current only when it was resolved under the same affiliation period that remains current at persistence time; cached evidence from another affiliation period MUST NOT be rebound even when character lifecycle and authorization generation are unchanged.

#### Scenario: Character changes corporation with a warm role cache
- **WHEN** a character moves from corporation A to corporation B without changing ownership lifecycle or authorization generation while a role response for affiliation period A remains fresh in application cache
- **THEN** the period-B role observation cannot consume or rebind the period-A cached response and requires role validation under the period-B cache identity

#### Scenario: Affiliation revalidates unchanged
- **WHEN** fresh affiliation data confirms the same corporation and alliance
- **THEN** the affiliation period revision remains stable and does not invalidate matching role evidence solely because another affiliation check occurred

#### Scenario: Affiliation changes during role collection
- **WHEN** role collection starts under one affiliation period and a different period becomes current before persistence
- **THEN** the collected result is superseded and cannot update role content, deadlines, failure state, or dependent authority

### Requirement: Current role evidence has an opaque semantic revision
The system SHALL canonicalize and persist the complete `roles`, `roles_at_base`, `roles_at_hq`, and `roles_at_other` sets returned by ESI. Each current observation SHALL carry an opaque, non-content-derived revision that changes only when canonical role content or its authority binding changes. A successful unchanged revalidation SHALL preserve the revision while advancing validation and freshness metadata. Disposable cache identity, validators, and fetch timestamps MUST NOT serve as the semantic revision.

#### Scenario: Unchanged roles are revalidated
- **WHEN** ESI successfully revalidates semantically identical role sets under the same authority binding
- **THEN** the system preserves the current opaque revision and advances its validation and freshness metadata

#### Scenario: Role content changes
- **WHEN** a fresh successful ESI response differs semantically from the current canonical role sets
- **THEN** the system assigns a new opaque revision and the previous revision immediately ceases to be current

#### Scenario: Equivalent role ordering changes
- **WHEN** ESI returns the same role memberships in a different array order
- **THEN** the system treats the response as unchanged rather than creating a new semantic revision

### Requirement: Observation attempts are monotonically fenced
Before each observation attempt that can persist a successful, transient-failure, or strict-failure outcome, the system SHALL allocate a database-monotonic observation sequence independently from the semantic role revision. Every outcome SHALL carry that sequence and MAY update role content, validation metadata, deadlines, retry state, failure state, or dependent authority only when it is newer than the last applied sequence for the same source binding. An invalidated binding SHALL retain a content-free ordering tombstone sufficient to reject an older in-flight result. Serialization at commit time alone MUST NOT establish observation order.

#### Scenario: Older changed response finishes after newer unchanged response
- **WHEN** an older role request returns changed content after a later-started unchanged validation has already committed
- **THEN** the older response cannot replace the current content, rotate its revision, shorten or extend deadlines, or converge dependent authority

#### Scenario: Older transient failure finishes after newer success
- **WHEN** an older role request fails after a later-started successful observation has committed
- **THEN** the older failure cannot mark the evidence degraded, alter retry state, or overwrite successful deadlines

#### Scenario: Older success finishes after newer strict failure
- **WHEN** an older successful role request completes after a later-started strict invalidation has committed
- **THEN** the older result cannot restore raw role content or revive invalidated authority

### Requirement: Bootstrap observation requires explicit transactional authority
The shared observation path SHALL accept either current scheduled demand or one explicitly authorized bootstrap intent for an organization-owner claim, owner-source replacement, corporation-source registration, or corporation-source replacement. A bootstrap intent SHALL bind the actor or state-bound session, exact character lifecycle, affiliation period revision, organization version, target authority corporation, authorization generation, required scope, and intended mutation. Bootstrap evidence and its consuming grant or source mutation SHALL commit atomically; a failed mutation MUST NOT leave an independently current observation or create ongoing scheduled demand.

#### Scenario: First owner claims while derived authority is disabled
- **WHEN** a state-bound owner-claim OAuth intent proves the exact eligible character and current organization while no owner source exists and derived Director policy is disabled
- **THEN** the system may observe roles for that bootstrap intent and atomically commit the qualifying observation with the initial owner source

#### Scenario: Manager registers the first corporation source
- **WHEN** a current authorized manager selects an exact owned character for a managed corporation that has no existing source
- **THEN** the system may observe roles under a corporation-source bootstrap intent and atomically commit evidence only with the successful source registration

#### Scenario: Unclassified caller requests bootstrap
- **WHEN** a caller has neither current scheduled demand nor one supported exact bootstrap intent
- **THEN** the observation path rejects persistence and does not create role evidence or future refresh demand

#### Scenario: Bootstrap mutation loses its race
- **WHEN** the target organization version, source selection, actor authority, or character binding changes before the bootstrap transaction commits
- **THEN** both the intended mutation and role observation are rejected as superseded

### Requirement: Role evidence has clock-enforced freshness
Current role evidence SHALL carry absolute validated, fresh, and optional degraded deadlines. Its fresh deadline SHALL be no later than the earliest applicable ESI freshness boundary and organization authority-evidence boundary. Freshness SHALL be evaluated against the clock at every authority or collection decision rather than inferred from a stored status alone.

#### Scenario: Evidence passes its fresh deadline
- **WHEN** the current time reaches a role observation's fresh deadline before another successful validation
- **THEN** the observation cannot establish new authority, authorize governance mutation, admit new role-gated collection, or authorize materialization

#### Scenario: Transient ESI failure follows fresh evidence
- **WHEN** a refresh fails because of a classified transient ESI, SSO, quota, cache, or coordination outage
- **THEN** the system retains the last validated role content, records unavailable or degraded evidence through the fixed policy deadline, and does not infer that any role was lost

#### Scenario: Definitive source failure occurs
- **WHEN** the exact lifecycle, affiliation period, authorization generation, required scope, owner, organization version, or corporation binding is definitively invalid
- **THEN** the role observation becomes invalid immediately without stale grace

### Requirement: Confirmed role changes require fresh positive evidence
The system SHALL classify a role gain or loss only by comparing the current canonical observation with a fresh successful ESI role response accepted under the same current authority binding. A successful empty role set SHALL be valid negative evidence. Missing, stale, malformed, failed, or superseded responses MUST NOT confirm role loss.

#### Scenario: Required role is removed
- **WHEN** a fresh successful observation no longer contains a role present in the current observation
- **THEN** the system records a confirmed role-loss transition under the new revision without a grace period for authority that required the removed role

#### Scenario: Successful response contains no roles
- **WHEN** ESI successfully validates empty role sets under a current source binding
- **THEN** the system treats every previously observed role as confirmed lost rather than treating the response as unavailable

#### Scenario: Refresh fails before comparison
- **WHEN** ESI does not provide a fresh successful role response
- **THEN** the system records no role gain or confirmed role loss and follows the classified degradation policy

### Requirement: Raw role evidence remains private and minimal
Raw corporation-role sets SHALL remain inside the character evidence boundary and MUST NOT appear in browser APIs, module capabilities, organization provenance, audit entries, domain-event payloads, queue payloads, telemetry, or logs. When a semantic revision is replaced, the system SHALL retain only the current raw role content; long-lived authority history MAY retain its opaque revision and sanitized outcome without retaining superseded raw roles.

#### Scenario: Module requests corporation authority
- **WHEN** a first-party or external module needs to know whether a registered source satisfies a reviewed role predicate
- **THEN** the platform returns only the evaluated eligibility and bounded evidence metadata rather than raw role sets

#### Scenario: Historical authority is retained
- **WHEN** authority provenance outlives the role revision that supported it
- **THEN** the provenance retains the opaque revision, source identity, deadlines, and sanitized outcome without retaining or exposing the superseded role content

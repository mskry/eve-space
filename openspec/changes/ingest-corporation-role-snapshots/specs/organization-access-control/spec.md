## ADDED Requirements

### Requirement: Character-backed authority resolves current role evidence
Except for the bounded migration continuity defined below, every organization-owner, derived-Director, and corporation-source decision that depends on an EVE corporation role SHALL require current role evidence whose opaque revision, character ownership lifecycle, affiliation period revision, organization version, authority corporation, authorization generation, required scope, and freshness match the source record. Authorization, source eligibility, queued execution, and successful materialization SHALL fail closed on a missing, stale, invalid, or mismatched role observation even when a consumer-specific projection has not yet been repaired.

#### Scenario: Consumer projection references an old role revision
- **WHEN** a role observation advances to a new revision while an owner, derived-Director, or corporation-source record still references the previous revision
- **THEN** the previous source record cannot authorize current access or corporation work before asynchronous repair completes

#### Scenario: Current role evidence remains fresh
- **WHEN** a source record and the current fresh role observation have matching lifecycle, affiliation period, organization, corporation, authorization, scope, and revision bindings
- **THEN** the system evaluates the source's required role predicate without exposing the raw role observation

#### Scenario: Evidence is degraded
- **WHEN** current role evidence is degraded because fresh validation is temporarily unavailable
- **THEN** only explicitly declared existing read-only continuity or source remediation may continue until the fixed degraded deadline, while new authority, governance mutation, source registration or replacement, external synchronization, role-gated collection, and materialization are denied

### Requirement: Confirmed role loss converges dependent authority
A confirmed role-loss transition SHALL immediately make every dependent character-backed authority source and corporation-source eligibility fail closed. The system SHALL converge effective roles, groups, module access, collection eligibility, and external-service entitlements without invalidating independent explicit grants or another character source that still satisfies its complete current predicate.

#### Scenario: Owner source loses Director
- **WHEN** fresh role evidence confirms that the explicitly claimed organization-owner source no longer holds Director
- **THEN** that source stops authorizing owner operations immediately and no other character silently replaces it

#### Scenario: One derived Director source loses Director
- **WHEN** one of several current derived-Director sources has a confirmed Director loss
- **THEN** the affected source is invalidated while the account retains derived Director authority only through independently qualifying current sources

#### Scenario: Corporation source loses a required collection role
- **WHEN** fresh role evidence confirms that a registered corporation source no longer satisfies a reviewed role predicate
- **THEN** work requiring that predicate is ineligible immediately and delayed work cannot execute or materialize under the former revision

#### Scenario: Explicit application grant coexists with role loss
- **WHEN** confirmed EVE role loss invalidates a derived source while an independent explicit application grant remains current
- **THEN** convergence removes only effects dependent on the lost EVE-backed source

### Requirement: Preexisting authority has bounded migration continuity
An organization-owner, derived-Director, or corporation-source record that existed before corporation-role observations were introduced MAY retain exactly its prior authorization behavior only while no new observation has been accepted for the same binding, its lifecycle, owner, affiliation, organization version, authorization generation, required scope, role outcome, and status remain eligible under the prior contract, and its originally persisted fresh deadline remains in the future. This exception SHALL NOT be extended, renewed, copied to another source, or used for a new claim, source registration, source replacement, or derived source. A new observation, strict failure, binding change, or original deadline expiry SHALL end the exception immediately.

#### Scenario: Existing fresh source awaits its first observation
- **WHEN** a source created before the migration has no new role observation, remains unchanged and eligible, and its original fresh deadline is still in the future
- **THEN** the system may preserve only the authorization behavior that source had before the migration until the earliest terminating condition

#### Scenario: First new observation becomes current
- **WHEN** a qualifying role observation is accepted for a legacy source binding before its original deadline
- **THEN** the bounded exception ends immediately and every later decision uses the new current observation contract

#### Scenario: Legacy deadline expires before refresh
- **WHEN** a legacy source reaches its originally persisted fresh deadline without an accepted new observation
- **THEN** it fails closed without waiting for a worker and the deadline cannot be extended from the legacy role outcome

#### Scenario: Legacy binding changes
- **WHEN** a legacy source changes lifecycle, owner, affiliation period, organization version, authorization generation, required scope, or receives a strict failure before successful refresh
- **THEN** the exception ends immediately without degraded or migration grace

#### Scenario: New authority is created after migration
- **WHEN** a user attempts a new owner claim, derived source, corporation-source registration, or source replacement after the observation capability is deployed
- **THEN** the operation requires current source-bound role evidence and cannot use the migration exception

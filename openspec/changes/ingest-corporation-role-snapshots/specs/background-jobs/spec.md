## ADDED Requirements

### Requirement: Demand-driven corporation-role synchronization
The system SHALL derive corporation-role refresh demand from current PostgreSQL authority state. Demand SHALL include explicitly claimed organization-owner sources, registered corporation sources, and policy-eligible characters considered for derived Director authority while that policy is enabled. Characters with no current role-dependent consumer SHALL NOT remain scheduled solely because they once granted the corporation-role scope.

#### Scenario: Authority source requires refresh
- **WHEN** a current source's role evidence reaches its persisted refresh time
- **THEN** the planner selects it from authoritative demand state for bounded refresh work

#### Scenario: Derived Director policy is disabled
- **WHEN** derived Director policy is disabled for the current organization version
- **THEN** ordinary attached characters cease generating derived-Director role refresh demand while explicit owner and corporation sources remain independently eligible

#### Scenario: Last consumer is removed
- **WHEN** a character no longer backs owner authority, a corporation source, or enabled derived authority
- **THEN** automatic role refresh stops without deleting retained content-free authority provenance

### Requirement: Corporation-role refresh work is bounded and reconstructible
Corporation-role refresh jobs SHALL be classified as derived, selected in deterministic bounded pages, coalesced by current character lifecycle, affiliation period, and authority binding, and contain only stable non-secret identifiers and expected opaque revision metadata. PostgreSQL SHALL remain authoritative for work omitted by page bounds, queue capacity, cooldown, deduplication, or queue loss.

#### Scenario: Due candidates exceed planner capacity
- **WHEN** more role evidence is due than the planner or queue can safely admit
- **THEN** the planner admits a deterministic bounded subset and leaves every omitted candidate reconstructible from PostgreSQL

#### Scenario: Duplicate demand targets one character lifecycle
- **WHEN** owner, derived-Director, and corporation-source policies all require the same current character lifecycle
- **THEN** the planner coalesces them into one current role observation refresh rather than issuing independent upstream requests

#### Scenario: Queue storage is lost
- **WHEN** pending role refresh jobs disappear with queue storage
- **THEN** the next planning pass reconstructs outstanding work from persisted demand and freshness state

#### Scenario: Operator inspects a role job
- **WHEN** queue records and telemetry are inspected
- **THEN** they contain no role names, role arrays, tokens, credentials, cache keys, or private ESI payloads

### Requirement: Role scheduling follows upstream freshness and cooldowns
The system SHALL schedule normal role revalidation against the current ESI freshness boundary rather than repeatedly attempting upstream refresh while the registered representation remains fresh. A transient failure SHALL become retry-eligible no more frequently than once every five minutes and SHALL continue to respect shared ESI cooldown, concurrency, retry, and queue-admission policy.

#### Scenario: Cached role representation remains fresh
- **WHEN** role evidence is approaching expiry but the registered ESI representation cannot yet be revalidated because its upstream freshness boundary has not passed
- **THEN** the system does not issue repeated speculative upstream requests and retains a due time at or after that boundary

#### Scenario: Transient refresh fails
- **WHEN** a role refresh receives a classified transient provider or coordination failure
- **THEN** its persisted demand remains reconstructible and is not retried before the bounded retry time or an applicable later cooldown deadline

#### Scenario: Refresh succeeds unchanged
- **WHEN** scheduled work successfully revalidates unchanged roles
- **THEN** it advances the current evidence deadlines without creating another semantic revision or another refresh for the same binding

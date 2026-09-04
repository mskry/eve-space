## Purpose

Expose concise, machine-readable ESI operation knowledge and safety-controlled invocation primitives so tool-using LLMs can discover and execute operations without loading the full SDK surface.

## ADDED Requirements

### Requirement: Machine-readable operation registry
The package SHALL expose a deterministic registry and serializable manifest for every supported operation containing its stable identifier, domain, summary, HTTP method, path template, parameters, request and response schema references, authentication requirement, scopes, pagination model, cache metadata, and mutation classification.

#### Scenario: Describe a public operation
- **WHEN** a consumer retrieves a public operation by its stable identifier
- **THEN** the returned description contains all information needed to construct and validate a call
- **THEN** the description is serializable without credentials or executable functions

### Requirement: Bounded operation search
The package SHALL provide deterministic text and filter search over operation identifiers, domains, summaries, methods, authentication requirements, scopes, and mutation classification with a caller-controlled result limit and a safe default limit.

#### Scenario: Search for public market reads
- **WHEN** a consumer searches for market operations filtered to unauthenticated reads
- **THEN** only matching operations are returned in deterministic relevance order
- **THEN** results do not exceed the configured or default limit

### Requirement: Operation description API
The package SHALL provide a description API that returns one operation's serializable contract and reports an explicit unknown-operation error for invalid identifiers.

#### Scenario: Unknown operation identifier
- **WHEN** a consumer requests a description for an identifier absent from the registry
- **THEN** the system returns a structured unknown-operation error without suggesting an executable fallback

### Requirement: Validated generic execution
The package SHALL provide generic operation execution by stable identifier that validates arguments, uses the same client configuration and transport as typed methods, and returns a serializable envelope containing validated data and response metadata.

#### Scenario: Execute a public read operation
- **WHEN** a consumer executes a known public GET operation with valid arguments
- **THEN** exactly one operation request is performed
- **THEN** an envelope containing the typed validated result, status, headers, and normalized response metadata is returned

#### Scenario: Execute with invalid arguments
- **WHEN** generic execution receives arguments that do not match the operation contract
- **THEN** it fails before network activity with a structured request validation error

### Requirement: Mutation safety boundary
Generic operation execution SHALL reject mutation operations by default and SHALL require both client-level generic-mutation enablement and explicit per-call confirmation before issuing a mutation request. These gates SHALL NOT apply to named typed domain methods.

#### Scenario: Mutation attempted with defaults
- **WHEN** generic execution targets a POST, PUT, or DELETE operation using default safety settings
- **THEN** it fails before network activity with a structured mutation-disabled error

#### Scenario: Explicitly confirmed mutation
- **WHEN** mutations are enabled on the client and the individual call includes explicit confirmation
- **THEN** the operation may proceed after normal request and authentication validation

#### Scenario: Typed mutation bypasses generic gates
- **WHEN** a consumer invokes a named typed mutation method
- **THEN** generic mutation enablement and per-call generic confirmation are not required

### Requirement: Authentication awareness and secrecy
Discovery and execution APIs SHALL expose required authentication scopes but SHALL never include access tokens, authorization headers, or token-provider return values in registry data, logs, metadata, or errors.

#### Scenario: Authenticated operation without credentials
- **WHEN** generic execution targets an authenticated operation and no access token is available
- **THEN** it fails before network activity with a structured authentication-required error listing required scopes
- **THEN** no secret value is present in the error

### Requirement: Single-page execution boundary
Generic execution SHALL perform a single operation call and SHALL not automatically traverse unbounded offset or cursor pagination.

#### Scenario: Execute a paginated operation
- **WHEN** generic execution targets a paginated operation
- **THEN** it returns only the requested page or cursor response
- **THEN** operation metadata describes how subsequent pages are requested

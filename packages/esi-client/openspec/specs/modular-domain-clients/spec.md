# Modular Domain Clients Specification

## Purpose

Provide independently usable domain package entries whose construction, runtime dependencies, and TypeScript declarations remain limited to the selected ESI domain and shared client infrastructure.

## Requirements

### Requirement: Standalone domain construction
Every documented domain subpath SHALL export a typed factory that accepts the same applicable client-level options as the aggregate client and returns a client for that domain without requiring an import from the package root.

#### Scenario: Construct one public domain
- **WHEN** an ESM consumer imports the factory from `@evespace/esi-client/domains/status` and provides client options
- **THEN** the consumer can construct the status domain client and invoke the curated `get` method
- **THEN** the consumer does not import or instantiate the aggregate `EsiClient`

#### Scenario: Configure an authenticated domain
- **WHEN** a consumer creates an authenticated domain through its domain factory with a token or asynchronous token provider
- **THEN** operations in that domain apply the configured authentication without exposing credentials in results, metadata, or errors

### Requirement: Aggregate and standalone behavior parity
Domain clients created through standalone factories SHALL use the same request construction, validation, authentication, compatibility-date, response, metadata, error, and typed-mutation behavior as the corresponding domain exposed by the aggregate client.

#### Scenario: Equivalent configured invocation
- **WHEN** a standalone domain client and the matching aggregate-client domain invoke the same operation with equivalent client and operation options
- **THEN** they produce equivalent requests and public results

#### Scenario: Metadata-enabled standalone domain
- **WHEN** a consumer selects the metadata-enabled view from a standalone domain client
- **THEN** it returns the same typed response envelope and immutable metadata as the aggregate-client domain

### Requirement: Isolated domain runtime graph
Each domain subpath SHALL resolve to that domain's implementation, the schemas required by its operations, and shared client infrastructure without loading the package root, the global operation-discovery registry, or unrelated domain implementations and schemas.

#### Scenario: Installed status runtime graph
- **WHEN** package validation traces static runtime dependencies from the installed status domain entry
- **THEN** the graph contains the status implementation and its required schemas
- **THEN** the graph excludes the package root, the global operation-discovery registry, and every unrelated domain implementation and operation-schema module

#### Scenario: Execute without aggregate side effects
- **WHEN** an installed consumer imports, constructs, and invokes one domain factory
- **THEN** no aggregate client or unrelated domain client is constructed or evaluated

### Requirement: Isolated domain declaration graph
Each domain subpath SHALL expose only its public factory, client views, options, operation inputs and outputs, and shared public client types without requiring TypeScript to resolve declarations for unrelated operations or domains.

#### Scenario: Installed status type graph
- **WHEN** package validation traces declaration dependencies from the installed status domain entry
- **THEN** the graph contains the status domain and shared client declarations needed to type its public API
- **THEN** the graph excludes declarations for unrelated domain operations and the aggregate operation registry

### Requirement: Documented modular usage
Generated domain documentation SHALL show standalone factory construction as the narrow-import path while retaining aggregate `EsiClient` examples as the convenience path.

#### Scenario: Domain documentation example
- **WHEN** a consumer reads a generated domain page
- **THEN** the page contains a compilable standalone factory example importing that domain subpath
- **THEN** the page distinguishes standalone construction from aggregate-client access

## Purpose

Offer one predictable ESI client that centralizes shared configuration and exposes complete domain-oriented operations, modular imports, and a generic operation escape hatch.

## ADDED Requirements

### Requirement: Centralized client configuration
The client SHALL accept base URL, compatibility date, access token provider, language, response validation, request validation, generic-mutation enablement, and fetch implementation as client-level configuration applied consistently to its operations.

#### Scenario: Minimal public client
- **WHEN** a consumer creates `EsiClient` without options
- **THEN** public operations use the standard ESI base URL and the package's pinned compatibility date

#### Scenario: Dynamic access token provider
- **WHEN** an authenticated operation is called with an asynchronous token provider configured
- **THEN** the operation obtains and applies the token without exposing it in returned metadata

### Requirement: Predictable domain surface
The client SHALL group methods by ESI domain, use consistent identifier and options conventions, and provide typed access to every generated operation.

#### Scenario: Domain operation discovery
- **WHEN** a consumer accesses a documented domain property
- **THEN** all supported operations for that domain are available through consistently named typed methods

#### Scenario: Operation with optional parameters
- **WHEN** an operation has optional query or header parameters
- **THEN** the domain method accepts them through a typed options object rather than positional optional arguments

### Requirement: Compatibility date handling
The client SHALL apply one valid compatibility date to every request unless an operation call explicitly overrides it through a typed option.

#### Scenario: Client compatibility date
- **WHEN** multiple operations are invoked from a configured client
- **THEN** each request carries the configured compatibility date without requiring repetitive method arguments

### Requirement: Single supported client surface
The package SHALL expose domain methods and generic operation execution from one shared transport and SHALL not require consumers to choose between duplicate generated client implementations or model representations.

#### Scenario: Domain and generic execution parity
- **WHEN** a domain method and generic operation execution target the same operation with equivalent arguments
- **THEN** both use the same request construction, authentication, error, and response validation behavior

### Requirement: Response metadata access
Domain methods SHALL return validated operation data by default and SHALL offer a metadata-enabled domain view that returns an envelope containing the same data, HTTP status, all response headers, request identifier, pagination details, cache validators, and ESI error-limit details.

#### Scenario: Default domain response
- **WHEN** a consumer calls a domain method through its normal domain view
- **THEN** the method returns the operation's validated data without an envelope

#### Scenario: Metadata-enabled paginated response
- **WHEN** a consumer calls a paginated domain method through its metadata-enabled domain view
- **THEN** the result contains validated data and immutable response metadata
- **THEN** the metadata exposes the `X-Pages` value and original response headers needed to request subsequent pages

#### Scenario: Cache and error-limit headers
- **WHEN** ESI returns cache validators or error-limit headers
- **THEN** the metadata exposes the original headers and normalized cache and error-limit fields

### Requirement: Typed mutation intent
Typed domain mutation methods SHALL execute without generic mutation enablement or confirmation because selecting a named typed mutation method is explicit caller intent. Generic mutation safety settings SHALL affect only generic operation execution.

#### Scenario: Typed mutation on a default client
- **WHEN** a consumer calls a typed mutation method with valid arguments and authentication on a default client
- **THEN** the request proceeds without generic mutation enablement or confirmation

#### Scenario: Generic mutations disabled
- **WHEN** generic mutations are disabled and a consumer calls a typed mutation method
- **THEN** the generic mutation setting does not block the typed method

### Requirement: Structured HTTP failures
HTTP failures SHALL include a stable code, operation identifier, status, response metadata, and the parsed ESI error body when available, while excluding request credentials and authorization headers.

#### Scenario: JSON ESI error response
- **WHEN** ESI returns a non-success response with a JSON error body
- **THEN** the client throws a structured HTTP error containing the parsed response body, status, operation identifier, and response headers

#### Scenario: Secret-free HTTP error
- **WHEN** an authenticated request fails
- **THEN** the thrown error contains no access token, authorization header, or token-provider value

### Requirement: Modular ESM exports
The package SHALL provide documented ESM subpaths for domains, schemas, and operation metadata while retaining a root convenience export.

#### Scenario: Domain-only import
- **WHEN** a consumer imports a single domain subpath
- **THEN** package resolution exposes that domain's public types and runtime implementation without requiring a CommonJS entrypoint

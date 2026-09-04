## Purpose

Ensure data crossing the ESI boundary is checked against generated runtime contracts while preserving forward compatibility and providing actionable, structured failures.

## ADDED Requirements

### Requirement: Operation-level runtime schemas
The system SHALL provide generated request and success-response schemas for every operation whose body has a defined JSON shape, including collection, nullable, and composed operation responses.

#### Scenario: Collection response schema
- **WHEN** an operation returns an array of model objects
- **THEN** its operation response schema validates both the collection and each contained object

#### Scenario: No-content operation
- **WHEN** a successful operation has no response body
- **THEN** the operation accepts the empty response without attempting JSON validation
- **THEN** a normal domain method resolves to `undefined`
- **THEN** a metadata-enabled or generic response envelope contains `data: undefined`

### Requirement: Response validation defaults
The client SHALL validate parsed JSON responses by default before returning them and SHALL allow response validation to be disabled explicitly at client construction.

#### Scenario: Valid response
- **WHEN** ESI returns a response matching the operation schema
- **THEN** the client returns data in the operation's documented representation

#### Scenario: Validation explicitly disabled
- **WHEN** a client is configured with response validation disabled
- **THEN** the client returns parsed response data without applying the response schema

### Requirement: Forward-compatible objects
Generated object schemas SHALL accept and preserve unknown response properties while validating all known properties.

#### Scenario: ESI adds an unknown property
- **WHEN** a response contains all required known properties plus an unrecognized property
- **THEN** validation succeeds
- **THEN** the unrecognized property remains present in returned data

### Requirement: Structured validation failures
The system SHALL reject invalid request or response data with a stable validation error containing a machine-readable code, operation identifier, validation direction, and structured issues, while excluding credentials and authorization headers.

#### Scenario: Invalid response property type
- **WHEN** a response property has a type that violates its operation schema
- **THEN** the client throws a response validation error identifying the operation and property path
- **THEN** the error contains no access token or authorization header

### Requirement: Optional request validation
Typed domain methods SHALL support opt-in request validation before network activity and SHALL leave request validation disabled by default for performance, while generic operation execution SHALL always validate its arguments.

#### Scenario: Invalid request with validation enabled
- **WHEN** request validation is enabled and operation arguments violate the generated request schema
- **THEN** the client throws a request validation error before issuing an HTTP request

#### Scenario: Invalid generic operation arguments
- **WHEN** generic operation execution receives arguments that violate the generated request schema
- **THEN** the client throws a request validation error before issuing an HTTP request regardless of the typed-method request validation setting

### Requirement: Public schema and type consistency
The package SHALL export generated schemas through documented ESM subpaths and SHALL verify at build time that public operation input and output types agree with their schemas.

#### Scenario: Consumer imports a schema
- **WHEN** an ESM consumer imports an operation or model schema from the documented schema subpath
- **THEN** the schema is available with its corresponding TypeScript input and output types

### Requirement: Shared Zod runtime compatibility
The package SHALL declare Zod 4 as a required peer dependency and SHALL publish the tested supported peer range so exported schemas and consumer schema composition use a compatible Zod runtime.

#### Scenario: Compatible Zod peer
- **WHEN** a consumer installs the package with a supported Zod 4 version
- **THEN** exported schemas can be parsed, extended, and composed with the consumer's Zod schemas

#### Scenario: Missing Zod peer
- **WHEN** package validation evaluates an installation without the required Zod peer
- **THEN** the installation or package validation reports the unsatisfied peer dependency

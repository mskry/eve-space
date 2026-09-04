## Purpose

Provide bounded and consistently classified ESI transport behavior that consumers can safely compose with their own retry, cache, stale-data, and operational policies.

## ADDED Requirements

### Requirement: Every ESI network exchange is time-bounded

The SDK SHALL apply a configurable positive request timeout to every ESI network exchange and SHALL default that timeout to 10,000 milliseconds. The deadline SHALL cover waiting for the configured fetch implementation and consuming the successful or error response body. Token-provider execution before the transport begins is not part of this deadline.

#### Scenario: Default timeout
- **WHEN** a consumer creates a client without configuring a request timeout
- **THEN** every ESI network exchange uses a 10,000 millisecond deadline

#### Scenario: Custom timeout
- **WHEN** a consumer creates a client with a valid positive request timeout
- **THEN** aggregate and standalone domain calls use that timeout

#### Scenario: Invalid timeout
- **WHEN** a consumer configures a timeout that is non-finite, fractional, zero, negative, or outside the supported integer range
- **THEN** client construction fails before any credential or network activity

#### Scenario: Fetch never settles
- **WHEN** the configured fetch implementation does not settle before the deadline
- **THEN** the SDK rejects the operation with a structured timeout transport error

#### Scenario: Response body stalls
- **WHEN** ESI returns response headers but successful or error response-body consumption does not finish before the deadline
- **THEN** the SDK abandons body consumption and rejects with a structured timeout transport error

### Requirement: Transport failures use a stable structured error

Connection failures, request aborts caused by the SDK deadline, and transport failures while reading a response body SHALL produce a public structured ESI transport error. The error SHALL identify the stable operation ID and whether the failure was a timeout, SHALL preserve the original failure as a non-serialized cause, and SHALL follow the SDK's bounded, credential-safe error serialization rules.

Malformed JSON received through an otherwise completed transport SHALL remain a response-parse failure rather than a transport failure.

#### Scenario: Connection failure
- **WHEN** fetch rejects because ESI cannot be reached
- **THEN** the operation rejects with the stable SDK transport error and identifies the operation

#### Scenario: Deadline abort
- **WHEN** the SDK deadline aborts an ESI request
- **THEN** the transport error identifies the failure as a timeout

#### Scenario: Invalid completed JSON
- **WHEN** ESI completes the response body but its declared JSON cannot be parsed
- **THEN** the operation rejects with the existing response-parse error rather than a transport error

#### Scenario: Authenticated transport failure serialization
- **WHEN** an authenticated request fails in transport and its error is serialized
- **THEN** the serialization contains no access token, authorization header, token-provider value, response body, or other credential material

### Requirement: Conditional not-modified is an explicit outcome

An ESI `304 Not Modified` response SHALL produce a dedicated structured not-modified error rather than a generic HTTP error. The error SHALL include the stable operation ID and immutable, safely normalized response metadata so a consumer can revalidate its own stored representation.

#### Scenario: Conditional request is not modified
- **WHEN** ESI answers a conditional operation with status 304
- **THEN** the SDK rejects with the dedicated not-modified error containing status 304 and response metadata

#### Scenario: Ordinary HTTP failure
- **WHEN** ESI answers with an unsuccessful status other than 304
- **THEN** the existing structured HTTP error behavior applies

### Requirement: Consumers can classify transient ESI failures

The SDK SHALL export a pure classifier that recognizes SDK transport errors and ESI HTTP 5xx errors as transient upstream failures. It SHALL distinguish `304 Not Modified`, throttling responses, response validation failures, request validation failures, authentication configuration failures, and other client HTTP errors from transient upstream failure.

The classifier SHALL NOT perform a retry, sleep, cache lookup, token refresh, health update, or any other side effect.

#### Scenario: Network failure classification
- **WHEN** the classifier receives an SDK transport error
- **THEN** it identifies the error as a transient upstream failure

#### Scenario: Server failure classification
- **WHEN** the classifier receives an SDK HTTP error with a 5xx status
- **THEN** it identifies the error as a transient upstream failure

#### Scenario: Rate-limit classification
- **WHEN** the classifier receives an SDK HTTP error with status 429
- **THEN** it identifies throttling separately and does not identify it as a transient server failure

#### Scenario: Invalid response classification
- **WHEN** the classifier receives an SDK response-parse or response-validation error
- **THEN** it does not identify the error as transient upstream unavailability

### Requirement: The SDK does not choose resilience policy

The SDK SHALL issue one transport attempt per operation invocation. It SHALL NOT persist responses, serve stale data, automatically retry, refresh OAuth credentials, coordinate distributed limits, open an outage circuit, or derive service health.

#### Scenario: Transient request failure
- **WHEN** one operation attempt fails with a transport or server error
- **THEN** the SDK returns that structured failure without issuing another attempt

#### Scenario: Consumer-supplied fetch wrapper
- **WHEN** a consumer supplies a fetch implementation that adds coordination, telemetry, or application headers
- **THEN** the SDK uses that implementation while retaining its public timeout and error contract

## Purpose

Expose deterministic, typed ESI protocol metadata so consumers can implement cache and rate-limit policy without reparsing raw headers or duplicating generated OpenAPI declarations.

## ADDED Requirements

### Requirement: Runtime cache metadata is normalized conservatively

Metadata-enabled operations and structured response errors SHALL expose immutable cache metadata containing available ETag, Last-Modified, Expires, and Cache-Control values plus a validated non-negative `max-age` duration when one can be unambiguously parsed. Raw bounded response headers SHALL remain available for diagnostics.

Malformed or unsupported cache directives SHALL be ignored in normalized fields rather than causing an otherwise valid operation to fail. The SDK SHALL NOT infer a stale window, retention period, storage key, or fallback policy.

#### Scenario: Cache-Control max age
- **WHEN** an ESI response contains a valid non-negative `Cache-Control: max-age` directive
- **THEN** metadata contains that duration as a typed number of seconds

#### Scenario: Conditional validators
- **WHEN** an ESI response contains ETag or Last-Modified validators
- **THEN** metadata exposes each available validator unchanged

#### Scenario: Malformed cache directive
- **WHEN** Cache-Control contains an invalid or ambiguous max-age value
- **THEN** normalized max age is absent and the operation otherwise proceeds normally

#### Scenario: No cache headers
- **WHEN** an ESI response contains no cache metadata
- **THEN** the cache metadata field remains absent

### Requirement: Runtime throttling metadata is typed

Metadata-enabled operations and structured HTTP errors SHALL expose validated `Retry-After`, ESI legacy error-limit, and route-group rate-limit metadata when the corresponding response headers are present. Numeric values SHALL be finite and non-negative; malformed values SHALL be omitted without failing the operation.

Route-group metadata SHALL provide available group, limit, used, and remaining values. A valid delta-seconds Retry-After value SHALL be exposed as seconds; support for HTTP-date Retry-After values MAY be added separately and SHALL NOT be guessed by this change.

#### Scenario: Route-group response
- **WHEN** ESI returns valid route-group limit, used, remaining, and group headers
- **THEN** metadata exposes those fields through one typed route-rate-limit object

#### Scenario: Legacy error budget
- **WHEN** ESI returns valid legacy error-limit remaining and reset headers
- **THEN** the existing typed error-limit metadata remains available

#### Scenario: Retry delay
- **WHEN** ESI returns a valid non-negative Retry-After delta in seconds
- **THEN** metadata exposes the typed delay

#### Scenario: Malformed rate header
- **WHEN** any numeric rate-limit or Retry-After header is malformed or negative
- **THEN** that normalized value is omitted without rejecting the operation

### Requirement: Generated operation descriptions expose reusable ESI policy metadata

The generated operation manifest and descriptions SHALL expose, from the pinned corrected OpenAPI source, each operation's stable ID, HTTP method and path, required scopes, read or mutation classification, conditional-request support, documented cache extensions, declared route-rate-limit group with maximum tokens and window, and maximum request batch size where available.

Missing optional declarations SHALL be represented explicitly rather than filled with guessed values. Unsupported or malformed policy extensions in the source specification SHALL fail generation before replacing generated output.

#### Scenario: Declared route-rate limit
- **WHEN** an OpenAPI operation contains a valid `x-rate-limit` declaration
- **THEN** its generated description exposes the group, maximum tokens, and window

#### Scenario: Legacy-only operation
- **WHEN** an operation has no route-rate-limit declaration
- **THEN** its generated description explicitly records that no route-group declaration is available

#### Scenario: Conditional request support
- **WHEN** an operation declares If-None-Match or If-Modified-Since request parameters
- **THEN** its generated description identifies the supported validators

#### Scenario: Batched request
- **WHEN** an operation's request schema declares a maximum array size
- **THEN** its generated description exposes that maximum batch size

#### Scenario: Invalid policy extension
- **WHEN** the pinned source contains an unsupported or malformed rate-limit or cache policy extension
- **THEN** generation fails before replacing checked generated artifacts

### Requirement: Generated metadata has one reproducible source

Runtime descriptors, serializable operation descriptions, operation search data, generated documentation, examples, and generated tests SHALL derive protocol policy metadata from the same normalized operation model. Clean generation SHALL be deterministic and SHALL leave no hand-maintained per-operation metadata table in the package.

#### Scenario: Policy metadata changes upstream
- **WHEN** a reviewed pinned ESI specification changes an operation's cache, batch, conditional-request, or rate-limit declaration
- **THEN** clean generation updates every affected SDK metadata and documentation surface consistently

#### Scenario: Repeated generation
- **WHEN** generation runs twice from identical pinned inputs
- **THEN** the second run produces no repository diff

### Requirement: Protocol metadata remains policy-neutral

The SDK SHALL expose protocol facts but SHALL NOT use them to allocate storage, construct cache identities, retain private responses, schedule retries, maintain shared buckets, or decide whether a response may be served after expiry.

#### Scenario: Consumer reads operation policy
- **WHEN** a consumer inspects generated cache and rate-limit metadata
- **THEN** inspection performs no network, credential, cache, timer, or coordination side effect

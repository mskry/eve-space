## 1. Confirm The Package Prerequisite

- [ ] 1.1 Verify `integrate-esi-client-workspace` is complete and the SDK is being changed at `packages/esi-client` with its package-local OpenSpec context intact
- [ ] 1.2 Run the imported package's current `pnpm validate` and record a clean behavioral and package-size baseline before changing the SDK

## 2. Bound Every ESI Transport

- [ ] 2.1 Add `requestTimeoutMs` to client options and immutable configuration with a 10,000 millisecond default, positive-safe-integer validation, and non-secret configuration serialization
- [ ] 2.2 Propagate timeout configuration through aggregate and standalone domain construction without expanding unrelated domain dependency graphs
- [ ] 2.3 Implement one deadline spanning configured-fetch settlement and response-body consumption, pass its abort signal to injected fetch, and clear all timers and body resources on every completion path
- [ ] 2.4 Test default and custom deadlines, invalid values, completion below the deadline, a fetch that never settles, and a custom fetch that observes the abort signal
- [ ] 2.5 Test stalled successful and error response bodies, and prove token-provider execution occurs before and outside the ESI transport deadline

## 3. Structure And Classify Failures

- [ ] 3.1 Add credential-safe `EsiTransportError` and serialized transport-error types with stable code, operation ID, timeout/network reason, request/response phase, and non-serialized cause
- [ ] 3.2 Map initial fetch failures, deadline expiry, and response-stream failures to transport errors while retaining completed malformed JSON as `EsiResponseParseError`
- [ ] 3.3 Add credential-safe `EsiNotModifiedError` and serialization with stable code, status 304, operation ID, and immutable response metadata but no response body
- [ ] 3.4 Handle 304 before generic HTTP failure processing and test ETag and Last-Modified revalidation responses through aggregate, standalone, and generic operation calls
- [ ] 3.5 Export `classifyEsiFailure` with the specified transient, throttled, not-modified, invalid-response, permanent, and unknown outcomes
- [ ] 3.6 Add exhaustive classifier tests and prove one operation invocation performs at most one fetch attempt for transport, throttling, and server failures
- [ ] 3.7 Extend error redaction, bounded serialization, declaration, and installed-package tests to cover both new error classes without exposing credentials or bodies

## 4. Normalize Runtime Protocol Metadata

- [ ] 4.1 Extend immutable cache metadata with conservatively parsed non-negative `maxAgeSeconds` while preserving existing raw cache fields
- [ ] 4.2 Add immutable route-rate-limit metadata for group, limit, used, and remaining response headers
- [ ] 4.3 Add typed Retry-After delta-seconds metadata and retain the existing legacy ESI error-limit metadata
- [ ] 4.4 Test complete, partial, absent, duplicate, malformed, negative, fractional, and overflowed cache and rate header cases without rejecting otherwise valid responses
- [ ] 4.5 Test metadata parity across successful metadata-enabled responses and structured HTTP, not-modified, and parse failures while bare domain calls continue returning bare data

## 5. Generate Operation Policy Metadata

- [ ] 5.1 Extend the normalized operation model to represent conditional validators, documented cache extensions, declared or legacy-only route limits, and optional maximum batch size
- [ ] 5.2 Parse and validate `x-rate-limit`, cache, conditional-header, and bounded-array declarations from the corrected pinned OpenAPI source, failing closed on unsupported or ambiguous shapes
- [ ] 5.3 Increment the serializable manifest schema version and generate the policy metadata into operation descriptions from the normalized model
- [ ] 5.4 Propagate the generated fields through operation search data, documentation, examples, accounting, provenance, and generated runtime/type tests without adding a hand-maintained operation table
- [ ] 5.5 Add generation tests for declared and absent route limits, each conditional validator, bounded request arrays, malformed extensions, stable ordering, and complete operation coverage
- [ ] 5.6 Run clean generation twice and verify the second run produces no diff

## 6. Document And Validate The SDK

- [ ] 6.1 Update client, metadata, error, operation-discovery, custom-fetch, and standalone-domain documentation and compilable examples for the new public behavior
- [ ] 6.2 Update README and changelog with the 10-second default, timeout override, failure classifier, 304 handling, policy-neutral boundary, and the observable change from unbounded requests
- [ ] 6.3 Run formatting, type-aware linting, TypeScript 7 checks, all unit and generated tests, documentation and example checks, build, publint, ATTW, and generated-drift validation
- [ ] 6.4 Run pack inspection, update package budgets only for reviewed generated metadata growth, and verify all root and domain entries retain their accepted runtime and declaration graphs
- [ ] 6.5 Install the packed tarball into the smoke fixture and verify timeout, error, metadata, aggregate, standalone-domain, and generic-operation imports through the published package surface
- [ ] 6.6 Run the monorepo consumer typechecks and ESI resilience tests against the workspace package, and confirm no cache, retry, OAuth, persistence, distributed coordination, health, or circuit implementation entered the SDK
- [ ] 6.7 Confirm no npm publication or release-tag mutation occurs during implementation

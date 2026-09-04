## Context

See `proposal.md` - Why and the two capability specs. All aggregate and standalone domain methods converge on `executeOperation`, which currently resolves authentication, invokes the configured fetch function without a signal or deadline, extracts response metadata, reads the body, and constructs structured HTTP, parse, and validation errors.

The SDK already accepts an injected fetch implementation and already exports immutable metadata, structured credential-safe errors, a generated operation registry, and serializable operation descriptions. EVE Space wraps fetch to coordinate requests and collect telemetry, then independently owns response envelopes, revalidation, retry, cooldown, and stale fallback.

This change follows `integrate-esi-client-workspace`. The SDK remains MIT licensed and independently publishable from `packages/esi-client`, but its implementation and EVE Space adoption can then be reviewed atomically.

## Goals / Non-Goals

**Goals:**

- Give every SDK consumer a bounded transport and stable errors without requiring a fetch wrapper.
- Preserve custom fetch composition and the existing bare-data versus metadata-enabled return shapes.
- Generate and normalize protocol facts once so consumers can implement policy without duplicating ESI parsing.
- Keep errors and metadata immutable, bounded, and credential-safe.

**Non-Goals:**

- Retrying requests or deciding which operations are safe to retry.
- Caching data, constructing cache keys, serving stale responses, or setting retention.
- Managing OAuth access or refresh tokens beyond invoking the existing token provider.
- Implementing local or distributed rate limiting, health, telemetry, or circuit state.
- Adding user-agent configuration in this change.

## Decisions

### 1. Add one client-level transport deadline

Add `requestTimeoutMs` to `EsiClientOptions`, immutable client configuration, standalone domain factories, serialized non-secret configuration, documentation, and generated type tests. It defaults to `10_000` and accepts only positive safe integers.

Start the deadline immediately before invoking the configured fetch implementation, after request construction and token-provider resolution. Keep it active until the response body is fully consumed or cancelled. The implementation combines an abort controller with a deadline race so a custom fetch that never settles still causes the public operation promise to reject; the signal is passed to injected fetch so a conforming wrapper can stop its underlying work.

The SDK owns this deadline rather than EVE Space's wrapper because every consumer otherwise has to solve the same unbounded transport problem. The token provider remains outside the deadline because it is consumer-supplied authentication work rather than ESI transport; consumers remain responsible for bounding that provider.

*Alternative considered:* separate connect, read, write, and pool timeout options like HTTPX. Rejected because Fetch does not expose those phases portably. One end-to-end transport deadline is enforceable across Node and browser-compatible fetch implementations.

*Alternative considered:* no SDK default. Rejected because an opt-in timeout leaves the default client unbounded, which is the defect this capability removes.

### 2. Normalize transport and not-modified outcomes in the SDK

Add `EsiTransportError` with code `ESI_TRANSPORT_ERROR`, stable operation ID, `reason: 'timeout' | 'network'`, and `phase: 'request' | 'response'`. Preserve the original cause on the Error instance but exclude it from `toJSON()`.

Track whether the deadline fired so a timeout is identified without depending on runtime-specific DOMException messages. Wrap initial fetch rejection and failures while reading either success or error bodies. A completed body containing malformed JSON remains `EsiResponseParseError`; transport termination while reading JSON becomes `EsiTransportError`.

Handle status 304 before the generic non-success branch and throw `EsiNotModifiedError` with code `ESI_NOT_MODIFIED`, status 304, stable operation ID, and immutable response metadata. It carries no response body.

*Alternative considered:* leaving raw fetch errors for the injected transport to normalize. Rejected because callers then cannot write portable policy against SDK errors, and body transport failures occur after the fetch wrapper has returned a Response.

*Alternative considered:* returning a success union for 304. Rejected because ordinary domain methods promise operation data, which 304 does not contain. A dedicated error preserves existing promise shapes while making the control-flow outcome explicit.

### 3. Export classification, not retry execution

Export `classifyEsiFailure(error)` returning one of:

- `transient` for `EsiTransportError` and `EsiHttpError` status 500-599
- `throttled` for `EsiHttpError` status 429
- `not-modified` for `EsiNotModifiedError`
- `invalid-response` for response parse or validation errors
- `permanent` for known request, authentication, mutation-safety, unknown-operation, and other HTTP 4xx errors
- `unknown` for values outside the SDK error hierarchy

The function is pure and exhaustively tested. It does not imply that an operation is idempotent or that a consumer should retry it.

Internal retries are deliberately excluded. EVE Space must be able to serve an eligible stale envelope after the first failed attempt; an SDK retry loop would hide attempts, consume rate budget, and delay that decision.

### 4. Extend response metadata with parsed protocol facts

Preserve existing raw bounded headers and fields. Add these optional immutable fields:

```ts
interface EsiCacheMetadata {
  readonly etag?: string;
  readonly expires?: string;
  readonly lastModified?: string;
  readonly cacheControl?: string;
  readonly maxAgeSeconds?: number;
}

interface EsiRateLimitMetadata {
  readonly group?: string;
  readonly limit?: number;
  readonly used?: number;
  readonly remaining?: number;
}

interface EsiResponseMetadata {
  // Existing fields remain.
  readonly retryAfterSeconds?: number;
  readonly rateLimit?: EsiRateLimitMetadata;
}
```

Parse only unambiguous non-negative numeric forms. For Cache-Control, accept one valid unquoted `max-age` directive; duplicate, quoted, negative, fractional, overflowed, or otherwise malformed values remain available only in the raw header. Parse Retry-After only as delta-seconds in this change. Do not calculate an absolute freshness timestamp because fallback clocks and stale retention belong to the consumer.

The same metadata extraction path feeds successful metadata-enabled responses and structured HTTP/not-modified/parse errors. Normal data-returning domain calls remain bare data.

### 5. Generate operation policy metadata from the normalized model

Extend the normalized operation model and serializable manifest with:

- supported conditional request validators derived from declared request headers
- cache extensions already present in the corrected pinned specification
- `rateLimit` as either a validated declared group with maximum tokens and window or an explicit legacy-only value
- maximum batch size derived from the bounded array request parameter or body schema when one unambiguous operation limit exists

The generator validates extension shapes and fails closed before replacing generated files. The manifest, descriptions, search documents, generated documentation, and tests consume the same normalized values. Increment the manifest schema version because its serialized shape changes.

Required scopes, HTTP method/path, and read/mutation classification already live in generated metadata and remain unchanged. Consumer aliases, cache identities, fallback freshness when headers are absent, retry attempts, and stale retention do not move into the SDK.

*Alternative considered:* keep a hand-maintained EVE Space operation table. Rejected for protocol facts available in the SDK's pinned OpenAPI input; hand-maintained application policy remains appropriate only for facts the upstream description cannot supply or for deliberate product decisions.

### 6. Preserve injected fetch as the composition boundary

The configured fetch implementation continues to receive the final URL and request init, now including the SDK deadline signal. EVE Space can retain its permit acquisition, response telemetry, cooldown updates, and application identification headers in that wrapper.

The SDK does not assume the wrapper is trustworthy or signal-aware: its public operation promise still rejects at the deadline. Documentation warns wrapper authors to forward and observe the signal so abandoned work does not continue in the background.

## Risks / Trade-offs

**A 10-second default changes previously unbounded behavior** -> Treat it as a documented 2.0.0 behavior decision, permit explicit positive overrides, and test slow but valid responses below the deadline.

**A custom fetch can ignore abort and continue background work** -> Race the public promise for bounded caller behavior, pass the abort signal, document the wrapper contract, and test the standard/global fetch path separately from a deliberately non-cooperative mock.

**Transport termination during JSON parsing can resemble malformed JSON** -> Track deadline state and classify recognized stream/abort failures as transport while retaining syntax failures as parse errors; cover both cases with deterministic streams.

**Generated extension shapes may drift** -> Normalize through one validated model and fail generation before output replacement when policy metadata is unsupported or ambiguous.

**Consumers may mistake classification for retry advice** -> Name and document the return values as failure facts, explicitly exclude idempotency, and provide no automatic retry helper.

**Additional manifest fields increase package size** -> Include them in existing aggregate and per-entry package budgets and inspect the packed artifact before release.

## Migration Plan

1. Complete and validate `integrate-esi-client-workspace` without changing SDK behavior.
2. Add timeout configuration and structured transport/not-modified errors with focused runtime, type, serialization, and secret-redaction tests.
3. Add pure failure classification and prove one invocation still performs at most one fetch attempt.
4. Extend runtime response metadata parsing and its success/error parity tests.
5. Extend normalized generation and regenerate manifests, search data, documentation, examples, tests, and provenance.
6. Run clean generation twice, complete package validation, inspect the packed artifact, and update the 2.0.0 release notes without publishing.
7. Adopt the SDK primitives in EVE Space: retain its custom fetch coordination/telemetry, remove duplicate timeout/error parsing, and keep all authorization, cache, stale, retry, health, and SSO behavior in the application.

Rollback before publication is a normal revert of this change. After publication, consumers that require a longer deadline can configure one; returning to an unbounded default requires a new explicit compatibility decision rather than a silent patch.

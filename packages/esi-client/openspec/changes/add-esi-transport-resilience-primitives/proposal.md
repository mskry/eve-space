## Why

The SDK currently leaves network requests unbounded and exposes fetch failures as runtime-specific exceptions, forcing every consumer to wrap its transport before it can implement reliable retry, stale-data, or health policy. It also leaves reusable ESI cache and rate-limit metadata partly raw or absent from generated operation descriptions, causing consumers to duplicate protocol interpretation.

## What Changes

- Add a validated, configurable request timeout with a documented 10-second default for every ESI operation, including response-body consumption.
- Add structured SDK errors for transport failures and conditional-request `304 Not Modified` outcomes, preserving operation identity and safe response metadata without leaking credentials.
- Export pure failure classification that identifies transient ESI transport/server outcomes without choosing whether a consumer retries, serves stale data, or fails.
- Normalize response cache, `Retry-After`, legacy error-limit, and route-group rate-limit headers into typed response metadata while retaining bounded raw headers.
- Extend generated operation descriptions with reusable OpenAPI policy metadata, including conditional-request support, cache extensions, batch limits, and `x-rate-limit` declarations where present.
- Preserve injected `fetch` support so consumers can add coordination, observability, and platform-specific headers around SDK requests.
- Explicitly leave response storage, stale fallback, retries, OAuth token lifecycle, distributed throttling, health reporting, and circuit breaking to consumers.

## Capabilities

### New Capabilities

- `transport-resilience`: Bounded ESI requests, structured transport and not-modified outcomes, and transport-level failure classification.
- `esi-protocol-metadata`: Typed runtime response metadata and generated operation metadata needed by consumer cache and rate-limit policies.

### Modified Capabilities

None.

## Impact

The public `EsiClientOptions`, structured error hierarchy, response metadata types, generated operation manifest, documentation, and examples will gain additive APIs. The default timeout changes previously unbounded behavior, so release notes must call out the observable runtime change even though existing source-compatible client construction remains valid. No cache implementation, persistence adapter, retry loop, OAuth client, or application policy will be added to the npm package.

This change is authored in the SDK's package-local OpenSpec context and follows the behavior-preserving import of the SDK into the EVE Space monorepo. It must be applied from `packages/esi-client` after that import, not as part of the repository migration.

# EVE Space Adoption Contract

The root OpenSpec change `deepen-esi-module-interface` owns application adoption of these package primitives and the source-module rename from `api/src/esi-resilience` to `api/src/esi-gateway`. This package does not own or perform that rename.

## Transport Composition

EVE Space must pass its validated `ESI_REQUEST_TIMEOUT_MS` value as `requestTimeoutMs` when constructing aggregate or standalone SDK clients. The application currently defaults that deployment setting to 30 seconds; adoption must preserve the explicit deployment value rather than silently switching to the SDK's 10-second default.

The SDK starts its deadline after token-provider resolution and passes the composed deadline/caller signal to the configured fetch as `init.signal`. `createEsiTransport` must forward and observe that signal. It must continue to own application identification headers, distributed permit acquisition and renewal, response observations, cooldown persistence, and telemetry. A permit covers the complete upstream response-body lifecycle and is released only when the body closes, errors, or is cancelled.

After adoption there must be one effective deadline around one SDK attempt. Remove the transport wrapper's competing timeout only after the SDK receives the deployment value and the application tests preserve timeout and permit-lifetime behavior.

## Replacement Mapping

| Application-local behavior                         | SDK replacement                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Local transport error                              | `EsiTransportError` with `reason`, `phase`, optional status/metadata, and non-serialized cause |
| Status-based `304` inspection                      | `EsiNotModifiedError` with status 304 and immutable metadata                                   |
| Retry/error categorization                         | `classifyEsiFailure`, followed by application-owned idempotency and retry policy               |
| Raw `Cache-Control` max-age parsing                | `EsiResponseMetadata.cache?.maxAgeSeconds`                                                     |
| Raw `Retry-After` parsing                          | `EsiResponseMetadata.retryAfterSeconds`                                                        |
| Raw route-group response headers                   | `EsiResponseMetadata.routeRateLimit`                                                           |
| Duplicated operation cache/rate/batch declarations | `describeOperation(id)`, `searchOperations()`, or `operationRegistry[id].transport.protocol`   |

The package's pinned OpenAPI document declares conditional request headers but does not declare `304` response contracts. Generated protocol facts therefore describe supported request validators without claiming that an operation declares a `304` response.

## Application-Owned Policy

The `esi-gateway` remains responsible for retry orchestration and jitter, idempotency decisions, cache identities and storage, stale fallback, authorization-generation binding, OAuth token lifecycle, distributed cooldowns and concurrency permits, request collapsing, telemetry, health reporting, and circuit or degraded-mode state. SDK failure classifications and protocol metadata are facts only; inspecting them performs no network, storage, timer, credential, or coordination side effect.

The later source rename must preserve the `esi-resilience` capability name and existing Redis key prefixes because they are persisted compatibility contracts rather than source-module identifiers.

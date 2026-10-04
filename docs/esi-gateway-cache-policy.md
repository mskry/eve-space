# ESI Gateway Cache and Protocol Safeguards

- Live `GetUniverseBloodlines` data can contain nullable `ship_type_id` values that conflict with the SDK 3.1.0 schema. Response validation is disabled only for that operation; do not broaden the exception.
- Cacheable ESI resources derive freshness from ESI `Expires` or `Cache-Control` metadata and use their reviewed operation contract only as the fallback when response metadata provides no usable boundary.
- Preserve conditional requests using ETag or Last-Modified and reuse cached data on `304`.
- Do not refresh ESI resources before their expiry. Respect `Expires`, `ETag`/`If-None-Match`, and `Last-Modified`; bypassing ESI caching can result in a ban.
- Preserve concurrent request collapsing, `429` cooldowns using `Retry-After`, ESI error-budget cooldowns, and stale fallback behavior.
- Distributed operation concurrency permits cover the complete upstream response body lifecycle. Keep renewing a permit until the body closes, errors, or is cancelled; fetch returning response headers is not completion. Preserve the configured request timeout and compose it with any caller cancellation signal.
- Avoid preventable ESI errors: 2xx costs 2 bucket tokens, 3xx costs 1, 4xx costs 5 (except 429), and 5xx costs 0. Legacy error-limit headers are `X-ESI-Error-Limit-Remain` and `X-ESI-Error-Limit-Reset`.
- Public and character-owned resource DTOs use bounded L1 plus disposable shared Cache Redis envelopes; private entries are generation-bound and are never served stale in normal operation.
- Treat serialized Cache Redis envelopes as untrusted input. Reject malformed JSON, unsupported envelope versions, invalid shapes, incoherent freshness windows, mismatched authorization generations or resource revisions, and uncommitted fences as cache misses.
- Private entries carry an outage-only stale window bounded by their retention. It is released solely when the refresh failure classifies as `esi-unavailable` or `esi-cooldown`, never on ordinary expiry or on `response-invalid`. Generation binding still applies, so a refreshed or revoked token invalidates the entry regardless.

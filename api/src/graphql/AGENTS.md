# GraphQL dependency direction

The transport adapter owns Hono and Yoga integration. Execution policy, scalars,
errors, and request state depend only on GraphQL, pure contracts, shared value guards and read-value encoding. Schema
composition depends on these leaves and declared read adapters. Request execution owns the
admission, slot-local capability checks and reuse protocol for a bound installed descriptor;
callers provide only request inputs and execute through that operation. Read adapters
depend on the existing authorization and domain owners, never HTTP routes.
No GraphQL module owns a listener, database connection, ESI transport, worker,
or cross-request cache. Feature implementations enter through generated module
composition only. Exact imports and cycles are enforced by
`scripts/verify-graphql-boundaries.ts`.

Core character schema adapters depend on shared auth admission and character-owned page readers.
The character SDL is a pure leaf shared with offline generation; it imports no readers or runtime state.
Their immutable subject closures keep the original lifecycle/revision for nested assets reads.
Core backend work uses the request's shared admission directly; orchestration must not occupy a
concurrency slot while awaiting nested work that needs the same slot.

The route composition owner supplies live member-session reads, shared request work and safe host
diagnostics. The host adapter owns bounded HTTP processing and final headers. Cache verdict state
is request-local; response serialization and error redaction are leaves. Module resolver reuse
does not acquire a backend slot; each granted capability does, with queued authority rechecks.

The GraphiQL renderer is a transport leaf. It uses the standard self-hosted Yoga viewer with
memory-only editor state. It depends on no installed inventory, application field names or
authorization decisions; introspection and execution pass through the existing endpoint gates.

Aggregate inventory execution resolves exact generated consumers through the platform inventory
capability owner. Request-local parent bindings carry the original inventory authority and source
clock checks into nested row projections; projection authentication cannot replace aggregate
admission. Cursor decoding and provider/source pagination remain below GraphQL transport, and
no request-local inventory binding or result survives a request.

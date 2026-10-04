# Gateway mutation invalidation and recovery

The gateway retains its registered core execution and platform execution interfaces. A representation and invocation select one path. Reviewed shared operations have distinct canonical core and validated platform wire representations; the allowlist in `scripts/verify-esi-egress.mjs` requires both registrations. Mapper and schema meaning changes increment the operation catalog's representation version, which also invalidates that operation's platform wire caches.

## Mutation contract

A revision-sensitive mutation registers a unique intent in durable coordination Redis after authorization and before ESI dispatch. Registration must be acknowledged; a failed or lost reply fails the mutation before dispatch. Cache Redis stores no recovery intent.

Before dispatch, cancellation prevents upstream execution and finalizes any acknowledged intent. Once dispatch starts, settlement and the existing mutation retry policy run independently of caller cancellation. The gateway preserves the upstream outcome, keeps the existing successful-after-cancellation behavior, and awaits invalidation before returning. It conservatively advances the revision for every settled registered intent, including definitive failure or cancellation before egress. Failed invalidation returns the existing revision-unavailable error and retains the durable intent.

Completion atomically increments the revision and removes only its own intent. It is idempotent after a lost reply: retrying a completed token does not increment again. Concurrent mutations retain separate tokens; completing one cannot make the other's resource cacheable.

Revision resolution atomically checks pending intents and reads the revision. Revision resolution while any intent remains makes all runtimes bypass L1, L2, conditional cached validators and cache publication for that resource principal. Reads admitted before intent registration may finish under their earlier revision; their publications retain that earlier identity and cannot be reused after completion advances the revision. They may return a newly fetched uncached result under normal scope, deadline and quota controls. This protects against disposable cache eviction, cache restarts and stale L1 values in another runtime.

The originating runtime retries completion three times with bounded delays. It retains up to 1,000 settled intents for automatic repair on later reads of the same principal and namespace. Local repair entries are disposable: losing or overflowing them can reduce cache availability but cannot restore cache eligibility. Durable intents have no TTL.

## Orphan recovery

An intent may outlive its runtime after a crash, forced shutdown, lost registration reply or exhausted finalization retries. The gateway cannot infer from another runtime's absence whether upstream work has settled. It therefore keeps cache reuse suspended until safe recovery; a fresh read cannot clear another runtime's intent.

1. Stop mutation admission and drain every API and worker runtime that can execute the affected operations. For forcibly terminated runtimes, establish that their outstanding ESI attempts have settled before clearing intent. A Redis connection recovery alone does not prove this.
2. Inspect the affected `eve-space:v2:esi-resilience:revision:<namespace>:<principal>:pending` set through the authorized coordination connection. Principals and namespaces are existing reviewed gateway identities, such as `mailbox` and `character-90000001`; tokens contain no credentials.
3. Complete each recorded token using `completeEsiResourceMutation` from `internal/coordination.ts`, with its exact namespace and principal. The helper atomically advances the resource revision and removes that token. Do not delete the set directly or reset the revision counter.
4. Verify `getEsiResourceRevision` succeeds, then resume admission. Requests use the advanced identity and refill under normal ESI caching and quota rules.

This procedure intentionally requires quiescence. Never expire intent, erase it because Cache Redis is empty, or flush the shared Queue/coordination Redis instance. Revision exhaustion requires a separately reviewed namespace recovery; it must not remove a pending gate while work remains active.

## Deployment and rollback

Cache identity advances from v3 to v4 to reject envelopes produced under the former invalidation contract. Envelope format and coordination keys remain compatible. Deploy with every old API and worker runtime drained: old runtimes do not understand pending intents and cannot participate safely in a mixed rollout. Before enabling the new runtimes, ensure any earlier uncertain mutations have settled; the cold v4 cache prevents reuse of earlier representations.

For rollback, quiesce and reconcile pending intents first, then rotate the coordination cache sentinel before restarting old runtimes so retained old-version envelopes cannot return. Preserve durable revisions, cooldowns, leases, BullMQ state and database data. An older build restores the defects corrected here and is not a safe long-term invalidation policy.

## Shutdown and enforcement

Cache-collapse leases retain their own renewal lifecycle, separate from upstream permits. Only one lease-renewal command is issued at a time. Finalization stops further scheduling, joins any issued command even when it rejects, then releases the lease. Runtime close waits for those finalizers before clearing local state or closing owned connections.

The egress verifier recognizes literal ESI URLs, same-file constants and concatenations, and ordinary aliases of `fetch` or `globalThis.fetch`, including static element access. It is a bounded AST check, not a complete JavaScript data-flow proof: inter-file helpers, arbitrary runtime strings, destructured aliases and computed callees require source review and the independent gateway boundary check.

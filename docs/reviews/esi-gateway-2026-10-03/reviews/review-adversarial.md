# Adversarial architecture review: ESI gateway

Verdict: the gateway's principal ownership, representation identity, and single-egress boundaries are coherent, but mutation uncertainty and lifecycle recovery have three concrete contract gaps. Resolve these before ratifying the architecture without qualifications.

Scope: registered feature execution, shared read cancellation, authorization-generation checks, revision invalidation, Cache Redis/coordination Redis separation, and runtime close. Existing guides were evaluated as consistency contracts rather than requiring AD-n formatting. This review makes no unauthorized-access or secret-exposure claim.

## A1 — HIGH: cancellation hides an uncertain dispatched mutation and skips invalidation

Location: `api/src/esi-gateway/internal/execution-runtime.ts:1166`; supporting locations `:813`, `:823`, `:573`, and `api/src/esi-gateway/internal/failure-policy.ts:109`.

Trigger: dispatch a registered mailbox mutation, then cancel its caller, then let the attempt fail with a transport error. ESI may already have applied the mutation, including when the response is lost. The mutation transport deliberately runs without the caller signal, but the surrounding retry resource still contains that signal. Its catch checks `throwIfAborted()` before passing the transport failure to mutation outcome classification. The original `EsiTransportError` is replaced by an ordinary cancellation reason. `shouldAdvanceRevisionAfterMutationError` cannot recognize uncertainty, so the mailbox revision is not advanced.

Evidence: the temporary probe dispatched `mail-delete`, canceled with an ordinary Error, and then rejected the fetch with an SDK response-phase transport failure carrying status 204. The registered callable rejected with exactly the cancellation Error; the revision increment spy was never called. Existing `execution-runtime-behavior.test.ts:620` proves success after cancellation, but does not cover a failed or timed-out attempt after cancellation.

Independent-build contradiction: the mutation owner follows the existing rule to let dispatched work finish, while the shared retry owner follows the read rule to prefer caller cancellation. Together they discard the failure identity on which revision fencing depends.

Correction: define the dispatch point at which mutation finalization becomes independent of caller cancellation. Preserve the original attempt outcome through invalidation even if retries or caller release are canceled. Before dispatch, cancellation can reject normally; after dispatch, classify uncertainty and advance/repair the revision before emitting any caller-facing cancellation outcome. Add a focused regression scenario for cancellation followed by uncertain transport failure, including cancellation during retry deferral.

Triage: discuss the explicit mutation cancellation contract, then fix implementation. This is cache consistency, not an authorization bypass.

## A2 — HIGH: disposable cache owns the only cross-replica repair signal

Location: `api/src/esi-gateway/internal/resource-revision.ts:106`; supporting locations `:104`, `:118`, and `:68`.

Trigger: ESI accepts a mailbox mutation, but all three coordination revision increments fail. The writer clears only its own L1 and remembers the pending repair in a local set plus a Cache Redis marker. If the disposable cache subsequently loses that marker, another live replica sees no repair requirement and resolves the unchanged coordination revision. Its existing fresh L1 mailbox entry still matches that revision and is served.

Evidence: the temporary two-runtime probe populated reader B's L1, applied a successful 204 mutation through writer A, forced all revision increments to fail, and confirmed A wrote a repair marker. Clearing the simulated disposable Cache Redis then caused B to return the pre-mutation value with `source: 'cache'`; no additional revision increment or upstream read occurred. The writer remained alive, so this does not depend on an additional process crash. The test `execution-runtime-behavior.test.ts:531` exercises recovery on the same writer while the marker remains; it does not test marker loss and another replica's L1.

Independent-build contradiction: cache operations are authorized to evict/restart disposable state, while revision execution assumes a missing marker proves no outstanding invalidation. The marker is a correctness barrier, yet its lifetime has the semantics of disposable data. Root instructions explicitly keep durable fencing/coordination responsibilities out of Cache Redis.

Correction: choose a recovery owner whose evidence survives loss of the value cache. Persist a bounded mutation/invalidation intent before dispatch if recovery must survive coordination failure or writer death, and gate revision-sensitive reads until that intent is reconciled. Merely moving the marker to the same unavailable coordination instance after the failure does not close the failure window. An alternative explicitly reviewed weaker freshness contract must state how long pre-mutation values remain acceptable and ensure outage stale policy cannot silently extend that window.

Triage: discuss durable repair ownership before implementing. The demonstrated impact is obsolete mailbox data; the HIGH rating reflects a violated cross-process correctness/durability boundary, not a demonstrated security exploit.

## A3 — MEDIUM: issued request-lease renewals outlive runtime close

Location: `api/src/esi-gateway/internal/execution-runtime.ts:1266`; supporting locations `:1117` and `:1448`.

Trigger: a request-collapse lease renewal starts and remains pending while upstream execution completes. `#renewLease` discards the renewal promise. Its stop function only prevents future timer ticks; `#loadAndStore` releases the lease without joining an already-issued renewal. The operation exits the tracked active set and `close()` resolves while that renewal still uses coordination dependencies.

Evidence: the temporary probe started a renewal backed by an unresolved promise, finished the source response, then awaited execution and runtime close successfully before resolving the renewal promise. Existing `runtime-lifecycle.test.ts` covers an in-flight concurrency-permit renewal through the Effect lifecycle; that is a separate renewal owner and does not test the collapse lease.

Independent-build contradiction: a shutdown owner follows the stated `close()` boundary and closes process-owned Redis after it resolves, while the lease owner still has accepted asynchronous work using Redis. The scoped permit solution does not extend to collapse leases. `api/src/esi-gateway/AGENTS.md:26` requires runtime close to await issued renewals before process-owned dependencies close.

Correction: make the lease renewal owner retain issued promises, prevent overlapping renewal calls, stop admission of further ticks, and await the last issued renewal before lease release and completion of the tracked source. Keep permit ownership and request-collapse lease ownership distinct, with one lifecycle completion guarantee for both.

Triage: fix; the policy already settles the decision.

## Validation and limits

Command: `pnpm --filter @eve-space/api test tests/esi-gateway/architecture-adversarial-probe.test.ts`.

Outcome: 1 test file, 3 tests passed, 862 ms. These assertions demonstrate the current counterexamples; they are not passing assertions of desired repaired behavior. Probe source is preserved at `/tmp/eve-space-esi-architecture/architecture-adversarial-probe.test.ts`; exact runner output is at `/tmp/eve-space-esi-architecture/adversarial-probe.log`. The temporary repository test was removed after execution. No production code or existing tests were modified by this reviewer.

Graph Verify limitation: inherited graph generation was three commits behind HEAD. A reviewer GitNexus query for renewal/repair/mutation/revision returned useful symbol locations mixed with corrupted names/paths and reported the same staleness. No coverage tool was exposed. All material claims above were verified against current source and temporary behavioral probes; no absence or exhaustive call-graph claim relies on that index.

No findings claimed for representation-name isolation, operation-specific array projectors, platform wire-data mapping after caching, or per-private-caller authorization-generation recheck: their inspected implementation and focused existing tests provide positive evidence of the intended boundaries. This is a bounded review, not proof that every catalog entry or authorization race is safe.

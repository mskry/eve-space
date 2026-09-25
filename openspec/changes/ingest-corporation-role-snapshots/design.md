## Context

See `proposal.md` for motivation and the delta specs for required behavior. The registered `character-corporation-roles` representation already validates and caches `GetCharactersCharacterIdRoles`, returns all four role locations, binds private cache entries to token authorization generation, and exposes upstream validation and freshness metadata. Its application cache identity currently contains only the character ID, so a fresh response populated before a corporation change can remain reachable afterward when lifecycle and authorization generation do not change. Organization-owner, derived-Director, and corporation-source workflows each call that read independently and persist only a consumer-specific `director_role_present` result plus a `role_evidence_revision` currently derived from the ESI validation timestamp.

PostgreSQL already owns character lifecycles, organization versions, affiliation observations, authority sources, policy deadlines, queue reconstruction, and transactional domain events. Cache Redis is disposable and cannot become authorization state. Queue Redis may lose derived role jobs, so due work must remain reconstructible from PostgreSQL. Raw corporation roles are private ESI evidence and cannot cross into module storage, browser responses, jobs, events, audits, telemetry, or logs.

The ESI role response does not identify the corporation to which the roles apply. The application must therefore bind it to a separately validated affiliation observation and accept that the two upstream resources do not provide one atomic snapshot.

## Goals / Non-Goals

**Goals:**

- Establish one durable current role observation for each demanded source binding.
- Give every role consumer one opaque semantic revision and one clock-enforced freshness decision.
- Collapse duplicate owner, derived-authority, and corporation-source role refreshes.
- Make semantic role loss fail closed before asynchronous consumers repair their projections.
- Preserve current ESI cache, quota, retry, cooldown, token, and worker ownership boundaries.
- Migrate existing fresh authority without an unbounded legacy path or a forced upgrade outage.

**Non-Goals:**

- Generate or propagate operation-specific `x-required-roles` metadata; the corporation-resource change owns that integration.
- Map EVE roles directly to application permissions, groups, or external-provider roles.
- Expose raw role observations to modules, routes, clients, audits, or operators.
- Add a corporation role-history ESI operation or poll every corporation member.
- Guarantee atomic consistency between independent ESI affiliation and role resources.
- Change the existing organization authority policy ranges or ESI operation cache contract.

## Decisions

### 1. Persist one current private observation per authority binding

Add an organization-versioned PostgreSQL observation keyed by deployment, organization version, character ownership lifecycle, affiliation period revision, authority corporation, and authorization generation. It records the account and character identity, affiliation observation time, required scope, opaque role revision, canonical role arrays, ESI validation time, ESI freshness boundary, effective fresh deadline, optional degraded deadline, next refresh time, last applied observation sequence, status, sanitized failure class, and audit timestamps.

The row is the only retained raw role content for that binding. A semantic change replaces its canonical arrays and rotates its revision in place. Lifecycle, owner, affiliation-period, organization-version, corporation, authorization-generation, or strict authorization invalidation clears the raw arrays but retains a content-free ordering tombstone with the opaque revision, last applied observation sequence, invalidation outcome, and binding needed to reject older in-flight results. Existing authority provenance retains only the old opaque revision and sanitized outcome.

This keeps authorization reads shallow and avoids indefinite private role history. Historical debugging uses content-free authority provenance and events rather than retained raw snapshots.

Alternative considered: append every validation as an immutable snapshot. Rejected because unchanged hourly observations would create unbounded private-data growth and consumers need only current content plus opaque historical provenance.

Alternative considered: store only a `Director` boolean on each consumer. Rejected because it duplicates refresh authority, cannot represent future reviewed role predicates, and cannot prove that several consumers evaluated the same current observation.

### 2. Fence role caching with an affiliation period revision

Add an opaque affiliation period revision to the durable character affiliation projection. Seed current characters during migration, preserve the revision when fresh affiliation revalidation returns the same corporation and alliance, and rotate it whenever either value changes. Affiliation convergence invalidates role observations and dependent authority bound to the replaced period.

Include the affiliation period revision in the registered role-read input and application cache identity, and increment the representation version so envelopes written under the former character-only identity are unreachable. A role attempt captures the current period before execution. The returned evidence carries that period, and persistence requires it to equal the locked current affiliation period.

This prevents a still-fresh application cache envelope populated for corporation A from becoming a new observation for corporation B when character lifecycle and authorization generation remain unchanged. It cannot make ESI's independently cached affiliation and role resources atomic, but it proves that the application resolved the role response under the current affiliation period rather than rebinding a response from a known prior period.

Alternative considered: include `affiliationCheckedAt` in cache identity. Rejected because unchanged affiliation checks would create needless cache identities and upstream role requests; the period revision changes only with the authority binding.

Alternative considered: clear PostgreSQL role evidence after affiliation change without changing cache identity. Rejected because the next read could immediately repopulate it from the still-fresh old application cache envelope.

### 3. Use a random semantic revision, not validation time or a content hash

Canonicalize each of the four role arrays by deduplicating and sorting their validated values. Compare canonical arrays and authority-binding fields inside the persistence transaction. Preserve the current random UUID revision for an unchanged observation and rotate it only when canonical content or its authority binding changes.

Keep `validatedAt`, `esiFreshUntil`, `freshUntil`, and `lastCheckedAt` separate from the semantic revision. A conditional `304` or equivalent unchanged validation advances those times without making queued work obsolete merely because time advanced.

A content hash is not exposed as the revision. Corporation roles come from a finite enumerable set, so an exposed deterministic hash could permit guessing private role combinations. If an internal comparison fingerprint is later measured as necessary, it must remain internal and keyed; canonical array comparison is sufficient initially.

Alternative considered: retain the current ESI `validatedAt` string as `roleEvidenceRevision`. Rejected because routine unchanged revalidation rotates consumer identities and causes unnecessary invalidation and queue churn.

### 4. Keep observation and predicate evaluation behind the character boundary

Extend the character corporation-role module with a persistence-oriented observation use case and a narrow evaluator. Callers provide the expected source binding and a reviewed role predicate; they receive only opaque revision, deadlines, status, and predicate outcome. The raw arrays never leave the owning module.

Bootstrap owner claims, source registration, and source replacement may request an immediate observation through this use case. Scheduled execution uses the same persistence path. The module accepts a transaction hook for organization convergence, following the existing affiliation-persistence pattern, so character code does not import organization orchestration.

Operation descriptor generation and the platform's eventual mapping from `x-required-roles` to the reviewed predicate remain in the dependent corporation-resource change. EVE-7 supplies the durable evidence and evaluator, not module-visible role data.

Alternative considered: expose the persisted role DTO as a core data product. Rejected because no module should inspect raw roles and the platform needs a decision capability, not private evidence transfer.

### 5. Derive refresh demand as a distinct relational classifier

Build one authoritative candidate query from the union of:

- the explicitly claimed current organization-owner source;
- each current registered corporation source; and
- current attached characters with the role scope that are eligible for derived Director evaluation while that policy is enabled.

Deduplicate by organization version, character lifecycle, affiliation period revision, authority corporation, and authorization generation. The classifier returns current expected revision, next refresh time, and stable source binding but no raw roles. It powers point demand checks, deterministic planner pages, and execution-time rechecks so these paths cannot drift.

When no consumer remains, the character stops producing refresh demand. Existing content-free authority history remains.

Initial owner claims, owner-source replacement, corporation-source registration, and corporation-source replacement use explicit one-shot bootstrap intents rather than scheduled demand. An owner bootstrap is bound to the existing state-protected application session, expected character, organization identity, and organization version. A corporation-source bootstrap is bound to current management authority, the exact owned character, target managed corporation, lifecycle, and organization version. Both include the expected authorization generation and required scope.

The ESI fetch may occur before the mutation transaction, but observation persistence and the grant or source transition commit in that same transaction after every bootstrap predicate is rechecked. A failed or superseded mutation persists neither a current observation nor ongoing demand. The character observation API accepts this closed bootstrap-intent union or current relational demand; it has no generic bypass flag.

Alternative considered: schedule every character that ever granted the role scope. Rejected because it violates least privilege, wastes the `char-detail` rate group, and retains private evidence with no current consumer.

Alternative considered: insert temporary scheduled demand before bootstrap. Rejected because failed claims or source mutations would leave unauthorized refresh demand and private evidence with no consumer.

### 6. Plan one derived job at the upstream revalidation boundary

Add one derived corporation-role job keyed by the complete non-secret binding and expected revision. Queue payloads carry only stable identifiers, affiliation period revision, authorization generation, organization version, authority corporation, and nullable expected revision. Queue admission coalesces multiple consumers of the same binding.

Successful persistence records `nextRefreshAt` at the earliest point when the registered representation can produce a newer validation, normally its ESI `cachedUntil`. The planner may select a bounded lead window and enqueue a delayed job for that persisted time; the job rechecks demand and due time before ESI execution. Queue loss is harmless because PostgreSQL preserves the due candidate.

The effective authority `freshUntil` remains the earliest of role ESI freshness, affiliation freshness, authority-corporation freshness, and the current organization authority-evidence duration measured from the accepted ESI validation. If operators configure an authority duration shorter than the ESI cache boundary, authority fails closed at that earlier deadline and does not pretend that a repeated cache read is a new upstream validation. The default one-hour authority duration aligns with the reviewed one-hour role cache fallback.

After a transient failure, retry eligibility is `max(now + 5 minutes, providerRetryAt, cooldownUntil)`. The planner remains bounded by its existing page size, high-water admission, deployment offset, and cooldown checks.

Alternative considered: continue the three existing 20-minute-ahead refresh paths. Rejected because calls made while the shared representation is fresh cannot detect a new role state and repeatedly enqueue equivalent work near expiry.

### 7. Persist observations with optimistic identity and transactional convergence

Allocate a value from a PostgreSQL monotonic observation sequence immediately before every observation attempt that can persist success or failure, including a strict local preflight failure that does not reach ESI. Sequence allocation is independent from the semantic role revision and need not roll back. The attempt carries that value only in trusted worker or request memory. Both successful and failed persistence paths apply only when their sequence is greater than the observation row's `lastAppliedObservationSequence`.

Fetch ESI data outside the database transaction. During persistence, acquire the existing character advisory lock and lock the current observation and relevant source records in stable order. Recheck character owner, lifecycle, organization version, corporation affiliation, affiliation period revision, affiliation observation, authorization generation, required scope, demand or bootstrap authority, expected revision, observation sequence, and clock deadline.

If any binding changed or the attempt sequence is not newer, return `superseded` without mutating evidence. Otherwise compare canonical content, update the current observation and last applied sequence, invoke organization convergence, and append any material domain event in one PostgreSQL transaction. Failure persistence uses the same sequence predicate, so an older transient or strict failure cannot overwrite a newer success, and an older success cannot revive a newer invalidation. Advisory locks serialize commits while the monotonic sequence establishes request order.

Every authorization and corporation-work guard also compares its stored revision with the current observation. Therefore a committed role change fails closed immediately even if a later event handler or repair scan has not run. Transactional convergence keeps the normal projection current; domain events provide recoverable follow-up, not the primary security barrier.

Alternative considered: let a domain-event consumer perform all invalidation after commit. Rejected because at-least-once delivery permits a window in which stale authority could remain effective.

Alternative considered: use only expected semantic revision and transaction locks. Rejected because unchanged revalidation preserves that revision, allowing an older overlapping result or failure to commit after a newer observation.

### 8. Separate semantic role transitions from evidence availability

A fresh successful response accepted under the same binding is the only input that can confirm role gain or loss. Empty validated arrays are authoritative negative evidence. Unavailable, stale, malformed, rejected, or superseded responses never become negative role observations.

Classify known local lifecycle, owner, organization-version, affiliation, authorization-generation, required-scope, and explicit authorization-rejection failures as strict. Strict failure clears current role authority and converges dependents immediately. Treat ambiguous upstream, SSO availability, quota, cooldown, transport, cache, coordination, and response-validation failures as transient unless an existing typed error proves revocation.

Transient failure before `freshUntil` updates only check and retry state. At or after `freshUntil`, it marks evidence degraded until the fixed `freshUntil + staleEvidenceGraceDurationSeconds` boundary. Degraded evidence may support only continuity already allowed by organization access policy. It never admits new authority, governance mutation, source registration or replacement, external synchronization, corporation collection, or materialization. Expiry is enforced by clock even if the worker is down.

Alternative considered: treat `403`, missing responses, or empty cache results uniformly as role loss. Rejected because only validated current ESI role content can safely distinguish revocation from provider unavailability.

### 9. Emit disjoint, content-free material events

On an accepted change with any removed role, append `character.corporation-role-loss-confirmed`. On an accepted change containing additions only, append `character.corporation-roles-changed`. Initial observation converges current authority in its transaction but emits neither change event because no previous role observation exists. Unchanged validation and transient failure emit no material event.

Payloads contain user and character identity, subject lifecycle, affiliation period revision, organization version, authority corporation, authorization generation, and previous plus current opaque revisions. They never contain role names, arrays, predicates, raw ESI data, or cache metadata. Consumers recompute from current PostgreSQL state and remain convergent under duplicate, delayed, or out-of-order delivery.

Alternative considered: include added and removed role names so consumers can react directly. Rejected because events are retained and observable infrastructure records; consumers can evaluate current evidence through the owning capability without copying private role content.

### 10. Use a bounded legacy transition for persisted authority

Existing owner, derived-Director, and corporation-source records contain fresh role outcomes but no reusable raw observation. The migration creates no synthetic role content. It records which source records predate the capability, captures their existing binding and non-extendable deadline, marks each current demanded binding due immediately, and permits exactly the pre-deployment behavior only while no new observation exists, lifecycle, owner, affiliation period, organization version, authorization generation, scope, and role outcome remain unchanged, and the captured `freshUntil` remains in the future.

The fallback cannot be extended, copied, or recreated. The first successful new observation replaces it immediately; confirmed strict failure or any binding change invalidates it; and its original deadline ends it even if backfill never succeeds. New claims, source registrations, replacements, and derived sources always require the new observation path.

This is concrete compatibility for persisted production authority, not a permanent alternate implementation.

Alternative considered: require every existing authority source to become invalid at deployment. Rejected because it creates an avoidable governance outage while the system can safely honor the same previously bounded evidence for at most its remaining lifetime.

## Risks / Trade-offs

- [Affiliation and role responses are independently cached] -> Rotate an affiliation period revision on semantic affiliation change, include it in role cache identity and persisted evidence, bind both observations, use their earliest freshness deadline, and document that ESI cannot provide an atomic cross-resource snapshot.
- [A configured authority duration is shorter than ESI role cache freshness] -> Fail closed at the configured deadline and schedule the next possible upstream validation; do not roll freshness forward from repeated reads of the same cached validation.
- [A large derived-Director candidate set pressures the character-detail rate group] -> Refresh only current policy demand, deduplicate consumers, page deterministically, stagger dispatch, and obey shared cooldown and concurrency controls.
- [A role change races queued organization or corporation work] -> Bind every guard and job to the opaque revision and recheck before execution and materialization.
- [Raw roles leak through observability or integrations] -> Keep arrays inside the character module and schema, use allowlisted DTOs and event schemas, and add negative tests across jobs, events, audits, logs, telemetry, routes, and module capabilities.
- [At-least-once events arrive after a later lifecycle] -> Make consumers convergent from current state and compare lifecycle, affiliation period, organization version, authorization generation, and revision before durable effects.
- [Migration backfill is delayed] -> Prioritize legacy demanded bindings, expose safe aggregate pending/fresh/degraded counts, and let the bounded legacy deadline fail closed rather than extending it.

## Migration Plan

1. Add the ordered observation migration, monotonic observation sequence, affiliation period revision, indexes, constraints, Drizzle schema, private DTO validation, ordering tombstones, and bounded legacy marker derived from existing source deadlines.
2. Rotate affiliation periods on semantic affiliation change, add the period to role cache identity with a representation-version increment, and add canonicalization, opaque role revision, ordered persistence, strict/transient classification, and predicate evaluation behind the character boundary.
3. Add the demand classifier, closed bootstrap-intent union, derived job contract, delayed due-time admission, planner, handler, safe metrics, and queue/domain boundary verification.
4. Add transactional organization convergence and role events, then make owner, derived-Director, corporation-source, authorization, execution, and materialization guards require the current affiliation period and role revision.
5. Migrate synchronous claims and source mutations to atomic shared bootstrap observation; remove their direct raw role reads and retire duplicate scheduled role refresh logic.
6. Deploy migrations and the new worker/API together. Prioritize existing fresh legacy sources, monitor pending/fresh/degraded counts, and verify every legacy fallback disappears by its original deadline.
7. Exercise fresh, unchanged, loss, outage, authorization-generation, affiliation-change, queue-loss, and rollback paths against representative corporation and alliance deployments before enabling dependent corporation resources.

Rollback first stops new API mutations and the role planner, leaves the additive table intact, and lets the new worker drain role events. After no unsupported role events remain pending, the previous API and worker may be restored; their existing source rows and deadlines remain readable. If rollback occurs after the bounded legacy window, affected authority may require EVE revalidation rather than reconstructing raw roles from provenance.

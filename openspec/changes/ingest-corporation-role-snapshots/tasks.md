## 1. Persistence Foundation

- [x] 1.1 Add an ordered PostgreSQL migration for current organization-versioned corporation-role observations and a database-monotonic observation sequence, including canonical role arrays, opaque revisions, last-applied sequence, source binding, freshness and retry state, strict state constraints, deterministic due indexes, and lifecycle/epoch referential integrity.
- [x] 1.2 Add an opaque affiliation period revision to the character affiliation projection, seed existing current periods, preserve it on unchanged revalidation, and rotate it transactionally whenever observed corporation or alliance changes.
- [x] 1.3 Add the matching Drizzle schema and types, keeping raw role columns private to the character evidence module and preserving content-free historical revisions in existing authority tables.
- [x] 1.4 Encode the bounded legacy transition so only source records present at migration are due immediately, retain their captured binding and original deadline, cannot extend or recreate continuity, and are bypassed by a new observation, strict failure, or binding change.
- [x] 1.5 Add PostgreSQL migration and schema tests for affiliation-period rotation, one-current-binding uniqueness, monotonic sequence persistence, state/deadline coherence, lifecycle and organization replacement, raw-content clearing, due ordering, and bounded legacy expiry.

## 2. Character Role Evidence

- [x] 2.1 Add pure canonicalization and comparison for all four ESI role locations, with deterministic explicit string sorting, deduplication, empty-set behavior, and random opaque revision rotation only on semantic or binding change.
- [x] 2.2 Add a narrow role-predicate evaluator and evidence DTO that returns only outcome, revision, source binding, status, and deadlines outside the character module.
- [x] 2.3 Add affiliation period revision to the registered role-read input and application cache identity, increment its representation version, and prove a warm cache entry from a prior corporation period is unreachable after a corporation change with unchanged lifecycle and token generation.
- [x] 2.4 Implement immediate and scheduled observation through the registered `character-corporation-roles` representation, allocating a monotonic sequence before every attempt that can persist success or failure while preserving gateway scope, authorization-generation, cache, cooldown, retry, and cancellation behavior.
- [x] 2.5 Implement transactional observation persistence with the character advisory lock, affiliation-period and expected-revision checks, last-applied sequence fencing for every success and failure update, content-free invalidation tombstones, current lifecycle/owner/organization/corporation/affiliation/generation/scope/demand-or-bootstrap rechecks, and superseded-write rejection.
- [x] 2.6 Implement clock-enforced fresh, degraded, invalid, next-refresh, and retry outcomes, including five-minute minimum transient retry, provider cooldown precedence, strict invalidation, and no negative role inference from unavailable evidence.
- [x] 2.7 Add character evidence tests for unchanged `304` revalidation, reordered arrays, gains, partial and complete losses, successful empty roles, stale responses, warm-cache corporation changes, older-success/newer-success ordering, older-failure/newer-success ordering, older-success/newer-invalidation ordering, strict failures, and cancellation.

## 3. Demand And Worker Execution

- [x] 3.1 Add one relational demand classifier that unions current owner sources, registered corporation sources, and enabled derived-Director candidates, deduplicates complete lifecycle and affiliation-period bindings, and serves point, planner, and execution checks.
- [x] 3.2 Add the derived corporation-role job schema, stable identity, retention and retry policy, affiliation period revision, expected nullable semantic revision, secret-free validation, and queue boundary declarations.
- [x] 3.3 Extend semantic queue admission with a bounded persisted due-time delay so the planner can admit role work ahead of ESI expiry without executing before the observation's `nextRefreshAt`.
- [x] 3.4 Add a bounded deterministic role planner and worker handler that respect queue capacity, coalescing, operation cooldowns, abort signals, execution-time demand, and PostgreSQL reconstruction after queue loss.
- [x] 3.5 Add planner, job-contract, producer, handler, queue-loss, cooldown, deduplication, and multi-consumer tests proving that one current lifecycle and affiliation period causes at most one upstream role refresh.
- [x] 3.6 Update character and queue dependency maps and verifiers for the new modules without allowing character code to import BullMQ, queue adapters, or organization orchestration.

## 4. Organization Authority Convergence

- [x] 4.1 Add a transaction hook that evaluates current role evidence and converges owner, derived-Director, and corporation-source projections in the same commit as an accepted observation or strict invalidation.
- [x] 4.2 Define closed owner-claim, owner-source-replacement, corporation-source-registration, and corporation-source-replacement bootstrap intents; make each immediate observation and consuming mutation commit atomically after exact actor/session, character, lifecycle, affiliation-period, organization, corporation, generation, scope, and authority rechecks.
- [x] 4.3 Refactor scheduled owner, derived-Director, and corporation-source maintenance to consume shared evidence and affiliation state instead of independently fetching raw roles, then remove duplicate role refresh timing and classification logic.
- [x] 4.4 Make organization authorization, source eligibility, queued corporation execution, and materialization compare lifecycle, affiliation period revision, organization version, authority corporation, authorization generation, scope, opaque revision, and clock freshness before using a source.
- [x] 4.5 Preserve explicitly allowed degraded read continuity while denying new authority, governance mutation, source registration or replacement, external synchronization, role-gated collection, and materialization.
- [x] 4.6 Add organization unit and PostgreSQL integration tests for owner and corporation-source bootstrap without prior demand, atomic bootstrap rollback, immediate confirmed loss, stale projection mismatch, multiple independent sources, explicit-grant coexistence, no silent source replacement, degraded deadlines, affiliation-period changes, and organization or authorization generation changes.
- [x] 4.7 Update organization dependency maps and boundary verification for the new demand, convergence, and evidence adapter seams.

## 5. Domain Events And Privacy

- [x] 5.1 Register strict secret-free schemas for `character.corporation-roles-changed` and `character.corporation-role-loss-confirmed` using only safe source identities, affiliation period revision, and previous/current opaque role revisions.
- [x] 5.2 Append the applicable event atomically with semantic observation changes, emitting no event for initial observations, unchanged validation, transient failure, or superseded work.
- [x] 5.3 Add convergent event handlers and repair behavior that tolerate duplicate, delayed, and out-of-order delivery without reviving old lifecycles, generations, revisions, authority, or collection eligibility.
- [x] 5.4 Add event definition, transaction rollback, outbox relay, re-drive, idempotency, and privacy tests that reject role names, role arrays, raw ESI data, validators, cache identities, tokens, and credentials.
- [x] 5.5 Add safe aggregate diagnostics for pending, fresh, degraded, invalid, legacy, and overdue role evidence without exposing source identifiers or private content.

## 6. Migration And Verification

- [x] 6.1 Add rollout tests proving only pre-migration fresh authority can use bounded continuity, its exact captured binding and original deadline remain mandatory, new observations and strict failures end fallback, new mutations require current observations immediately, and fallback cannot be extended, copied, or recreated.
- [x] 6.2 Add end-to-end worker tests covering initial demand, explicit bootstrap without demand, delayed expiry refresh, unchanged revalidation, confirmed loss, ESI outage and recovery, queue loss, overlapping success and failure attempts, warm-cache corporation change, affiliation races, token generation changes, and organization replacement.
- [x] 6.3 Update organization-platform and operational documentation with role evidence ownership, one-hour default cadence, five-minute transient retry, one-hour default degraded window, fresh-only collection policy, safe rollout, and rollback ordering.
- [x] 6.4 Run `pnpm lint`, `pnpm format:check`, `pnpm --filter @eve-space/api typecheck`, `pnpm --filter @eve-space/api test:coverage`, `pnpm --filter @eve-space/api test:redis`, `pnpm --filter @eve-space/api test:postgres`, `pnpm --filter @eve-space/api build`, and `pnpm build` after artifact generation is complete.
- [ ] 6.5 Rebuild the API and worker runtime with `docker compose up -d --build api worker`, verify `docker compose ps`, and probe representative fresh, stale, strict-loss, invalid-payload, and status paths without destroying existing local data.

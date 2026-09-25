## Why

EVE Space currently validates corporation roles only inside owner, derived-Director, and corporation-source workflows, then stores consumer-specific `Director` outcomes rather than one durable authoritative observation. EVE-7 needs a shared source-character role projection so current RBAC and future role-gated corporation operations can detect confirmed role loss, fail closed on stale evidence, and converge without treating disposable ESI cache entries as authority.

## What Changes

- Persist private corporation-role revisions and current observation state in PostgreSQL, bound to the exact character ownership lifecycle, semantic affiliation period, organization version, corporation, and authorization generation that produced them.
- Canonicalize all ESI role locations while exposing only opaque revision and evaluated predicate results outside the character evidence boundary.
- Refresh only characters currently required by organization authority policy or registered corporation-source policy, using the existing worker planner and resilient ESI execution path.
- Separate successful unchanged revalidation, semantic role changes, confirmed role loss, transient provider failure, and definitive authorization failure.
- Make current authority and corporation-source eligibility depend on a fresh matching role revision at authorization, execution, and materialization time.
- Atomically record secret-free material role-change and confirmed-loss domain events with the authoritative PostgreSQL transition.
- Preserve bounded degraded read continuity where existing organization policy explicitly allows it, while denying new authority, governance mutations, new role-gated collection, and materialization from degraded evidence.
- Migrate owner, derived-Director, and corporation-source role checks onto the shared evidence capability without exposing raw roles to modules or browser APIs.

## Capabilities

### New Capabilities

- `corporation-role-evidence`: Authoritative source-character role observations, revision identity, freshness, privacy, refresh eligibility, and confirmed-loss semantics.

### Modified Capabilities

- `organization-access-control`: Bind character-backed organization authority and corporation-source eligibility to current role evidence and make confirmed role loss immediately fail closed.
- `background-jobs`: Plan bounded reconstructible corporation-role refresh work from authoritative PostgreSQL demand state.
- `domain-events`: Record material role changes and confirmed role loss atomically through secret-free, idempotently consumed events.

## Impact

- Adds an ordered PostgreSQL migration and Drizzle schema for private role revisions and current evidence state.
- Adds character-domain persistence and refresh orchestration, queue contracts, planner selection, and worker handling.
- Changes organization owner, derived-Director, corporation-source, and authority-convergence workflows to consume shared evidence.
- Extends domain-event definitions and convergent handlers without placing role names, role arrays, tokens, or credentials in events, jobs, audits, telemetry, or logs.
- Reuses `GetCharactersCharacterIdRoles`, its least-privilege OAuth scope, the registered ESI gateway representation, existing quota coordination, and existing organization evidence policy settings.
- Introduces no browser API and no direct module access to raw corporation-role snapshots.

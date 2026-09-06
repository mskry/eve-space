# ESI Resilience Engineering Guide

These instructions apply to `api/src/esi-resilience` in addition to the repository-wide guide.

## Dependency Direction

This subsystem uses support, representation, contract, infrastructure, execution, and observability tiers. The tier names describe ownership and dependency direction; they are not a template for unrelated directories.

- Support modules are dependency leaves and import no other ESI resilience modules.
- Representation and contract modules form the pure tier group. They may depend on support and each other, but never on infrastructure or execution.
- Infrastructure modules own connections, sockets, and raw transport behavior. They may depend on the pure tiers but never on execution.
- Execution modules orchestrate infrastructure and the pure tiers.
- Recorder-only observability modules may be imported by any tier and must not depend on execution. Aggregate observability may read execution state when explicitly allowed, but must not initiate or own execution.
- `scripts/esi-resilience/boundaries.ts` is the source of truth for exact module-to-tier membership, allowed tier imports, and narrow module exceptions. Update it when adding or moving an ESI resilience module.
- `scripts/verify-esi-resilience-boundaries.ts` must continue to reject undeclared modules and forbidden imports.

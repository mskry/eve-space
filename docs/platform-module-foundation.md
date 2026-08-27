# Platform Module Foundation

## Process Model

Feature server packages are statically linked libraries, not independent services. One API process
mounts every installed feature route and one worker process consumes every installed feature
resource. The separate server and Nuxt packages keep build dependencies and runtime capabilities on
the correct side of the deployment boundary; they do not require one API or worker deployment per
module.

## Installation And Enablement

`features/installed-modules.json` is the only source of installed feature identities. Registry
generation resolves each identity to `features/<module-id>/module.config.ts` and verifies the
separate `server` and `nuxt` package manifests. Directory scanning never installs a feature.
The descriptor supplies the module's default platform icon; individual navigation entries may
override it.

The backend owns one shell navigation order shared by all users. Only the deployment administrator
may rearrange stable core and module navigation identities. Disabled or uninstalled entries are
omitted without deleting their saved positions, and newly available entries append in deterministic
default order.

Use `pnpm registry:generate` after changing installed declarations. `pnpm registry:check` renders
all outputs in a temporary directory and compares them byte-for-byte with the checked-in files.

Installation is a build-time deployment change. Add the feature to `installed-modules.json`, add its
server package to the API dependencies and its Nuxt package to the root dependencies, regenerate the
registries, run `pnpm test:packaging`, and deploy rebuilt API/worker and Nuxt artifacts. The registry
check rejects missing package dependencies, runtime exports, packaged server migrations, and stale
generated output.

Enablement is durable runtime state and does not change the compiled `AppType` or require a rebuild.
Use the deployment-administrator endpoints `GET /api/admin/modules` and
`PUT /api/admin/modules/:moduleId` with `{ "enabled": true|false }`; do not edit the backing rows
directly. Runtime clients consume enabled identities and the resolved shared navigation order from
`GET /api/modules`. API and worker replicas converge within the bounded
`MODULE_RUNTIME_CACHE_TTL_MS` interval, which defaults to five seconds, while the browser query has a
30-second freshness window and refreshes before entering a module page. Install modules disabled,
verify migration and worker readiness, then enable them.

## Migration Failure

The API applies migrations for every installed module before opening its HTTP socket, including
disabled modules. Each migration and its ledger record commit in one transaction under the module's
advisory lock. A failure rolls back that migration and prevents API startup; migrations committed
before it remain applied.

Workers never run migrations. A worker whose required core or installed-module migration is absent
remains unhealthy, consumes no work, and reports the missing module and migration without exposing
database credentials. Correct the migration with a reviewed forward change, rebuild, and restart the
API. Never fabricate migration-ledger rows or enable a module around a migration failure.

## Safe Disablement And Retained Data

Disabling a module omits its navigation, returns the standard not-found response from its routes
before authentication or module code, and prevents resource planning. Already queued resource work
rechecks enablement and becomes a successful obsolete no-op before token loading, ESI access, or
persistence.

Disablement retains the module schema, domain values, collection state, migration records, module
setting, and saved shell-navigation positions. Re-enablement needs no request-time migration and may
reuse retained values only while their ownership lifecycle and authorization generation remain
current. Character detachment still ends the private lifecycle: lifecycle-bound collection and
module records become unreachable, and attaching the same EVE character later creates a new lifecycle
that cannot expose prior private data.

## Collection-State Reporting

Authorized module DTOs may project the platform-owned collection state as:

- `current`: a validated materialization remains within its interval.
- `stale`: a prior materialization exists but is due for refresh.
- `never-collected`: no validated value or prior safe failure exists.
- `authorization-required`: the current character authorization lacks the catalog-required scope.
- `unavailable`: collection is ineligible or failed without a usable initial value.

The projection includes the ESI representation's `validatedAt` time and a sanitized failure class.
Cache reads do not move `validatedAt`, so repeatedly reusing one ESI representation cannot slide
freshness indefinitely. `authorization-required` may additionally expose the required scope and a
character-bound reauthorization path. It never exposes tokens, upstream bodies, cache identities,
Redis topology, or values from another ownership lifecycle. `GET /api/status` currently reports
aggregate queue, cache, and resilience telemetry; it is not a deployment-wide listing of private
module collection records.

## Explicit Removal

Removal is a build-time operation and is intentionally separate from disablement or data erasure:

1. Disable the module and wait for API, worker, and browser cache convergence.
2. Verify its routes return not found, navigation is absent, and queued work performs no upstream access.
3. Back up the module data or record an explicit retention decision.
4. Remove the ID from `installed-modules.json`, remove its API and root package dependencies, regenerate the registries, run `pnpm test:packaging`, and deploy rebuilt API/worker and Nuxt artifacts.
5. Only after no deployed artifact references the module, apply a reviewed forward operator migration if permanent erasure is required.

A destructive removal must deliberately address the module schema and records, platform collection
state, module settings, saved navigation rows, persistence provisioning, migration-ledger records,
default privileges, and the `eve_module_*_runtime` role. Static uninstallation otherwise retains
stale settings and positions for a later reinstall. Never use `docker compose down --volumes` as a
module-removal procedure.

## Hono Typecheck Baseline

Measurements use Node.js 24.19.0 on an arm64 Apple M4 and five runs of:

```bash
pnpm --filter @eve-space/api exec tsc --noEmit
```

| Stage                         | Date       | Wall times                             | Warm median |
| ----------------------------- | ---------- | -------------------------------------- | ----------- |
| Empty generated module router | 2026-08-25 | 2.22 s, 1.98 s, 2.03 s, 2.03 s, 1.98 s | 2.03 s      |
| Post-foundation               | 2026-08-27 | 2.40 s, 2.44 s, 2.48 s, 2.51 s, 2.54 s | 2.48 s      |

The post-foundation median is 22% above the baseline and remains below the 5-second investigation
threshold.

Investigate a declaration rollup or per-module client only when the same-machine five-run warm
median exceeds 5 seconds or twice the recorded baseline, whichever is greater. Confirm with a
TypeScript performance trace that Hono and `AppType` inference dominate the regression before
changing the contract architecture.

## Resource Refresh Deduplication

Resource refresh jobs use BullMQ simple-mode deduplication keyed by module, resource, subject
lifecycle, and subject. A duplicate request is discarded while the matching job is delayed, waiting,
or active. Completion or failure removes the deduplication key independently of retained job history,
so a later planner pass can enqueue another refresh when PostgreSQL still reports the resource due.

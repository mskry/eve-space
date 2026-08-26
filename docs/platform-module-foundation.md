# Platform Module Foundation

## Feature Installation

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

## Hono Typecheck Baseline

Baseline recorded on 2026-08-25 with Node.js 24.19.0 on an arm64 Apple M4. The command was run five
times after adding the empty generated module router:

```bash
pnpm --filter @eve-space/api exec tsc --noEmit
```

Wall times were 2.22 s, 1.98 s, 2.03 s, 2.03 s, and 1.98 s. The warm median is 2.03 s.

Investigate a declaration rollup or per-module client only when the same-machine five-run warm
median exceeds 5 seconds or twice the recorded baseline, whichever is greater. Confirm with a
TypeScript performance trace that Hono and `AppType` inference dominate the regression before
changing the contract architecture.

## Resource Refresh Deduplication

Resource refresh jobs use BullMQ simple-mode deduplication keyed by module, resource, subject
lifecycle, and subject. A duplicate request is discarded while the matching job is delayed, waiting,
or active. Completion or failure removes the deduplication key independently of retained job history,
so a later planner pass can enqueue another refresh when PostgreSQL still reports the resource due.

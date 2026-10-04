<!-- bmad:context -->
<!-- Verified 2026-10-03 against 35bf357129965cbf18751d290bc0b29f1a6c5fe7. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## ESI client

The generated ESI SDK owns typed protocol exchanges. The application gateway owns authorization, caching, retries, rate coordination, and stale policy. Package operation and generation details live in `packages/esi-client/README.md`.

## Policy

- Keep one configured-fetch invocation per SDK operation. Classify failures without adding retries, caches, OAuth refresh, shared cooldowns, or application health policy.
- Preserve the SDK attempt deadline through response-body consumption and compose caller cancellation. Token-provider resolution remains cancellable and precedes the transport deadline.
- Preserve default response validation, always-on generic argument validation, bounded sanitized protocol metadata, and separate request/response transport-failure phases.
- Keep generic mutation execution disabled unless both client permission and per-call confirmation are present; named typed mutations retain their explicit-intent behavior.
- Keep generated operation IDs, natural request/response types, schemas, descriptor metadata, method options, discovery, and domain subpaths consistent.
- Keep the generator pinned exactly. Pin changes require full generation, semantic, package, and installed-tarball validation.

## Where things are

- For public SDK contracts, read `packages/esi-client/README.md`; runtime implementation lives in `packages/esi-client/src/client/`.
- For generation changes, read `packages/esi-client/scripts/generate/paths.ts` and the relevant emitter; specification corrections live in `packages/esi-client/openapi/corrections/`. Do not hand-edit generated targets; regenerate through the package scripts.
- Application gateway policy lives in `api/src/esi-gateway/AGENTS.md`; do not move it into this package.

## Running and verifying

- `pnpm --filter @evespace/esi-client generate` replaces generated targets atomically from the committed corrected OpenAPI snapshot.
- `pnpm --filter @evespace/esi-client generate:check` reproduces and compares generated targets without modifying the worktree. `pnpm --filter @evespace/esi-client generate:source:refresh` is the networked specification-refresh path.
- Package Sonar coverage and configuration are independent of the application; use package-owned reports and read the README before changing its quality workflow.

<!-- /bmad:context -->

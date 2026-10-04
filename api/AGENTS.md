<!-- bmad:context -->
<!-- Verified 2026-10-03 against 35bf357129965cbf18751d290bc0b29f1a6c5fe7. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## API and Hono

The API owns HTTP transport and the separate worker runtime. Public contracts and cross-seam security remain in the root guide. Subsystems under `src/` retain their dedicated guides.

## Where things are

- Hono composition and RPC contract: `api/src/index.ts`.
- For Hono changes anywhere in the repository, apply the rules below; load the relevant subsystem guide as well.

## Running and verifying

- API TypeScript uses `NodeNext`; retain `.js` extensions in relative TypeScript imports.
- API default unit tests exclude integration and packaging suites. Use the matching dedicated configuration when the changed behavior needs those boundaries.
- API `typecheck` and `build` build shared dependencies first; serialize them with other artifact writers.
- API tests use Vitest with Hono `testClient()` for typed routes and `app.request()` for raw URL or HEAD behavior.
- Mock EVE and PostgreSQL boundaries in route tests; exercise real routing, validation, cookies, redirects, and global error handling.

## Conventions that differ from defaults

- Keep route methods chained. Hono RPC and `testClient()` require chained definitions for route inference.
- Validate untrusted path, query, form, or JSON inputs before handlers run. Use the wrapper in `api/src/http/validation.ts` so validation failures retain the API's JSON error contract.
- Return JSON with explicit status codes when a route has multiple outcomes. Do not use `context.notFound()` for typed route outcomes.
- Keep handlers inline unless logic is reusable or belongs to a service boundary.

<!-- /bmad:context -->

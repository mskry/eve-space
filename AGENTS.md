# EVE Space Engineering Guide

These instructions apply to the entire repository. Preserve the architecture and security boundaries below unless the user explicitly requests an architectural change.

## Code Comments

- Keep comments rare. Add one only when it explains a non-obvious invariant, constraint, or rationale that the code cannot express clearly.
- Do not add comments that restate control flow, narrate test setup or mechanics, explain obvious assignments, or duplicate names and assertions. Remove excessive generated comments before finalizing changes.

## Runtime Architecture

- Nuxt renders the UI and may fetch public API data during SSR. Browser-side auth and character-owned requests call Hono directly with credentials enabled.
- The API and worker share server-only ownership of EVE SSO, ESI, session, token, encryption, cache, and persistence behavior.
- Queue/coordination Redis is a dedicated durable BullMQ instance: AOF with `appendfsync always`, `noeviction`, capacity health checks, and a persistent volume. It must remain separate from a future disposable cache Redis instance.
- The worker is a separate Node process built from the `api` workspace. It never runs migrations or an HTTP socket, verifies its required database migration directly, and has a non-HTTP dependency healthcheck. Backlog age degrades `/api/status` but not worker liveness; restarting the worker cannot be the response to work only that worker can drain.
- PostgreSQL `domain_events` rows are the acceptance and queue-loss recovery record for occurrence-based work. Material state and its event commit in one transaction; Redis jobs contain only the stable event ID.
- Domain-event relay and worker execution are at-least-once. Every event consumer must persist by event ID or converge from current PostgreSQL state; provider delivery ledgers and RBAC audit retention belong to their own capabilities.
- Nuxt normally runs on the host rather than under Docker Compose.

## API And Contract Rules

- Keep route methods chained. Hono RPC and `testClient()` require chained definitions for route inference.
- Mount feature routers through the chained root app in `api/src/index.ts`.
- Export the API contract as `AppType`; Nuxt consumes it through `hono/client`.
- Nuxt currently imports `AppType` from the API source. Accept that type-graph coupling at this size; if editor performance becomes a measured problem, emit a declaration rollup rather than hand-writing a parallel contract.
- Add dashboard integrations as a routed page plus an entry in `dashboard-sections.ts`; keep shell navigation out of feature pages.
- Keep reusable visual primitives in `layers/ui` and EVE-specific shell or feature components in the root `app`.
- Use Reka UI for behavior-heavy accessible primitives. Style them through the local UI layer instead of importing Reka components directly into feature pages.
- Keep the mobile navigation modal behind `UiDrawer`; desktop expansion is product shell state persisted through an SSR-readable cookie.
- Theme-dependent values belong in `layers/ui/app/assets/css/tokens.css`. Product styles must consume semantic `--ui-*` tokens or their documented compatibility aliases.
- Runtime themes use the `data-theme` HTML attribute. Nuxt layer priority is a build-time override mechanism, not a runtime theme selector.
- Keep the same resolved Hono version in the root and API packages. Version mismatches can break RPC inference.
- Validate untrusted path, query, form, or JSON inputs before handlers run. Use the wrapper in `validation.ts` so validation failures retain the API's JSON error contract.
- Return JSON with explicit status codes when a route has multiple outcomes. Do not use `context.notFound()` for typed route outcomes.
- Hono RPC provides compile-time client typing, not runtime response validation in the browser.
- Keep handlers inline unless logic is reusable or belongs to a service boundary.
- Load authenticated sessions through `middleware/auth-session.ts`; do not duplicate cookie/database lookup or import one route module from another.
- Character-ID-scoped routes must validate the path and load ownership through `middleware/owned-character.ts` before loading tokens or calling protected ESI operations.

## Code Review Rules

### Nuxt/API Execution Boundaries

- Review every changed Nuxt request together with the final Hono route as mounted in `api/src/index.ts`. Do not infer access requirements from feature-router comments or from whether the underlying ESI data is public.
- For each changed `useQuery`, `$fetch`, `useFetch`, `useAsyncData`, prefetch, mutation, or direct Hono client call, determine whether it can execute during SSR and whether the final route requires an application session, administrator session, owned character, or other credential.
- Report an SSR-capable request to a protected route unless it explicitly forwards the incoming request cookie. `credentials: 'include'` does not forward browser cookies from a server-side fetch.
- Valid safe paths are to disable the protected query during SSR with `import.meta.client` and apply the required client-side authentication or ownership gate, or to explicitly forward only the incoming `cookie` header when SSR is intentional. Genuinely public routes may use SSR normally.
- Do not report public SSR requests such as health, status, or authorization configuration; browser-event mutations that cannot execute during SSR; protected queries with the applicable client/authentication/ownership gate; or SSR requests that explicitly forward the incoming cookie.
- Findings must identify both the Nuxt call site and the Hono middleware or route mount that establishes the violated boundary.

## Schema Ownership

- `@evespace/esi-client` schemas validate EVE wire responses inside the API.
- Hono Zod schemas validate inputs to this application's HTTP API.
- Hono handler return types define this application's response DTOs and are inferred by Nuxt through `AppType`.
- Do not duplicate ESI schemas in Hono or expose raw ESI responses merely to share types.
- Map ESI data to intentional application DTOs. Add a separate response schema only if runtime client validation or OpenAPI generation becomes a requirement.
- Do not add a shared contracts package only to duplicate `AppType`. Revisit shared runtime schemas when there is an independently deployed consumer, a second consumer, or an OpenAPI requirement.
- `@evespace/esi-client`, `@hono/zod-validator`, and the API must continue to resolve one compatible Zod 4 version.
- Prefer SDK domain subpath imports for focused operations, such as `@evespace/esi-client/domains/wallet`.
- Build EVE image URLs through `useEveImages`; do not spend ESI requests retrieving image URLs or proxy image binaries through Hono.

## Authentication And Security

- The browser authenticates directly with EVE Online. Never collect EVE account credentials.
- One EVE Space user can own multiple individually authorized characters from the same or different EVE accounts; EVE SSO does not provide automatic alt discovery.
- Exactly one attached character is main for session identity. Character views and protected resources require an explicit owned character ID.
- The registered callback URL is `http://localhost:8788/auth/eve/callback` in local development.
- OAuth state is random, bound to an HttpOnly SameSite cookie, stored only as a SHA-256 hash, and persisted with login, attachment, or exact-character reauthorization intent.
- Attachment and reauthorization callbacks require the state-bound application session; reauthorization must return the expected character.
- Reject characters owned by another application user; do not merge users implicitly or reveal ownership through character lookup outcomes.
- Session bearer values are random and stored only as SHA-256 hashes.
- EVE access and refresh tokens are encrypted with AES-256-GCM before persistence.
- Refresh tokens, the EVE client secret, and `TOKEN_ENCRYPTION_KEY` must never reach Nuxt or logs.
- Domain-event payloads, queue jobs, telemetry, and logs must never contain tokens, session bearers, credentials, encryption material, or secrets.
- JWT signature, expiration, issuer, and required audiences must remain verified.
- Wallet access requires `esi-wallet.read_character_wallet.v1`; preserve scope checks and reauthorization responses.
- Keep auth cookies HttpOnly, SameSite Lax, high priority, and secure when `SESSION_COOKIE_SECURE` is enabled.
- Keep credentialed CORS restricted to `WEB_ORIGIN`.
- Private data is never persisted by the client query cache; keep `colada.options.ts` in-memory only.
- Never commit `.env`; document new settings in `.env.example`.

## ESI And Caching

- Use `@evespace/esi-client` rather than ad hoc ESI fetch calls.
- Discover endpoint paths, required scopes, route-specific cache behavior, and OpenAPI `x-rate-limit` metadata through the EVE API Explorer before implementing an ESI integration.
- Enrich character skills from local `sde_types` and `sde_groups` in one bounded query; retain ESI records with deterministic unknown labels when static rows are missing.
- Preserve the configured identifiable ESI user agent and SDK response validation. Browser requests that must identify themselves use `X-User-Agent`; server requests use `User-Agent`.
- Preserve `X-Compatibility-Date` on ESI requests. The compatibility date is not a future date and API changes take effect at 11:00 UTC.
- Live `GetUniverseBloodlines` data can contain nullable `ship_type_id` values that conflict with the SDK 2.0.0 schema. Response validation is disabled only for that operation; do not broaden the exception.
- Wallet cache expiry follows ESI `Expires` or `Cache-Control` metadata.
- Preserve conditional requests using ETag or Last-Modified and reuse cached data on `304`.
- Do not refresh ESI resources before their expiry. Respect `Expires`, `ETag`/`If-None-Match`, and `Last-Modified`; bypassing ESI caching can result in a ban.
- Preserve concurrent request collapsing, `429` cooldowns using `Retry-After`, ESI error-budget cooldowns, and stale fallback behavior.
- Account for both ESI rate-limit systems: route-group floating-window buckets and the legacy global error limit. Do not operate at either limit; spread periodic work and slow down as `X-Ratelimit-Remaining` approaches zero.
- Avoid preventable ESI errors: 2xx costs 2 bucket tokens, 3xx costs 1, 4xx costs 5 (except 429), and 5xx costs 0. Legacy error-limit headers are `X-ESI-Error-Limit-Remain` and `X-ESI-Error-Limit-Reset`.
- For cursor-paginated routes, treat `before` and `after` tokens as opaque. Initial collection pages backward with `before`; persist the initial `after` token for incremental updates. Deduplicate by keeping existing records from `before` pages and replacing them from `after` pages.
- Public and character-owned resource DTOs use bounded L1 plus disposable shared Cache Redis envelopes; private entries are generation-bound and never served stale.

## Persistence

- Add schema changes as new ordered migrations; do not rewrite an already-applied migration.
- The API container runs migrations before opening its HTTP socket.
- PostgreSQL data persists in the `postgres_data` Compose volume.
- Unpublished domain events never expire by age. Published events remain available for the configured queue-loss replay horizon, which defaults to 30 days and is independent from BullMQ job-history retention.
- Never destroy local database data unless the user explicitly requests it.

## Tooling And Verification

- Required runtime: Node.js 22.18 or newer, ESM only.
- API TypeScript uses `NodeNext`; retain `.js` extensions in relative TypeScript imports.
- pnpm is the only package manager for this repository. The root `pnpm-lock.yaml` is authoritative; do not add npm or Yarn lockfiles.
- Use Corepack rather than a separately versioned global pnpm installation.
- Install with `corepack enable` then `pnpm install --frozen-lockfile`.
- Organize root frontend tests by feature or cross-cutting concern. Use this target structure for a later behavior-free test-location refactor:

```text
tests/
  character/
    clone-state.test.ts
  dashboard/
    dashboard-sections.test.ts
  e2e/
    nuxt-ssr-failure.e2e.test.ts
  mail/
    character-mail-reading.e2e.test.ts
    mail-frontend.test.ts
    mail-queries.test.ts
  platform/
    platform-module-registry.test.ts
  queries/
    protected-queries.test.ts
    query-infrastructure.test.ts
    query-prefetch-hooks.test.ts
    query-ssr-auth.test.ts
  support/
  ui/
    ui-toast.test.ts
  setup.ts
```

- Co-locate feature-specific unit and E2E tests in the feature directory; reserve `tests/e2e/` for cross-feature shell and application journeys. Keep shared fixtures in `tests/support/`, preserve the `.e2e.test.ts` suffix for production-server browser tests, and update exact-path Vitest configs when files move. Perform the remaining test-location migration separately from behavioral changes.
- Keep integration suites with the runtime boundary that owns them instead of creating one repository-wide integration directory. Use these target locations as those suites grow:

```text
api/tests/integration/
  postgres/
  redis/
features/<module>/server/test/integration/
features/<module>/nuxt/test/integration/
packages/<package>/test/integration/
```

- PostgreSQL, Redis, server-module, Nuxt-module, and package integration suites have different dependencies and runners. Keep their package scripts and Vitest configs authoritative, and update include/exclude patterns when migrating existing files into these paths.
- Run relevant checks after changes. For API or shared-contract changes, run all of these:

```bash
pnpm lint
pnpm format:check
pnpm --filter @eve-space/api typecheck
pnpm --filter @eve-space/api test:coverage
pnpm --filter @eve-space/api test:redis
pnpm --filter @eve-space/api test:postgres
pnpm --filter @eve-space/api build
pnpm build
```

- API tests use Vitest with Hono `testClient()` for typed routes and `app.request()` for raw URL or HEAD behavior.
- Mock EVE and PostgreSQL boundaries in route tests; exercise real routing, validation, cookies, redirects, and global error handling.
- In Docker-capable development and CI environments, run the thresholded `test:redis` Testcontainers suite and `test:postgres` coordination suite in addition to mocked route tests.
- For runtime changes, rebuild with `docker compose up -d --build api`, verify `docker compose ps`, and probe representative valid and invalid routes.

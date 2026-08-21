# EVE Space Engineering Guide

These instructions apply to the entire repository. Preserve the architecture and security boundaries below unless the user explicitly requests an architectural change.

## Runtime Architecture

```text
Browser -> Nuxt 4 :3000
   |          |
   |          +-> EVE Image Server or compatible CDN
   |
   +----------+-> Hono :8788 -> PostgreSQL :5432
                         |
                         +-> EVE SSO and ESI
```

- Nuxt renders the UI and may fetch public API data during SSR. Browser-side auth and character-owned requests call Hono directly with credentials enabled.
- Hono owns all EVE SSO, ESI, session, token, encryption, cache, and persistence behavior.
- PostgreSQL stores users, characters, encrypted EVE tokens, OAuth state, and sessions.
- Redis and background workers are intentionally deferred. Do not introduce compatibility code for them without a concrete requirement.
- Docker Compose runs Hono and PostgreSQL. Nuxt normally runs on the host.

## Repository Layout

- `app/app.vue`: Nuxt provider/layout/page entrypoint plus development-only Pinia Colada devtools.
- `app/layouts/default.vue`: persistent dashboard shell and section navigation.
- `app/layouts/auth.vue`: focused EVE authorization surface.
- `app/pages/characters/`: character roster plus nested character-ID-scoped overview, skills, wallet, and employment-history routes.
- `app/pages/`: routed overview, authorization, character, and integration sections.
- `app/components/AppSidebar.vue`: registry-driven navigation rendered as a collapsible desktop icon rail and inside the mobile UI drawer.
- `app/utils/dashboard-sections.ts`: extension registry for dashboard plugins and integrations.
- `app/queries/`: typed Pinia Colada query definitions, hierarchical keys, cache policy, cleanup, and guarded prefetch helpers.
- `app/composables/`: auth and character-roster orchestration over shared queries plus focused non-query utilities.
- `colada.options.ts`: global in-memory query, retry, and metadata-driven hook configuration; private data is never persisted.
- `app/composables/useEveImages.ts`: typed EVE Image Server URL provider using the configurable public image base.
- `app/assets/css/main.css`: product page styling and responsive rules; consume semantic UI tokens rather than literal colors.
- `app/utils/api-client.ts`: auto-imported typed Hono RPC client factory used by Nuxt.
- `layers/ui/`: auto-registered local Nuxt layer containing the theme contract and reusable UI primitives.
- `layers/ui/app/assets/css/tokens.css`: runtime theme palettes and semantic CSS custom properties.
- `layers/ui/app/components/ui/`: Reka UI-backed providers, theme controls, and interaction primitives.
- `layers/ui/app/composables/useTheme.ts`: SSR-safe theme preference persisted in a SameSite cookie.
- `api/src/index.ts`: root Hono middleware, mounted routes, global errors, and exported `AppType`.
- `api/src/server.ts`: Node socket startup and graceful shutdown only.
- `api/src/routes/`: owned character, status, and health route modules.
- `api/src/sso-routes.ts`: EVE authorization, callback, session, and logout routes.
- `api/src/eve-sso.ts`: OAuth exchange, refresh, metadata discovery, and JWT verification.
- `api/src/middleware/`: reusable Hono middleware and its context-variable types.
- `api/src/auth-store.ts`: PostgreSQL persistence for auth state.
- `api/src/security.ts`: hashing and AES-256-GCM token encryption.
- `api/src/token-service.ts`: encrypted token loading and automatic refresh.
- `api/src/character-skills-service.ts`: protected ESI skills mapped to local SDE names and groups.
- `api/src/character-history-service.ts`: public ESI corporation history mapped to named employment records.
- `api/src/wallet-service.ts`: ESI wallet calls, caching, revalidation, and quota handling.
- `api/src/system-status-service.ts`: cached API, PostgreSQL, and Tranquility telemetry.
- `api/src/character-profile.ts`: composed public character DTO and short-lived cache.
- `api/src/validation.ts`: Hono Zod validator wrapper preserving `{ message }` errors.
- `api/migrations/`: ordered PostgreSQL migrations.

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
- JWT signature, expiration, issuer, and required audiences must remain verified.
- Wallet access requires `esi-wallet.read_character_wallet.v1`; preserve scope checks and reauthorization responses.
- Keep auth cookies HttpOnly, SameSite Lax, high priority, and secure when `SESSION_COOKIE_SECURE` is enabled.
- Keep credentialed CORS restricted to `WEB_ORIGIN`.
- Never commit `.env`; document new settings in `.env.example`.

## ESI And Caching

- Use `@evespace/esi-client` rather than ad hoc ESI fetch calls.
- Enrich character skills from local `sde_types` and `sde_groups` in one bounded query; retain ESI records with deterministic unknown labels when static rows are missing.
- Preserve the configured ESI user agent and SDK response validation.
- Live `GetUniverseBloodlines` data can contain nullable `ship_type_id` values that conflict with the SDK 2.0.0 schema. Response validation is disabled only for that operation; do not broaden the exception.
- Wallet cache expiry follows ESI `Expires` or `Cache-Control` metadata.
- Preserve conditional requests using ETag or Last-Modified and reuse cached data on `304`.
- Preserve concurrent request collapsing, `429` cooldowns, ESI error-budget cooldowns, and stale fallback behavior.
- Wallet and public character caches are bounded to 100 entries, process-local, and reset when the API restarts.

## Persistence

- Add schema changes as new ordered migrations; do not rewrite an already-applied migration.
- The API container runs migrations before opening its HTTP socket.
- PostgreSQL data persists in the `postgres_data` Compose volume.
- Never destroy local database data unless the user explicitly requests it.

## Tooling And Verification

- Required runtime: Node.js 22.18 or newer, ESM only.
- API TypeScript uses `NodeNext`; retain `.js` extensions in relative TypeScript imports.
- pnpm is the only package manager for this repository. The root `pnpm-lock.yaml` is authoritative; do not add npm or Yarn lockfiles.
- The exact package manager version is pinned in root `package.json`. Use Corepack rather than a separately versioned global pnpm installation.
- Install dependencies with:

```bash
corepack enable
pnpm install --frozen-lockfile
```

- Run relevant checks after changes. For API or shared-contract changes, run all of these:

```bash
pnpm lint
pnpm format:check
pnpm --filter @eve-space/api typecheck
pnpm --filter @eve-space/api test:coverage
pnpm --filter @eve-space/api build
pnpm build
```

- API tests use Vitest with Hono `testClient()` for typed routes and `app.request()` for raw URL or HEAD behavior.
- Mock EVE and PostgreSQL boundaries in route tests; exercise real routing, validation, cookies, redirects, and global error handling.
- For runtime changes, rebuild with `docker compose up -d --build api`, verify `docker compose ps`, and probe representative valid and invalid routes.

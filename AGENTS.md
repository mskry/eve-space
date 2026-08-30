# EVE Space Engineering Guide

These instructions apply to the entire repository. Preserve the architecture and security boundaries below unless the user explicitly requests an architectural change.

## Code Comments

- Keep comments rare. Add one only when it explains a non-obvious invariant, constraint, or rationale that the code cannot express clearly.
- Do not add comments that restate control flow, narrate test setup or mechanics, explain obvious assignments, or duplicate names and assertions. Remove excessive generated comments before finalizing changes.

## Code Style

- Prefer optional chaining over separate nullish guards when reading a property from a nullable value.

### Vue

These rules compile the official Vue Style Guide's [Priority A](https://vuejs.org/style-guide/rules-essential.html), [Priority B](https://vuejs.org/style-guide/rules-strongly-recommended.html), and [Priority C](https://vuejs.org/style-guide/rules-recommended.html) guidance. Preserve a more specific repository convention where one is documented.

#### Essential

- Use multi-word component names except for the root `App` component.
- Define props with explicit TypeScript types and required/default semantics; do not use untyped string-array prop declarations in committed code.
- Give every `v-for` a stable, unique `:key` based on item identity rather than an index or a potentially duplicated destination/value.
- Never place `v-if` and `v-for` on the same element. Filter through a computed value or move the conditional to a wrapper.
- Scope component styles through `<style scoped>`, CSS modules, or distinctive component/feature classes. Layout and root application styles may be global; reusable UI library primitives should use the repository's class-based styling strategy.

#### Strongly Recommended

- Keep each Vue component in its own file.
- Name SFC files in PascalCase consistently.
- Prefix reusable visual primitives with the established `Ui` prefix and app-level shell primitives with `App`; do not introduce competing `Base` or `V` prefixes.
- Prefix a tightly coupled child component with its parent component's full name.
- Order component-name words from the highest-level concept to descriptive modifiers so related components group together.
- Self-close components with no content in SFC templates; do not self-close native non-void HTML elements.
- Use PascalCase component names in SFC templates and JavaScript/TypeScript.
- Prefer full words over uncommon abbreviations in component names.
- Declare prop names in camelCase and use kebab-case when binding them in templates.
- Put elements with multiple attributes on multiple lines, one attribute per line, relying on the repository formatter for the final layout.
- Keep template expressions simple. Move transformations, branching, or multi-step calculations into computed values or methods.
- Split complex computed state into focused, descriptively named computed values when that improves readability, testability, or reuse; do not fragment a simple expression merely to satisfy this rule.
- Quote every non-empty HTML attribute value.
- Use Vue directive shorthands consistently: `:`, `@`, and `#` rather than mixing shorthand and long-form directives.

#### Recommended

- In Options API components, order options consistently: identity/compiler, dependencies, composition, interface, `setup`, state/computed, watchers/lifecycle, methods, then rendering. In `<script setup>`, keep the analogous flow: macros and interface, injected/composable dependencies, local state/computed state, watchers/lifecycle, then handlers.
- Order template attributes consistently: definition, `v-for`, conditionals, render modifiers, global identity, `ref`/`:key`, `v-model`, other attributes, events, then content directives.
- Use blank lines to separate multi-line component options or logical `<script setup>` sections when it improves scanning; avoid mechanical spacing that fragments tightly related declarations.
- Keep SFC top-level blocks in the repository order: `<script>`, `<template>`, then `<style>`.

### Nuxt

These rules compile Nuxt 4's official best-practice guidance for [accessibility](https://nuxt.com/raw/docs/4.x/guide/best-practices/accessibility.md), [hydration](https://nuxt.com/raw/docs/4.x/guide/best-practices/hydration.md), [performance](https://nuxt.com/raw/docs/4.x/guide/best-practices/performance.md), and [plugins](https://nuxt.com/raw/docs/4.x/guide/best-practices/plugins.md).

#### Accessibility

- Keep `NuxtRouteAnnouncer` mounted at the application root and give every route a distinct, meaningful document title so client-side navigation is announced.
- Use `NuxtAnnouncer`/`useAnnouncer` for important in-page status changes such as validation or asynchronous results; do not misuse route announcements for ordinary updates.
- Use `NuxtLink` for internal navigation so links retain native focus, keyboard, new-tab, and `aria-current` behavior. Mark public files or same-origin destinations outside Vue Router as `external`.
- Preserve a first-tab-stop skip link to the main content region. Keep the main target identifiable and programmatically focusable with `tabindex="-1"`; never introduce positive tabindex values.
- When changing focus after client navigation, do so after rendering and only for actual page changes. Do not steal focus for query/hash-only updates without a specific accessibility reason.
- Preserve Nuxt's default route scroll behavior unless the product requires an override. Any smooth scrolling or motion must respect `prefers-reduced-motion`.
- Treat semantic HTML, labels, form errors, keyboard access, visible focus, ARIA correctness, and sufficient contrast as acceptance requirements, not visual polish.

#### Hydration

- Treat every hydration mismatch as a defect. Do not suppress warnings or accept client re-rendering as a fix; mismatches can break interactivity, state, SEO, and layout stability.
- Never read browser-only APIs such as `window`, `document`, `localStorage`, or viewport state during SSR setup/rendering. Use universal state such as `useCookie`/`useState`, CSS media queries, or defer browser work to `onMounted`.
- Ensure SSR and initial client rendering consume the same deterministic data. Transfer SSR-safe fetch results through Nuxt payload-aware APIs or the repository's established query infrastructure rather than issuing duplicate server/client requests.
- Do not render `Math.random()`, current-time branches, locale-dependent values, or other nondeterministic output independently on server and client. Seed shared state, use `NuxtTime`, or render a stable fallback until mount.
- Prefer responsive CSS over client-only viewport conditionals. Use `ClientOnly` only when content genuinely cannot render on the server, and provide a stable fallback when layout or meaning would otherwise disappear.
- Initialize DOM-mutating or browser-dependent third-party libraries in client-only plugins or `onMounted`, after hydration; do not run side effects during component setup.

#### Performance

- Use `NuxtLink` for internal routes and rely on its smart prefetching. Change global or per-link prefetch behavior only from measured network or interaction evidence.
- Apply route rules deliberately: prerender stable public pages, use SWR/ISR only where cache semantics are correct, and disable SSR only for routes that cannot benefit from it. Never move protected data across an execution boundary to gain performance.
- Lazy-load components that are conditional, heavy, or below the fold. Consider delayed/lazy hydration for non-critical interactive components, but keep primary content and controls available without delay.
- For SSR-safe public data, prefer payload-aware `useFetch`/`useAsyncData` or the established query-prefetch infrastructure to avoid duplicate fetching. Protected queries must still obey this repository's explicit client/authentication/cookie-forwarding rules.
- Keep image dimensions explicit to prevent layout shift. Continue using `UiEveImage`/`useEveImages` for EVE assets; optimize other images with appropriate responsive formats, eager high-priority loading for measured LCP images, and lazy low-priority loading elsewhere.
- Keep fonts local or self-hosted where practical, preload only critical faces, and preserve fallback metrics to limit layout shift. Do not add external font requests without a measured need.
- Load third-party scripts only when needed and through an SSR-aware, privacy-conscious strategy. Delay non-critical analytics, embeds, and integrations so they do not degrade LCP or INP.
- Avoid unused dependencies, broad imports, and code included on every route without need. Use bundle analysis before large dependency additions and lazy-load or replace measured large blocks.
- Minimize reactive overhead only where profiling justifies it; consider `shallowRef`, `v-once`, or `v-memo` for large stable structures rather than applying them speculatively.
- Deliver critical content and controls first, then progressively enhance secondary presentation and features. Measure with production builds, Nuxt DevTools, Chrome Performance/Lighthouse, and field data where available.

#### Plugins

- Keep plugins few and cheap because plugin setup runs during application startup/hydration. Move feature-local behavior to composables or utilities whenever global injection or lifecycle hooks are unnecessary.
- Do not perform expensive computation, broad data fetching, or avoidable blocking I/O in plugin setup.
- Mark independent asynchronous plugins with `parallel: true`; leave ordering dependencies explicit rather than relying on incidental registration order.
- Use `.client`/`.server` plugin suffixes for environment-specific behavior and keep browser-only side effects out of universal plugins.

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
- Validate untrusted path, query, form, or JSON inputs before handlers run. Use the wrapper in `api/src/http/validation.ts` so validation failures retain the API's JSON error contract.
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

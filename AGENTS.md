<!-- bmad:context -->
<!-- Verified 2026-10-03 against 35bf357129965cbf18751d290bc0b29f1a6c5fe7. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## EVE Space Engineering Guide

EVE Space is an EVE organization application with a Nuxt UI, Hono API, and separate worker. Planning lives in OpenSpec and the EVE Space Linear project. Deeper architecture and operations guidance lives in `docs/` and the dedicated seam guides below.

## Policy

- Preserve the architecture and security boundaries below unless the user explicitly requests an architectural change.

### Runtime Architecture

- Nuxt renders the UI and may fetch public API data during SSR. Browser-side auth and character-owned requests call Hono directly with credentials enabled.
- The API and worker share server-only ownership of EVE SSO, ESI, session, token, encryption, cache, and persistence behavior.
- Managed-organization identity, organization-version isolation, account compliance, role/group/block decisions, and organization authorization middleware are core security capabilities. Activity collection and presentation remain module-owned and cannot weaken the core gate.
- A corporation deployment manages one corporation. An alliance deployment manages its current member corporations, but private roster and corporation-resource coverage requires a separate eligible data-source character in each corporation.
- Changing the configured organization increments the organization version transactionally. Old-version grants, compliance, scheduling eligibility, and private snapshots must become unable to authorize current access while retained audit history remains attributable to its original version.
- Queue/coordination Redis is a dedicated durable BullMQ instance: AOF with `appendfsync always`, `noeviction`, capacity health checks, and a persistent volume. It must remain separate from the disposable Cache Redis instance.
- The worker is a separate Node process built from the `api` workspace. It never runs migrations or an HTTP socket, verifies its required database migration directly, and has a non-HTTP dependency healthcheck. Backlog age degrades `/api/status` but not worker liveness; restarting the worker cannot be the response to work only that worker can drain.
- PostgreSQL `domain_events` rows are the acceptance and queue-loss recovery record for occurrence-based work. Material state and its event commit in one transaction; Redis jobs contain only the stable event ID.
- Domain-event relay and worker execution are at-least-once. Every event consumer must persist by event ID or converge from current PostgreSQL state; provider delivery ledgers and RBAC audit retention belong to their own capabilities.
- Nuxt normally runs on the host rather than under Docker Compose.

### Authentication And Security

- The browser authenticates directly with EVE Online. Never collect EVE account credentials.
- One EVE Space user can own multiple individually authorized characters from the same or different EVE accounts; EVE SSO does not provide automatic alt discovery.
- Character disclosure may be mandatory organization policy, but neither EVE SSO nor EVE Space can discover every character on an account or prove that no undisclosed character exists. UI, logs, audits, and APIs must describe only disclosed registration and observed corporation-roster coverage.
- Exactly one attached character is main for session identity. Character views and protected resources require an explicit owned character ID.
- The registered callback URL is `http://localhost:8788/auth/eve/callback` in local development.
- OAuth state is random, bound to an HttpOnly SameSite cookie, stored only as a SHA-256 hash, and persisted with login, attachment, exact-character reauthorization, organization-owner claim, or approved-transfer intent.
- Attachment, reauthorization, and transfer callbacks require the state-bound application session; reauthorization and transfer must return the exact expected character.
- Ordinary attachment must reject a character owned by another application user without merging users or revealing ownership. Cross-user transfer is allowed only through an unexpired, unrevoked deployment-administrator approval bound to the source lifecycle and destination user, followed by destination-session and exact-character EVE SSO proof.
- Deployment administrators may preview the minimum source/destination identity and blocker data needed to approve a transfer. This narrow permission grants no general character lookup, organization authority, or private organization-data access.
- Session bearer values are random and stored only as SHA-256 hashes.
- Application sessions expire after 14 idle days and never outlive 30 days from creation. Session verification renews them at most once per day.
- EVE access and refresh tokens are encrypted with AES-256-GCM before persistence.
- Refresh tokens, the EVE client secret, and `TOKEN_ENCRYPTION_KEY` must never reach Nuxt or logs.
- Domain-event payloads, queue jobs, telemetry, and logs must never contain tokens, session bearers, credentials, encryption material, or secrets.
- Deployment-administrator authority grants no member, HR, director, organization-owner, or private organization-data access. A user holding both deployment and organization authority must receive and revoke each grant independently.
- Organization grants, compliance projections, exceptions, groups, blocks, corporation sources, roster observations, and module snapshots must be scoped to the current organization version. Derived member access belongs to compliance state, not the elevated role-grant table.
- Organization audit rows are append-only and retained separately from domain-event recovery. They contain actor/subject identifiers, decisions, reasons, policy and organization versions, and resulting entitlement outcomes, never token or raw private ESI fields.
- JWT signature, expiration, issuer, and required audiences must remain verified.
- Wallet access requires `esi-wallet.read_character_wallet.v1`; preserve scope checks and reauthorization responses.
- Keep the member session, administrator session, and OAuth state cookies HttpOnly, SameSite Lax, and high priority. They are Secure whenever `EVE_CALLBACK_URL`, the API's public URL, uses HTTPS, and then carry the `__Host-` prefix, or `__Secure-` for path-scoped cookies; plain HTTP is for local development only. Set, read, and delete them through `api/src/http/auth-cookie.ts`.
- Keep credentialed CORS restricted to `WEB_ORIGIN`.
- Keep global Hono CSRF protection bound to `WEB_ORIGIN`. Unsafe form-compatible requests (form, multipart, plain-text, or missing content type) require that exact `Origin` or same-origin fetch metadata; JSON mutations rely on the credentialed CORS preflight. Route tests for unsafe requests must send the trusted `Origin`. The only exception is the development-only `POST /auth/local-fixture-session` exchange, which also accepts the opaque `Origin: null` sent by the file-based fixture handoff form.
- Browser query persistence may include explicitly classified public ESI, character ESI, and organization ESI results. Public persistence requires a genuinely public application route; public upstream ESI data does not make a session-protected application response public.
- Persisted character and organization results must be owner-bound. Restored private entries stay gated until the live application session verifies the same user and current subject admission succeeds. Character entries bind to the current character authorization revision; organization entries additionally bind to the current organization version, authorization revision, and permitted admission scope.
- Logout, an authentication denial, or an owner change clears both in-memory and persisted private data. A lapsed admission window, or a session verification or cache admission request that returns no verdict (network failure, timeout, or server error), suspends private admission without deleting persisted data or live private query results; retained entries stay gated until verification and admission succeed. Character authorization changes and organization version, compliance, permission, or module-access changes invalidate the affected private bindings. Persisted data never grants authorization; sessions, credentials, administrator state, and authorization decisions remain excluded from query persistence.
- Never commit `.env`; document new settings in `.env.example`.

### Persistence

- Add schema changes as new ordered migrations; do not rewrite an already-applied migration.
- The API container runs migrations before opening its HTTP socket.
- PostgreSQL data persists in the `postgres_data` Compose volume.
- Unpublished domain events never expire by age. Published events remain available for the configured queue-loss replay horizon, which defaults to 30 days and is independent from BullMQ job-history retention.
- Never destroy local database data unless the user explicitly requests it.

## Where things are

- When a task targets a listed seam, read its dedicated guide and every intervening ancestor guide. Read both owners when changing a boundary between seams; root-started Codex sessions do not automatically acquire descendant instructions.
- For source-code authoring, changes, review, or architecture work, read `docs/agent-code-standards.md`.
- For Vue, Nuxt, component, accessibility, hydration, CSS, or frontend performance work, also read `docs/agent-frontend-standards.md`.
- For gateway operations, ESI cache, transport, cancellation, rate limits, or response-validation changes, read `docs/esi-gateway-cache-policy.md`.
- For Hono routing or HTTP contract work, including contributed feature-server routes, read `api/AGENTS.md`.
- When choosing or running verification, read `docs/agent-verification.md` and the affected seam guide.
- For structural exploration, impact analysis, symbol renaming, security analysis, index maintenance, or precommit/regression graph review, read `docs/agent-code-intelligence.md`.
- For implementation work, read the relevant OpenSpec specifications and change artifacts under `openspec/`, plus the linked Linear issue in the EVE Space project. Raise conflicts with current source or these instructions rather than silently implementing stale planning text.
- API and Hono: `api/AGENTS.md`.
- ESI SDK: `packages/esi-client/AGENTS.md`.
- UI layer: `layers/ui/AGENTS.md`.
- ESI gateway: `api/src/esi-gateway/AGENTS.md`.
- GraphQL: `api/src/graphql/AGENTS.md`.
- Authentication: `api/src/auth/AGENTS.md`.
- Characters: `api/src/characters/AGENTS.md`.
- Organization: `api/src/organization/AGENTS.md`.
- Platform: `api/src/platform/AGENTS.md`.
- Queue: `api/src/queue/AGENTS.md`.
- Universe: `api/src/universe/AGENTS.md`.
- Core data: `api/src/core-data/AGENTS.md`.
- Browser query persistence: `app/query-persistence/AGENTS.md`.
- Platform Nuxt: `packages/platform-module-nuxt/AGENTS.md`.
- Market server: `features/market/server/AGENTS.md`.
- Organization activity server: `features/organization-activity/server/AGENTS.md`.
- SDE ingest: `sde-ingest/AGENTS.md`.

## Running and verifying

- Use Node.js 24.20 or newer and ESM. Use the Corepack-managed pnpm version pinned by root `package.json`; `pnpm-lock.yaml` is authoritative. Do not add npm or Yarn lockfiles or use an independently versioned global pnpm. Install with `corepack enable`, then `pnpm install --frozen-lockfile`.
- Choose verification from changed behavior, affected consumers, and seam instructions. Run focused affected checks once before handoff. Use targeted checks while iterating only to diagnose failures or validate risky changes; after further edits, rerun affected checks.
- Rely on the configured commit/push hooks and CI for the repository-wide matrix. Do not manually duplicate that matrix or run unrelated suites. Broaden local verification only for an explicit task requirement or a concrete unresolved risk spanning seams, and state the reason.
- Start Redis/PostgreSQL integration containers only when the changed behavior needs those runtime boundaries. The relevant Testcontainers suites start their own ephemeral services; Docker availability alone is not a reason to run them.
- Rebuild and probe the Compose API only when the task changes its deployment/container/startup behavior or explicitly requires deployed runtime verification. Preserve representative valid and invalid route probes for that verification; do not rebuild containers for unrelated runtime edits.
- Complete artifact generation before checks that consume it. Do not run builds/typechecks concurrently with tests importing shared generated artifacts, or with other commands writing those artifacts.
- Keep verbose verification output in log files; report concise outcomes and read only relevant failure excerpts. Run Sonar only when required by the task, after its prerequisite reports are complete.
- For documentation-only changes, use affected-file formatting and diff checks; runtime verification is unnecessary unless executable behavior changes.

## Conventions that differ from defaults

- Use GitNexus for structural exploration: `query` for concepts and execution flows, `context` for named symbols, and `impact` for dependencies and blast radius. Check index freshness and resolve incomplete or UNKNOWN results with targeted source verification.
- Before editing a function, class, or method, run GitNexus MCP/CLI upstream impact analysis and report callers, processes, and risk; do not substitute text search for this impact check.
- Warn on HIGH/CRITICAL risk before editing, never waive it using `riskSharedAxes`, and treat UNKNOWN or empty caller results as unresolved until source checks confirm the relevant callers.
- Rename symbols through graph-aware `rename`, rather than find-and-replace.
- Before committing, run GitNexus MCP/CLI graph change analysis. Partial/truncated results or zero results from incomplete analysis are unresolved; complete the check before treating it as clean.
- Preserve the established seam ownership and dependency directions. Apply the complete module-organization, shared-helper, and documentation-location rules in `docs/agent-code-standards.md` for source-code or architecture work.

### API And Contract Rules

- Mount feature routers through the chained root app in `api/src/index.ts`.
- Export the API contract as `AppType`; Nuxt consumes it through `hono/client`.
- Nuxt currently imports `AppType` from the API source. Accept that type-graph coupling at this size; if editor performance becomes a measured problem, emit a declaration rollup rather than hand-writing a parallel contract.
- Add dashboard integrations as a routed page plus an entry in `app/utils/dashboard-sections.ts`; keep shell navigation out of feature pages.
- Keep reusable visual primitives in `layers/ui` and EVE-specific shell or feature components in the root `app`.
- Use Reka UI for behavior-heavy accessible primitives. Style them through the local UI layer instead of importing Reka components directly into feature pages.
- Keep the mobile navigation modal behind `UiDrawer`; desktop expansion is product shell state persisted through an SSR-readable cookie.
- Theme-dependent values belong in `layers/ui/app/assets/css/tokens.css`. Product styles must consume semantic `--ui-*` tokens or their documented compatibility aliases.
- Runtime themes use the `data-theme` HTML attribute. Nuxt layer priority is a build-time override mechanism, not a runtime theme selector.
- Keep the same resolved Hono version in the root and API packages. Version mismatches can break RPC inference.
- Hono RPC provides compile-time client typing, not runtime response validation in the browser.
- Load authenticated sessions through `api/src/middleware/auth-session.ts`; do not duplicate cookie/database lookup or import one route module from another.
- Character-ID-scoped routes must validate the path and load ownership through `api/src/middleware/owned-character.ts` before loading tokens or calling protected ESI operations.
- Organization modules declare their audience and required permission in the build-time manifest. Core applies current-version compliance and role middleware before contributed handlers execute or private data is read.
- Enabled member-facing modules may contribute bounded activity providers. Providers read only module-owned storage, return intentional member-safe DTOs, and fail independently; core supplies authorized organization and compliant-character context, merges stable identities, and never reads module tables directly.
- For fetching, ESI integration, query caching, or browser persistence reviews, read `docs/agent-fetching-review.md` and `docs/fetching-layer-compliance-checklist.md`; use the checklist’s evidence/report format.
- Protected Nuxt requests must be client/authentication/ownership-gated or deliberately forward only the incoming cookie during SSR. Assess each changed request against its final mounted route; `credentials: 'include'` does not forward SSR cookies.

### Schema Ownership

- `@evespace/esi-client` schemas validate EVE wire responses inside the API.
- Hono Zod schemas validate inputs to this application's HTTP API.
- Hono handler return types define this application's response DTOs and are inferred by Nuxt through `AppType`.
- Do not duplicate ESI schemas in Hono or expose raw ESI responses merely to share types.
- Map ESI data to intentional application DTOs. Add a separate response schema only if runtime client validation or OpenAPI generation becomes a requirement.
- Do not add a shared contracts package only to duplicate `AppType`. Revisit shared runtime schemas when there is an independently deployed consumer, a second consumer, or an OpenAPI requirement.
- `@evespace/esi-client`, `@hono/zod-validator`, and the API must continue to resolve one compatible Zod 4 version.
- Prefer focused SDK subpath imports where SDK imports are permitted: core representations use operation descriptors and response types from `/operations` and `/types`; standalone SDK consumers may use `/domains/<domain>`. SDK runtime execution in this application remains gateway-owned.
- Build EVE image URLs through `useEveImages`; do not spend ESI requests retrieving image URLs or proxy image binaries through Hono.

### ESI And Caching

- Execute core ESI reads and mutations through registered representations in `api/src/esi-gateway/feature-execution.ts`; installed feature server modules use platform ESI dispatch and must not import the SDK at runtime. Only the gateway execution owner constructs SDK clients and binds transport. Do not use SDK default transport or raw ESI `fetch` in application code; preserve `scripts/verify-esi-egress.mjs`, including its checks for local URL constants and fetch aliases.
- Discover endpoint paths, required scopes, route-specific cache behavior, and OpenAPI `x-rate-limit` metadata through the EVE API Explorer before implementing an ESI integration.
- The reviewed organization operation catalog is recorded in `docs/organization-platform.md`. Re-review it before implementation when the requested compatibility date or SDK version changes.
- Register every ESI call in the reviewed operation metadata and executable catalog, and bind it to the matching generated SDK operation descriptor. Preserve startup validation of operation IDs, compatibility dates, scopes, executable definitions, and catalog contracts.
- Preserve the configured identifiable ESI user agent and SDK response validation. Browser requests that must identify themselves use `X-User-Agent`; server requests use `User-Agent`.
- Preserve `X-Compatibility-Date` on ESI requests. The compatibility date is not a future date and API changes take effect at 11:00 UTC.
- Account for both ESI rate-limit systems: route-group floating-window buckets and the legacy global error limit. Do not operate at either limit; spread periodic work and slow down as `X-Ratelimit-Remaining` approaches zero.
- For cursor-paginated routes, treat `before` and `after` tokens as opaque. Initial collection pages backward with `before`; persist the initial `after` token for incremental updates. Deduplicate by keeping existing records from `before` pages and replacing them from `after` pages.
- Cache Redis owns disposable shared envelopes and lossy ESI telemetry. Queue/coordination Redis owns durable cooldowns, concurrency permits, request-collapse leases, fencing, resource revisions, and mutation invalidation intents; do not move those responsibilities between Redis instances.

<!-- /bmad:context -->

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **eve-space** (52312 symbols, 125470 relationships, 723 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource                                   | Use for                                  |
| ------------------------------------------ | ---------------------------------------- |
| `gitnexus://repo/eve-space/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/eve-space/clusters`       | All functional areas                     |
| `gitnexus://repo/eve-space/processes`      | All execution flows                      |
| `gitnexus://repo/eve-space/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                               |
| -------------------------------------------- | -------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->

# EVE Space

EVE Space is a self-hosted, organization-governed platform for EVE Online corporations and
alliances. It combines a managed-organization membership boundary with capabilities delivered
through individually authorized characters. It supports:

- Corporation deployments that govern one corporation and alliance deployments that govern their current member corporations
- Account-level registration compliance across every character a member discloses and attaches
- Multiple individually authorized characters per application account, with one selectable main character
- Character overview, location, active ship, skills, wallet balance and transactions, employment history, and mail
- Public EVE character and corporation records inside the authenticated application
- Mail reading, composition, recipient lookup, CSPA estimates, and label management
- Separate deployment administration and verified EVE organization authority
- Statically installed first-party modules with runtime enablement

The application is a pnpm workspace built from a Nuxt 4 frontend, a chained Hono API, a separate Node worker, PostgreSQL 17, and two Redis 7 roles. Pinia Colada provides typed in-memory frontend queries, the local Nuxt UI layer wraps Reka UI primitives, and `@evespace/esi-client` owns all ESI access in the API and worker.

The Nuxt UI uses routed dashboard sections. The default layout owns the persistent sidebar and top bar, while the authorization route uses a focused auth layout. New integrations register a route and sidebar entry without modifying the shell.

Remote frontend data is organized as typed domain queries under `app/queries/`. Public status data can render during SSR, while session and character-owned requests remain browser-only because Hono owns the credentialed session boundary. Character and wallet query keys include the relevant character identity; logout cancels and clears every private query. Query data remains in memory and is not persisted to browser storage.

Reusable UI behavior and theming live in the auto-registered `layers/ui` Nuxt layer. Reka UI supplies unstyled accessible primitives, while semantic CSS tokens preserve the application's visual identity. The selected Void or High Sec theme is rendered through `data-theme` and persisted in an SSR-readable SameSite cookie. Dashboard navigation uses a collapsible desktop icon rail with Reka tooltips and a modal Reka drawer on mobile. The top-bar status popover reports cached API, PostgreSQL, and Tranquility telemetry.

EVE portraits, corporation/alliance logos, and type images use the official EVE Image Server path contract through `useEveImages`. Browsers load images directly from the configured provider; Hono and Redis do not proxy or store image binaries. Set `NUXT_PUBLIC_EVE_IMAGE_BASE` to a compatible object-storage or CDN origin to move image delivery without changing components.

## Requirements

- Node.js 22.18 or newer
- pnpm 11.22.0 through Corepack
- Docker Engine with Docker Compose (OrbStack and Docker Desktop are both suitable locally)
- An EVE Developer application for the SSO flow

## EVE Application

Create an application in the [EVE Developer Portal](https://developers.eveonline.com/applications) and register this exact callback URL:

```text
http://localhost:8788/auth/eve/callback
```

The application requests these protected scopes for each attached character:

```text
esi-wallet.read_character_wallet.v1
esi-location.read_location.v1
esi-location.read_ship_type.v1
esi-skills.read_skills.v1
esi-skills.read_skillqueue.v1
esi-mail.read_mail.v1
esi-mail.organize_mail.v1
esi-mail.send_mail.v1
esi-search.search_structures.v1
esi-characters.read_contacts.v1
esi-characters.read_corporation_roles.v1
```

Each character must be authorized individually. An organization may require members to disclose and
attach every character as a condition of access, and EVE Space evaluates compliance across every
attached character. The attachment flow can select a character after signing into the same or a
different EVE account. EVE SSO authorizes only the character selected in each flow: it cannot discover
all characters on an EVE account or prove that a member has no undisclosed characters. Existing
authorizations must be refreshed after adding scopes.

## Managed Organization

The configured deployment organization is the membership boundary. A corporation deployment manages
that corporation. An alliance deployment discovers its current member corporations publicly, then
requires a separately authorized data-source character in each corporation for private corporation
roster coverage. An alliance executor character cannot enumerate every member of every alliance
corporation, so coverage is reported per corporation as current, stale, unauthorized, or not
configured rather than treating missing coverage as an empty roster.

The local deployment administrator owns hosting settings, module enablement, and shared navigation. It
does not receive member, HR, director, or private organization-data access from that authority. EVE
organization authority is claimed and maintained separately through verifiable character affiliation,
scope, and corporation-role evidence.

See [`docs/organization-platform.md`](docs/organization-platform.md) for the disclosure policy,
core/module ownership boundary, and reviewed ESI operation catalog.

## Environment

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

At minimum, supply:

```dotenv
NUXT_PUBLIC_EVE_IMAGE_BASE=https://images.evetech.net
POSTGRES_PASSWORD=your-url-safe-random-postgres-password
DATABASE_URL=postgres://eve_space:your-url-safe-random-postgres-password@localhost:5432/eve_space
EVE_CLIENT_ID=your-client-id
EVE_CLIENT_SECRET=your-client-secret
ESI_USER_AGENT=EveSpace/0.1 (eve:your-character) @evespace/esi-client/2.0.0
TOKEN_ENCRYPTION_KEY=your-base64-encoded-32-byte-key
ADMIN_SETUP_SECRET=your-high-entropy-one-time-setup-secret
```

Generate a URL-safe PostgreSQL password and the encryption key with:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

Use the same hex output for `POSTGRES_PASSWORD` and the password component of `DATABASE_URL`.

The client secret, encryption key, and setup secret must remain server-side. Never provide EVE account credentials to this application; the browser authenticates directly with EVE Online.

Generate a separate setup secret with `openssl rand -base64 32`. After signing in with EVE, open `/admin/login` directly to create the local deployment owner and select the owning corporation or alliance by EVE organization ID. The Admin navigation remains hidden unless that separate local owner session is authenticated.

## Run

Enable Corepack and install the workspace dependencies:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Start the backend stack:

```bash
pnpm stack:up
```

Start Nuxt on the host:

```bash
pnpm dev
```

`pnpm stack:up` starts PostgreSQL, durable queue Redis, disposable cache Redis, the Hono API, and the worker. The API container applies pending core and installed-module migrations before opening its HTTP socket. `pnpm dev` runs Nuxt separately on the host.

Open `http://localhost:3000`. The API is available at `http://localhost:8788`.

Useful commands:

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f worker queue-redis cache-redis
pnpm stack:down
```

## Testing

The Hono routes use Vitest with the typed `testClient()` helper and `app.request()` for raw URL and HEAD behavior. EVE and PostgreSQL boundaries are mocked while routing, validation, cookies, state matching, redirects, and error handling use the real application code.

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:frontend
pnpm test:api
pnpm test:modules
pnpm test:redis
pnpm test:postgres
pnpm test:packaging
```

Run `pnpm test:e2e` for the production-server browser suite, `pnpm lint:fix` for safe lint fixes, and `pnpm format` to format supported files. `pnpm build` builds installed module dependencies and the Nuxt application.

Coverage suites exercise SSO, administrator and session middleware, character, corporation and mail resources, module composition, status telemetry, ESI cache/quota behavior, and queue scheduling. `test:redis` runs a thresholded Testcontainers suite against Redis 7.4 Alpine; `test:postgres` exercises real PostgreSQL migrations and coordination behavior.

## Service Boundaries

```text
Browser ----> Nuxt :3000
   |
   +--------> Hono API :8788 --------> PostgreSQL :5432
                    |  \------------> EVE SSO and ESI
                    |  \------------> Queue Redis :6379
                    |                  (durable coordination)
                    \---------------> Cache Redis :6380
                                       (disposable ESI values)

Nuxt (public SSR only) ---------------> Hono API :8788
Worker (no HTTP) --------------------> PostgreSQL / ESI / both Redis roles
```

The browser calls Hono directly with credentials for session and character-owned requests. Nuxt may call public endpoints such as status during SSR, but it does not proxy authenticated traffic, hold EVE credentials, or call `@evespace/esi-client`. The API and worker share server-only ESI, OAuth, character ownership, token encryption, session, and persistence behavior. Protected character routes load resources for an explicit owned character ID.

Nuxt constructs EVE Image Server URLs locally and lets browsers fetch those public assets directly. Image requests do not consume Hono or ESI API capacity.

The API exports its chained Hono `AppType`. Nuxt uses `hono/client` to build URLs, send authenticated requests, and infer success response types directly from route handlers. HTTP path and query inputs are validated with Zod before handlers run.

`@evespace/esi-client`, `@hono/zod-validator`, and the API share Zod 4. The SDK validates ESI wire responses, while Hono schemas validate this application's HTTP inputs; API response DTOs remain an intentional boundary rather than exposing ESI payloads directly.

## API Routes

System and module discovery:

- `GET /health` checks API and PostgreSQL availability.
- `GET /api/status` returns replica-local API, PostgreSQL, Tranquility, queue, worker, outbox, and safe ESI resilience telemetry.
- `GET /api/modules` returns enabled module identities and the resolved shared shell navigation order. Installed module routes also mount below this prefix.

Application authentication and owned characters:

- `GET /auth/config`, `GET /auth/eve/start`, `GET /auth/eve/attach`, `GET /auth/eve/reauthorize/:characterId`, and `GET /auth/eve/callback` implement login, attachment, and exact-character reauthorization.
- `GET /auth/session` returns the application session; `POST /auth/logout` revokes it.
- `GET /api/me/characters` lists the user's attached character roster.
- `GET /api/me/characters/:characterId` returns the owned character's profile, location, ship, and skill-point summary.
- `PATCH /api/me/characters/:characterId/main` selects the account main; `DELETE /api/me/characters/:characterId` removes a non-main character.
- `GET /api/me/characters/:characterId/skills` overlays live progress onto the full published SDE skill catalogue. Each API process loads that catalogue once; restart all API processes after ingesting an SDE build that changes it.
- `GET /api/me/characters/:characterId/wallet` and `/wallet/transactions` return protected wallet data.
- `GET /api/me/characters/:characterId/history` returns corporation employment history.

Character mail:

- `GET|POST /api/me/characters/:characterId/mail` lists messages or sends mail.
- `GET|PUT|DELETE /api/me/characters/:characterId/mail/:mailId` reads, updates, or deletes a message.
- `/mail/labels` and `/mail/lists` expose label and mailing-list operations.
- `/mail/recipients/resolve`, `/mail/recipients/search`, and `/mail/cspa` support composition.

Authenticated public EVE records:

- `GET /api/characters/:characterId` returns a public EVE character profile.
- `GET /api/corporations/npc`, `GET /api/corporations/:corporationId`, and `GET /api/corporations/:corporationId/alliance-history` return public corporation data.

Deployment administration (an application session is also required):

- `/api/admin/setup`, `/login`, `/session`, and `/logout` manage the separate local administrator identity.
- `PUT /api/admin/organization` changes the owning EVE corporation or alliance.
- `GET /api/admin/modules` and `PUT /api/admin/modules/:moduleId` read or change installed-module enablement.
- `GET|PUT /api/admin/shell-navigation-order` reads or rearranges deployment-wide shell navigation.

Although character and corporation profile data originates from public ESI endpoints, the root Hono app requires an application session for `/api/characters/*` and `/api/corporations/*`. Every `/api/me/characters/:characterId/*` route additionally verifies character ownership before token or ESI access.

Installed module server packages run inside the existing API and worker processes; they are package
boundaries, not one service per module. Installation, runtime enablement, safe disablement, migration
failure, retained data, telemetry, and explicit removal are documented in
[`docs/platform-module-foundation.md`](docs/platform-module-foundation.md).

## Security Decisions

- OAuth state is bound to an HttpOnly SameSite cookie, stored as a SHA-256 hash, consumed once, and bound server-side to login, attachment, or exact-character reauthorization intent.
- Session bearer values are stored only as SHA-256 hashes.
- EVE access and refresh tokens are encrypted with AES-256-GCM.
- Character-ID-scoped routes verify `(user_id, character_id)` ownership before reading or refreshing token material; unknown and non-owned IDs share the same response.
- A character already attached to another EVE Space user is rejected rather than merging accounts.
- JWT signature, expiration, issuer, and both required audiences are verified.
- EVE endpoints are discovered from the official OAuth metadata document.
- Refresh tokens never reach Nuxt or the browser.
- CORS allows credentials only from `WEB_ORIGIN`.
- Wallet responses use private browser caching and generation-bound server-side shared envelopes; token or scope generation changes invalidate warm private entries before they can be read.
- Expired wallet entries revalidate with ETag or Last-Modified and reuse data on `304`.
- Concurrent wallet requests are collapsed, and `429` plus low error-budget responses trigger cooldowns.

## Database

The migrations create users, one-to-many attached characters, encrypted per-character EVE tokens, intent-bound OAuth states, application and administrator sessions, deployment and module settings, transactional domain events, SDE reference tables, and migration history. A partial unique index prevents more than one main character per user. Migrations run automatically when the API container starts.

PostgreSQL data is retained in the `postgres_data` Compose volume. To intentionally delete local database data:

```bash
docker compose down --volumes
```

## Queue Redis Operations

Queue Redis is durable BullMQ storage, not a cache. Compose runs `redis:7.4.7-alpine` with AOF and `appendfsync always`, a `noeviction` policy, `QUEUE_REDIS_MAXMEMORY`, and the `queue_redis_data` volume. The healthcheck fails when usage reaches 90% of the configured limit, so alert on an unhealthy queue Redis service before writes are rejected.

Compose publishes Queue Redis to the local host at `QUEUE_REDIS_PORT` so a host-run worker can use the default `redis://localhost:6379` URL. Do not publish this port in production; use an authenticated private endpoint instead.

For production, pin the validated Redis image to an immutable digest, configure authentication, and require TLS whenever Redis traffic leaves a private host network. Set `QUEUE_REDIS_URL` to a `rediss://` URL for that topology; never put credentials in job payloads, logs, or source control.

Back up the AOF and Redis data volume on a schedule aligned with the recovery objective, test restores, and retain backups independently of container lifecycle. Queue retention and admission settings are documented in `.env.example`; tune the memory limit and high-water mark from measured load before production deployment.

The database migration generates and persists a random planner offset for each installation, so replicas share one value and independent installations do not converge on a constant default. Set `QUEUE_PLANNER_SCHEDULE_OFFSET_MS` only to override that persisted value, and give every worker replica in one deployment the same override. Planner-produced jobs also receive a random delay up to `QUEUE_PLANNER_INITIAL_DELAY_MAX_MS`; the worker rejects a configuration whose offset plus maximum delay reaches the next planner occurrence. This first-dispatch staggering is separate from retry backoff jitter.

Inspect only aggregate queue state through `GET /api/status`; it reports reachability, worker heartbeat, depth, lag, active/retrying/failed counts, planner and outbox pause states, scheduler state, and the latest sanitized relay outcome without Redis endpoints, keys, or payloads. The separate `eventRelay` section reports pending PostgreSQL event count and oldest age. The BullMQ job keyspace is versioned under `eve-space:v1`; change the version only with an explicit migration/recovery plan.

To retry failed derived diagnostics after addressing a dependency, use a private operator shell with BullMQ's `queue.retryJobs({ state: 'failed' })`. To cancel pending derived work, use `queue.remove(jobId)` for a specific waiting or delayed job, or `queue.drain(true)` only after stopping workers and producers. Do not use `obliterate` on a running queue.

For queue disaster recovery, stop API producers and workers, restore the Redis AOF/data volume, start queue Redis, then start workers and API. Derived jobs are reconstructed by their planners. Authoritative event jobs are reconstructed from retained PostgreSQL `domain_events` only through the guarded re-drive command below; restarting the worker automatically relays events that were never marked published but does not assume already-published work was lost. PostgreSQL remains authoritative; do not place EVE tokens, credentials, session bearers, encryption material, event payloads, or secrets in queue payloads, names, logs, or Redis keys.

## Cache Redis Operations

Cache Redis holds disposable ESI response envelopes and best-effort aggregate ESI telemetry. Compose runs `redis:7.4.7-alpine` with `CACHE_REDIS_MAXMEMORY`, `allkeys-lfu`, no AOF, no RDB snapshot, and no data volume. Eviction and complete loss are expected cache misses or telemetry gaps; they must never affect BullMQ jobs, cooldowns, leases, or PostgreSQL state. Alert when the cache Redis healthcheck reports memory use above 90% of the configured limit, then adjust capacity from observed hit rate and eviction pressure.

For production, pin the validated Redis image to an immutable digest, require authentication, and require TLS whenever traffic leaves a private host network. Set `CACHE_REDIS_URL` to the authenticated `rediss://` endpoint; never log or commit its credentials. Do not back up the cache role. Cache-key namespace changes intentionally create a cold cache. Invalidate ESI values by rotating only the coordination sentinel, never by deleting BullMQ, cooldown, lease, or fence keys.

### Affiliation Capacity Fixture

The affiliation benchmark uses a disposable PostgreSQL database with 10,000 synthetic users, characters, and token rows. Half have unexpired sessions, half have expired sessions, and the fixture includes representative corporation and alliance IDs. No credentials or production character data are used. On 2026-08-24, PostgreSQL 17 selected a representative 1,000-ID due batch from 5,000 due characters in 0.165 ms and a worst-case 1,000-ID batch from 10,000 due characters in 0.463 ms using `characters_due_affiliation_check_idx`; the all-due run produces ten 1,000-ID batches.

Record the Compose image versions, cache capacity, queue capacity, active/inactive intervals, and query plans whenever this fixture is rerun. Real near-term due sets are smaller than this worst case because only SSO-authorized characters exist in `characters`; unsynchronized alliance members are not present yet.

ESI envelopes are namespaced by an envelope format version and a random coordination-controlled namespace epoch. Replicas revalidate that epoch on a bounded one-second interval and atomically converge on one replacement after coordination loss; Cache Redis eviction cannot roll it backward. Rotate the sentinel to invalidate all cached ESI values after a DTO or envelope change, but do not flush Queue Redis because it also owns BullMQ jobs, cooldowns, leases, and fencing identities. If Queue Redis is reset while Cache Redis survives, the missing sentinel creates a new epoch automatically. Expect a cold-cache period after that recovery: requests refill values under normal ESI concurrency and cooldown policies.

Envelope v3 stores the canonical representation version, validated application DTO, independent absolute `freshUntil`, `staleUntil`, and `retainUntil` deadlines, conditional validators, fence, and optional character principal plus token generation. Redis expiry follows retention only. Retained values may provide ETag or Last-Modified after their stale deadline, but their data is not normally servable; generation-bound private values are released only during an ESI outage or cooldown. Representation cache, lease, and fence keys use the v3 envelope namespace and v2 canonical SHA-256 identity, which includes operation, normalized inputs, compatibility date, and DTO version but excludes credentials. Durable cooldown and concurrency keys intentionally retain their v1 operational namespace so active windows survive this representation migration.

Review `api/src/esi-resilience/operation-metadata.ts` against the EVE API Explorer before enabling or changing an operation. Record the review and resolved compatibility dates, operation ID, scope, cache behavior, and declared route group. Runtime `Expires` takes precedence over `Cache-Control: max-age`, followed by the recorded relative, exact daily-UTC, runtime-only, or no-value fallback. Do not add jitter to fixed daily boundaries or change `ESI_COMPATIBILITY_DATE` without advancing affected representation versions.

Queue Redis coordinates deployment-global legacy error-budget cooldowns, catalog-declared route-group `Retry-After` cooldowns, groupless operation/principal cooldowns, concurrency, leases, and fences. Cache Redis failure produces controlled misses and telemetry gaps; coordination failure disables shared reads and writes and falls back to conservative process-local concurrency and cooldown state. Neither failure permits bypassing PostgreSQL ownership, scope, or token-generation checks. Invalidate disposable values by rotating the cache namespace sentinel, never by flushing Queue Redis.

`GET /api/status` exposes only aggregate cache and coordination reachability, global/public cooldown windows, cache-source counts, declared versus observed route groups, and per-operation upstream outcomes with resolved authorization and cache policy. Cooldown status is read from coordination Redis while lossy upstream outcomes are read from Cache Redis, so either side can remain observable when the other is unavailable. It never exposes Redis URLs, keys, principals, cached payloads, or credentials. A first failed dependency probe is `degraded`; three consecutive failed probes are `unavailable`. These states degrade status telemetry but do not make the API container healthcheck fail, because `/health` remains a local PostgreSQL probe.

### ESI Route-Group Baseline

`pnpm --filter @eve-space/api esi:rates` reports the most recently completed 15-minute measurement window. The best-effort measurement lives only in disposable Cache Redis. It stores aggregate request and weighted-token counters for every declared group plus non-enumerable HyperLogLog cardinality fed with locally hashed principals for character-scoped groups. Reports compare per-character averages for private groups and total deployment use for public groups against documented capacity. It is not admission state and cache loss may discard it.

The 2026-08-25 06:00-06:15 UTC local-development sample covered four distinct characters. Average weighted use per character was 6.25 of 150 tokens for `char-wallet` (4.1667%), 7.5 of 600 for `char-detail` (1.25%), and 14.5 of 1,200 for `char-location` (1.2083%). Operation averages were 5 wallet-balance requests, 6.25 skills requests, 6 location requests, and 6 ship requests per character; wallet transactions made no upstream request during the sample. No active call site approached its documented route-group limit, so current evidence does not justify a proactive distributed admission ledger. Repeat the measurement after material traffic, polling, or attached-character growth.

Affiliation refresh is derived work. Inspect `services.queue.depth`, `oldestWaitingAgeSeconds`, `plannerPaused`, and `latestAffiliationPlannerOutcome` in `/api/status` to distinguish a normal idle planner from cooldown, admission, coalescing, or failed planning. The planner reconstructs due batches from PostgreSQL after queue loss, so do not manually recreate jobs or put character credentials in a queue payload.

## Transactional Domain Events

Material changes to EVE Space's local EVE SSO projection append a versioned event in the same PostgreSQL transaction. Version 1 currently covers character attachment, character detachment, main-character change, and material ESI scope-set change. Login sessions, logout, unchanged reauthorization, routine token rotation, and transient ESI authorization errors do not create domain events.

The worker runs a skip-overlap outbox relay every five seconds by default. It claims bounded PostgreSQL batches without holding a transaction across Redis I/O, validates each row independently, publishes only `{ eventId }` with a deterministic BullMQ job ID, and acknowledges publication by claim token. An incompatible stored event records a sanitized `invalid-event` failure without blocking valid companions. A crash before enqueue leaves an expiring claim; a crash after enqueue but before acknowledgement retries the same logical job identity. This is at-least-once transport, not exactly-once external delivery. Consumers must persist effects by event ID or recompute a convergent result from current authoritative state.

Unpublished and claimed rows are never removed by age-based retention. Published rows remain available for queue-loss recovery for `DOMAIN_EVENT_PUBLISHED_RETENTION_DAYS`, which defaults to 30 days. Keep every parser for a payload version until all rows using it have left that horizon. Queue completed/failed history is a separate operational retention policy.

Inspect a recovery range without changing it:

```bash
pnpm --filter @eve-space/api outbox:redrive -- \
  --from 2026-08-01T00:00:00Z \
  --to 2026-08-02T00:00:00Z \
  --time-field publication \
  --limit 1000 \
  --dry-run
```

After operators have stopped producers and workers and confirmed that queue data was intentionally lost or discarded, remove `--dry-run` and add `--confirm-queue-discard`. Before changing PostgreSQL, the command verifies that BullMQ has no retained job under any selected event's deterministic ID; unrelated scheduled jobs do not block recovery. The command reopens the original event IDs and starts their pending-age clock at re-drive; it does not create new event occurrences or bypass consumer idempotency. Repeat bounded ranges until the dry-run count reaches zero, then start the worker.

### Outbox operator exercise

Run this only against disposable local Compose queue data. It preserves PostgreSQL but deliberately exercises queue-loss handling.

1. Start the API and queue, but stop the worker with `docker compose stop worker`.
2. Through the normal UI or authenticated API, attach a character, detach a non-main character, change main character, or materially change scopes.
3. Call `curl --silent http://localhost:8788/api/status` and verify `services.eventRelay.pendingCount` increased without any event payload appearing.
4. Start the worker with `docker compose up -d --no-build worker`; within the configured lag window, verify the pending count drains and the relay outcome is successful.
5. Exercise the enqueue-success/acknowledgement-failure boundary against real Redis with `pnpm --filter @eve-space/api exec vitest run --config vitest.redis.config.ts tests/integration/redis/worker-platform.test.ts -t "deduplicates concurrent event relay and retries enqueue-success acknowledgement failure"`.
6. With a genuine previous API image and at least one retained event, run the guarded rollback exercise below. It snapshots PostgreSQL recovery, clears only Queue Redis, reopens published events under their original IDs, and verifies worker/API health.

After any interrupted test run, confirm no orphaned Vitest forks or Testcontainers remain before repeating the exercise.

### Rollback verification

`scripts/verify-worker-rollback.sh` is a guarded local-Compose rollback exercise. It requires an already available, previously deployed API image and at least one retained PostgreSQL event. Before deliberately flushing the dedicated queue Redis database, it verifies every authoritative job declares outbox recovery and snapshots the event recovery rows. It confirms that snapshot survives queue discard, verifies selected BullMQ identities are absent, reopens retained published events under their original IDs, restores the current API and worker, waits for the PostgreSQL backlog to drain, and checks worker/API health.

Run it only against disposable local Compose data:

```bash
EVE_SPACE_PREVIOUS_API_IMAGE=registry.example/eve-space-api:previous \
EVE_SPACE_CONFIRM_QUEUE_DISCARD=1 \
./scripts/verify-worker-rollback.sh
```

Do not run it without a real previous image. It intentionally refuses to infer or fabricate one.

## Current SDK Caveat

Live ESI currently returns nullable `ship_type_id` values from `GetUniverseBloodlines`, while `@evespace/esi-client@2.0.0` expects numbers. Response validation is disabled only for that static operation; other ESI responses remain validated.

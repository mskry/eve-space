# EVE Space POC

A small EVE Online character application with:

- Nuxt 4 frontend
- Pinia Colada for typed in-memory remote data, deduplication, and invalidation
- Local Nuxt UI layer with Reka UI primitives
- Hono API and EVE SSO service
- PostgreSQL 17 in OrbStack / Docker Compose
- Redis 7 durable queue/coordination storage and a separate backend worker
- `@evespace/esi-client` for public ESI requests
- Multi-character application accounts with one selectable main character
- Character-ID-scoped overview, skills, wallet, and employment-history views

The Nuxt UI uses routed dashboard sections. The default layout owns the persistent sidebar and top bar, while the authorization route uses a focused auth layout. New integrations register a route and sidebar entry without modifying the shell.

Remote frontend data is organized as typed domain queries under `app/queries/`. Public status data can render during SSR, while session and character-owned requests remain browser-only because Hono owns the credentialed session boundary. Character and wallet query keys include the relevant character identity; logout cancels and clears every private query. Query data remains in memory and is not persisted to browser storage.

Reusable UI behavior and theming live in the auto-registered `layers/ui` Nuxt layer. Reka UI supplies unstyled accessible primitives, while semantic CSS tokens preserve the application's visual identity. The selected Void or High Sec theme is rendered through `data-theme` and persisted in an SSR-readable SameSite cookie. Dashboard navigation uses a collapsible desktop icon rail with Reka tooltips and a modal Reka drawer on mobile. The top-bar status popover reports cached API, PostgreSQL, and Tranquility telemetry.

EVE portraits, corporation/alliance logos, and type images use the official EVE Image Server path contract through `useEveImages`. Browsers load images directly from the configured provider; Hono and Redis do not proxy or store image binaries. Set `NUXT_PUBLIC_EVE_IMAGE_BASE` to a compatible object-storage or CDN origin to move image delivery without changing components.

## Requirements

- Node.js 22.18 or newer
- pnpm 11.22.0 through Corepack
- OrbStack with its Docker engine running
- An EVE Developer application for the SSO flow

## EVE Application

Create an application in the [EVE Developer Portal](https://developers.eveonline.com/applications) and register this exact callback URL:

```text
http://localhost:8788/auth/eve/callback
```

The POC requests protected scopes for each attached character's wallet, location, ship, and skills:

```text
esi-wallet.read_character_wallet.v1
esi-location.read_location.v1
esi-location.read_ship_type.v1
esi-skills.read_skills.v1
```

Each character must be authorized individually. The attachment flow can select a character after signing into the same or a different EVE account; EVE Space does not discover an account's alts automatically. Existing authorizations must be refreshed after adding scopes.

## Environment

Create `.env` from `.env.example`, then supply:

```dotenv
NUXT_PUBLIC_EVE_IMAGE_BASE=https://images.evetech.net
EVE_CLIENT_ID=your-client-id
EVE_CLIENT_SECRET=your-client-secret
TOKEN_ENCRYPTION_KEY=your-base64-encoded-32-byte-key
ADMIN_SETUP_SECRET=your-high-entropy-one-time-setup-secret
```

Generate the encryption key with:

```bash
openssl rand -base64 32
```

The client secret, encryption key, and setup secret must remain server-side. Never provide EVE account credentials to this application; the browser authenticates directly with EVE Online.

Generate a separate setup secret with `openssl rand -base64 32`, then open `/admin/login` directly to create the local deployment owner and select the owning corporation or alliance by EVE organization ID. The Admin navigation remains hidden unless that separate local owner session is authenticated.

## Run

Enable Corepack and install the workspace dependencies:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Start PostgreSQL and the Hono API in OrbStack:

```bash
pnpm stack:up
```

Start Nuxt on the host:

```bash
pnpm dev
```

This starts PostgreSQL, durable queue Redis, the Hono API, and the worker. Open `http://localhost:3000`. The API is available at `http://localhost:8788`.

Useful commands:

```bash
docker compose ps
docker compose logs -f api
docker compose logs -f worker queue-redis
pnpm stack:down
```

## Testing

The Hono routes use Vitest with the typed `testClient()` helper and `app.request()` for raw URL and HEAD behavior. EVE and PostgreSQL boundaries are mocked while routing, validation, cookies, state matching, redirects, and error handling use the real application code.

```bash
pnpm lint
pnpm format:check
pnpm test:frontend
pnpm --filter @eve-space/api test
pnpm --filter @eve-space/api test:coverage
pnpm --filter @eve-space/api test:redis
pnpm --filter @eve-space/api test:postgres
```

Run `pnpm lint:fix` for safe lint fixes and `pnpm format` to format supported files.

Coverage thresholds cover SSO routes, session middleware, character resources, status telemetry, the wallet cache/quota state machine, and queue registry/admission/scheduling behavior. `test:redis` runs its own thresholded Testcontainers suite against Redis 7.4 Alpine; `test:postgres` exercises real PostgreSQL migration and token-refresh coordination.

## Service Boundaries

```text
Browser -> Nuxt :3000 -> Hono API :8788 -> PostgreSQL :5432
                              |                  ^
                              +-> EVE SSO and ESI |
                       Queue Redis :6379 <- Worker (no HTTP)
                            (durable)
```

Nuxt does not hold EVE credentials or call `@evespace/esi-client`. The API and worker share server-only ESI, OAuth, character ownership, token encryption, session, and persistence behavior. An EVE Space user can own multiple individually authorized characters, and each character route loads resources for its explicit owned character ID.

Nuxt constructs EVE Image Server URLs locally and lets browsers fetch those public assets directly. Image requests do not consume Hono or ESI API capacity.

The API exports its chained Hono `AppType`. Nuxt uses `hono/client` to build URLs, send authenticated requests, and infer success response types directly from route handlers. HTTP path and query inputs are validated with Zod before handlers run.

`@evespace/esi-client`, `@hono/zod-validator`, and the API share Zod 4. The SDK validates ESI wire responses, while Hono schemas validate this application's HTTP inputs; API response DTOs remain an intentional boundary rather than exposing ESI payloads directly.

## API Routes

- `GET /health` checks API and PostgreSQL availability.
- `GET /api/status` returns cached API, PostgreSQL, and Tranquility telemetry.
- `GET /api/me/characters` returns the authenticated user's attached character roster.
- `GET /api/me/characters/:characterId` returns an owned character's profile, location, ship, and skill-point summary.
- `PATCH /api/me/characters/:characterId/main` atomically selects an owned character as the account main.
- `GET /api/me/characters/:characterId/skills` returns owned live skills grouped with local SDE names.
- `GET /api/me/characters/:characterId/wallet` returns the owned character's protected wallet balance.
- `GET /api/me/characters/:characterId/history` returns the owned character's public corporation employment history.
- `GET /auth/config` reports EVE SSO configuration and safe login/attachment URLs.
- `GET /auth/eve/start` starts login authorization.
- `GET /auth/eve/attach` starts an authenticated character attachment.
- `GET /auth/eve/reauthorize/:characterId` refreshes authorization for an owned character.
- `GET /auth/eve/callback` verifies intent-bound state, exchanges the code, and validates the JWT.
- `GET /auth/session` returns the application user and nested current-main summary.
- `POST /auth/logout` revokes the local session.

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
- Wallet responses are private browser caches and are retained server-side until ESI's `Expires` time.
- Expired wallet entries revalidate with ETag or Last-Modified and reuse data on `304`.
- Concurrent wallet requests are collapsed, and `429` plus low error-budget responses trigger cooldowns.

## Database

The migrations create users, one-to-many attached characters, encrypted per-character EVE tokens, intent-bound OAuth states, sessions, transactional domain events, SDE reference tables, and migration history. A partial unique index prevents more than one main character per user. Migrations run automatically when the API container starts.

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

Inspect only aggregate queue state through `GET /api/status`; it reports reachability, worker heartbeat, depth, lag, active/retrying/failed counts, planner and outbox pause states, scheduler state, and the latest sanitized relay outcome without Redis endpoints, keys, or payloads. The separate `eventRelay` section reports pending PostgreSQL event count and oldest age. The queue keyspace is versioned under `eve-space:v1`; change the version only with an explicit migration/recovery plan.

To retry failed derived diagnostics after addressing a dependency, use a private operator shell with BullMQ's `queue.retryJobs({ state: 'failed' })`. To cancel pending derived work, use `queue.remove(jobId)` for a specific waiting or delayed job, or `queue.drain(true)` only after stopping workers and producers. Do not use `obliterate` on a running queue.

For queue disaster recovery, stop API producers and workers, restore the Redis AOF/data volume, start queue Redis, then start workers and API. Derived jobs are reconstructed by their planners. Authoritative event jobs are reconstructed from retained PostgreSQL `domain_events` only through the guarded re-drive command below; restarting the worker automatically relays events that were never marked published but does not assume already-published work was lost. PostgreSQL remains authoritative; do not place EVE tokens, credentials, session bearers, encryption material, event payloads, or secrets in queue payloads, names, logs, or Redis keys.

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

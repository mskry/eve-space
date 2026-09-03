# Railway deployment

EVE Space normally runs as six Railway services in one region:

| Service       | Source               | Persistent | Public |
| ------------- | -------------------- | ---------- | ------ |
| `web`         | root `Dockerfile`    | no         | yes    |
| `api`         | `api/Dockerfile`     | no         | yes    |
| `worker`      | `api/Dockerfile`     | no         | no     |
| `postgres`    | Railway PostgreSQL   | yes        | no     |
| `queue-redis` | `redis:7.4.7-alpine` | `/data`    | no     |
| `cache-redis` | `redis:7.4.7-alpine` | no         | no     |

Run SDE ingestion as a one-shot deployment from `sde-ingest/Dockerfile` after migrations and whenever a new SDE projection is required. It is not a continuously running seventh service.

## Domains

Production authentication requires the web and API to be same-site. Use sibling custom domains such as `app.example.com` and `api.example.com`; separate `*.up.railway.app` domains are cross-site because `railway.app` is a public suffix.

Configure:

```dotenv
NUXT_PUBLIC_API_BASE=https://api.example.com
WEB_ORIGIN=https://app.example.com
EVE_CALLBACK_URL=https://api.example.com/auth/eve/callback
SESSION_COOKIE_SECURE=true
```

Register the exact `EVE_CALLBACK_URL` in the EVE Developer Portal. Do not change the session cookies to `SameSite=None` as a substitute for same-site domains.

If no custom domain is available, add a seventh `gateway` service from `gateway/Dockerfile`. Give only the gateway a Railway-provided public domain, set its healthcheck to `/health`, and configure:

```dotenv
# gateway
API_UPSTREAM=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:8080
WEB_UPSTREAM=http://${{web.RAILWAY_PRIVATE_DOMAIN}}:8080

# web
NUXT_PUBLIC_API_BASE=https://gateway-domain.up.railway.app

# api
WEB_ORIGIN=https://gateway-domain.up.railway.app
EVE_CALLBACK_URL=https://gateway-domain.up.railway.app/auth/eve/callback
```

The gateway routes `/api/*` and `/auth/*` to Hono and all other requests to Nuxt, making the Railway domain a single first-party origin. Remove the direct Railway-provided domains from `web` and `api` after gateway verification.

## Service configuration

Build every repository service from the repository root. Set `RAILWAY_DOCKERFILE_PATH=/api/Dockerfile` on `api` and `worker`, and `/sde-ingest/Dockerfile` on the one-shot ingestion service. Keep the image default command for `api`; override `worker` with `node dist/worker.js`.

Use `/health` as the Railway healthcheck for `web` and `api`. The worker intentionally has no HTTP socket. Set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=40` on the worker and monitor its heartbeat through the API's `/api/status` response.

The queue Redis command must preserve durable BullMQ state:

```text
redis-server --appendonly yes --appendfsync always --maxmemory 512mb --maxmemory-policy noeviction
```

Attach a persistent volume at `/data` and enable volume backups. The disposable cache Redis command is:

```text
redis-server --appendonly no --save "" --maxmemory 256mb --maxmemory-policy allkeys-lfu
```

Do not attach a volume to cache Redis. Keep PostgreSQL and both Redis services on private networking only.

The API queue probe reports Redis `memoryUsedBytes`, `memoryMaxBytes`, and `memoryUsedPercent` through `/api/status` and degrades queue and system status when usage reaches 90% of `maxmemory`. Alert on that degraded state so queue capacity can be increased before `noeviction` rejects BullMQ writes.

## Variables

Set these on both `api` and `worker` unless noted otherwise:

```dotenv
NODE_ENV=production
DATABASE_URL=${{postgres.DATABASE_URL}}
QUEUE_REDIS_URL=redis://${{queue-redis.RAILWAY_PRIVATE_DOMAIN}}:6379
CACHE_REDIS_URL=redis://${{cache-redis.RAILWAY_PRIVATE_DOMAIN}}:6379
EVE_CLIENT_ID=...
EVE_CLIENT_SECRET=...
EVE_SCOPES=...
ESI_USER_AGENT=...
ESI_COMPATIBILITY_DATE=...
TOKEN_ENCRYPTION_KEY=...
```

The API additionally needs `WEB_ORIGIN`, `EVE_CALLBACK_URL`, `SESSION_COOKIE_SECURE=true`, and an initial `ADMIN_SETUP_SECRET`. Generate secrets with `openssl rand -base64 32`. Remove `ADMIN_SETUP_SECRET` after the first administrator is created if bootstrap should be disabled.

The web needs `NUXT_PUBLIC_API_BASE`. The SDE ingestion deployment needs only `${{postgres.DATABASE_URL}}`.

## Rollout and verification

1. Provision PostgreSQL and the two Redis services.
2. Deploy `api`; its container runs migrations before opening the HTTP socket.
3. Deploy `worker`; it verifies the migration ledger and queue Redis before consuming work.
4. Run the SDE ingestion deployment and require a successful exit.
5. Deploy `web`.
6. Verify `GET /health` on web and API, then inspect `GET /api/status` for PostgreSQL, both Redis roles, outbox, queue lag, and worker heartbeat.
7. Complete EVE login, callback, character attachment, and one protected character request on the custom domains.

## Continuous deployment

Connect the `web`, `api`, `worker`, and `gateway` services to the GitHub repository's `main` branch and enable **Wait for CI** on every deployment trigger. The repository CI workflow runs on pushes to `main`, so Railway deploys a commit only after all GitHub Actions checks succeed and skips it when any check fails.

Leave watch paths unset unless every shared workspace, lockfile, configuration, and generated-contract dependency is represented. Rebuilding all four application services is safer than allowing a shared monorepo change to skip a required deployment. Do not connect PostgreSQL or either Redis service to the repository, and keep SDE ingestion as a deliberate one-shot deployment.

Use Railway volume backups for PostgreSQL and queue Redis. Never expose PostgreSQL or either Redis service through public TCP networking.

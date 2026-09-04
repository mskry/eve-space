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

Production authentication requires the web and API to be same-site. Use an apex and API subdomain such as `example.com` and `api.example.com`, or sibling custom domains such as `app.example.com` and `api.example.com`. Separate `*.up.railway.app` domains are cross-site because `railway.app` is a public suffix.

Configure:

```dotenv
NUXT_PUBLIC_API_BASE=https://api.example.com
WEB_ORIGIN=https://example.com
EVE_CALLBACK_URL=https://api.example.com/auth/eve/callback
SESSION_COOKIE_SECURE=true
```

Register the exact `EVE_CALLBACK_URL` in the EVE Developer Portal. Do not change the session cookies to `SameSite=None` as a substitute for same-site domains.

On Railway, set `NUXT_PUBLIC_API_BASE=https://${{api.RAILWAY_PUBLIC_DOMAIN}}` so the value follows the API custom domain and the project canvas displays the `web` to `api` dependency. The resolved browser value remains the public HTTPS URL; do not use the private service domain for browser requests.

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

## Credential rotation

Treat output from `railway variable list --json` and `--kv` as secret-bearing. Filter to variable names when auditing configuration, never paste resolved values into logs, issues, or chat, and pass replacements through `railway variable set KEY --stdin` instead of command-line arguments that remain in shell history.

The production credentials have different rotation requirements:

| Credential             | Consumers                   | Rotation constraint                                                                                                                                                   |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_SETUP_SECRET`   | `api`                       | Remove it after initial setup; existing administrator accounts and sessions do not depend on it.                                                                      |
| `EVE_CLIENT_SECRET`    | `api`, `worker`             | Replace it in the EVE Developer Portal and both services as one rollout. A mismatch prevents authorization and token refresh.                                         |
| `TOKEN_ENCRYPTION_KEY` | `api`, `worker`, PostgreSQL | Every `eve_tokens.encrypted_tokens` value uses this key. Replacing it without migrating or deleting those rows makes all stored EVE tokens unreadable.                |
| PostgreSQL password    | PostgreSQL, `api`, `worker` | Change the database role password and the Railway source variable together. Changing only `POSTGRES_PASSWORD` does not update an already initialized PostgreSQL role. |

Use this sequence after suspected disclosure:

1. Restrict project access, review Railway and GitHub access history, schedule a maintenance window, and create a verified PostgreSQL backup. Generate every replacement independently in a password manager or another non-logging secret generator.
2. Delete `ADMIN_SETUP_SECRET` from `api` when deployment setup is complete. Do not replace or restore it unless deployment bootstrap must deliberately be reopened.
3. Replace the EVE application secret in the EVE Developer Portal. Set the same new `EVE_CLIENT_SECRET` on `api` and `worker` with deployments skipped until both values are staged, then deploy both services and verify EVE authorization and one protected request.
4. Rotate `TOKEN_ENCRYPTION_KEY` using one of the paths below. Do not retain the old key in an ordinary Railway variable as a fallback.
5. Rotate the PostgreSQL password using an authenticated `railway connect postgres --ssh` session. Keep that session open, use psql's `\password` command so the new value is not written into SQL or shell history, and immediately set the same value as the PostgreSQL service's `POSTGRES_PASSWORD`. Keep `PGPASSWORD` and `DATABASE_URL` as references derived from that source variable, and keep application `DATABASE_URL` values as `${{postgres.DATABASE_URL}}`; do not create independent password copies. Redeploy PostgreSQL, `api`, and `worker`, and update any future one-shot SDE ingestion deployment before it runs.
6. Require successful deployments with one running replica each. Verify `/health`, every dependency in `/api/status`, EVE login and callback, a token refresh or protected character request, and administrator login. Check logs for database authentication, OAuth, token decryption, and worker heartbeat errors without printing configuration.

For a small deployment where forced reauthorization is acceptable, stop `api` and `worker` for the maintenance window, delete all `eve_tokens` rows, set the same new base64-encoded 32-byte `TOKEN_ENCRYPTION_KEY` on both services, and deploy them together. User and character records and application sessions remain, but every character-owned integration stays unavailable until that character completes EVE reauthorization. Clear unconsumed `oauth_states` as part of the window so no authorization flow spans the key and client-secret change.

If authorization continuity is required, first implement and test a one-shot migration that accepts the old and new keys separately, decrypts and re-encrypts every token while `api` and `worker` are stopped, verifies the migrated row count in one transaction, and then removes the old key before either service starts. The current runtime supports one encryption key only, so an ad hoc in-place key replacement is not a continuity-safe procedure.

Application and administrator session bearer values are independently random and stored only as SHA-256 hashes. Rotating the credentials above does not invalidate those sessions. Delete `sessions` and `admin_sessions` only when raw session bearers or database contents may also have been disclosed and forced sign-out is part of the incident response.

Do not roll production back to a disclosed secret. If PostgreSQL authentication fails, use the still-open administrative connection to set another fresh password and reconcile Railway variables. Keep a pre-rotation database backup only for offline recovery; restoring old token ciphertext and its disclosed encryption key into service would undo containment.

## Rollout and verification

1. Provision PostgreSQL and the two Redis services.
2. Deploy `api`; its container runs migrations before opening the HTTP socket.
3. Deploy `worker`; it verifies the migration ledger and queue Redis before consuming work.
4. Run the SDE ingestion deployment and require a successful exit.
5. Deploy `web`.
6. Verify `GET /health` on web and API, then inspect `GET /api/status` for PostgreSQL, both Redis roles, outbox, queue lag, and worker heartbeat.
7. Complete EVE login, callback, character attachment, and one protected character request on the custom domains.

## Continuous deployment

Connect the `web`, `api`, and `worker` services to the GitHub repository's `main` branch and enable **Wait for CI** on every deployment trigger. The repository CI workflow runs on pushes to `main`, so Railway deploys a commit only after all GitHub Actions checks succeed and skips it when any check fails.

Set these root-relative watch paths on `web`:

```gitignore
/Dockerfile
/.dockerignore
/package.json
/pnpm-lock.yaml
/pnpm-workspace.yaml
/.npmrc
/.pnpmfile.*
/.nuxtrc
/nuxt.config.*
/tsconfig*.json
/colada.options.*
/app.config.*
/nitro.config.*
/vite.config.*
/postcss.config.*
/tailwind.config.*
/app/**
/server/**
/public/**
/layers/**
/generated/platform/**
/api/package.json
/api/src/**
/packages/platform-module-contract/**
/packages/platform-module-server/**
/packages/platform-module-nuxt/**
/features/**
/scripts/run-installed-module-package-script.ts
!/**/*.md
!/**/README*
!/**/docs/**
!/**/test/**
!/**/tests/**
!/**/*.test.*
!/**/*.spec.*
```

Set this identical list on `api` and `worker` because they build the same image:

```gitignore
/api/Dockerfile
/.dockerignore
/package.json
/pnpm-lock.yaml
/pnpm-workspace.yaml
/.npmrc
/.pnpmfile.*
/api/package.json
/api/tsconfig.json
/api/src/**
/api/migrations/**
/packages/platform-module-contract/**
/packages/platform-module-server/**
/features/installed-modules.json
/features/*/module.config.*
/features/*/server/**
/scripts/run-installed-module-package-script.ts
!/**/*.md
!/**/README*
!/**/docs/**
!/**/test/**
!/**/tests/**
!/**/*.test.*
!/**/*.spec.*
```

Railway evaluates these as ordered gitignore-style patterns, so exclusions must remain after the inclusion rules. The web list includes `api/src` because Nuxt imports the Hono `AppType` contract directly. Root manifests, the lockfile, Docker inputs, shared packages, generated registries, and installed feature inputs remain covered, while documentation, tests, CI, and SDE-only changes do not deploy these services. Add any future production input before relying on its exclusion.

Do not connect PostgreSQL or either Redis service to the repository, and keep SDE ingestion as a deliberate one-shot deployment.

Use Railway volume backups for PostgreSQL and queue Redis. Never expose PostgreSQL or either Redis service through public TCP networking.

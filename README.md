# EVE Space POC

A small EVE Online character application with:

- Nuxt 4 frontend
- Pinia Colada for typed in-memory remote data, deduplication, and invalidation
- Local Nuxt UI layer with Reka UI primitives
- Hono API and EVE SSO service
- PostgreSQL 17 in OrbStack / Docker Compose
- `@evespace/esi-client` for public ESI requests
- Multi-character application accounts with one selectable main character
- Character-ID-scoped overview, skills, wallet, and employment-history views

Redis and a background worker are intentionally not part of this first POC.

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

Open `http://localhost:3000`. The API is available at `http://localhost:8788`.

Useful commands:

```bash
docker compose ps
docker compose logs -f api
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
```

Run `pnpm lint:fix` for safe lint fixes and `pnpm format` to format supported files.

Coverage thresholds cover SSO routes, session middleware, character resources, status telemetry, and the wallet cache/quota state machine.

## Service Boundaries

```text
Browser -> Nuxt :3000 -> Hono :8788 -> PostgreSQL :5432
                             |
                             +-> EVE SSO and ESI
```

Nuxt does not hold EVE credentials or call `@evespace/esi-client`. Hono owns public ESI requests, OAuth callbacks, character ownership checks, token encryption, sessions, and persistence. An EVE Space user can own multiple individually authorized characters, and each character route loads resources for its explicit owned character ID.

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

The migrations create users, one-to-many attached characters, encrypted per-character EVE tokens, intent-bound OAuth states, sessions, SDE reference tables, and migration history. A partial unique index prevents more than one main character per user. Migrations run automatically when the API container starts.

PostgreSQL data is retained in the `postgres_data` Compose volume. To intentionally delete local database data:

```bash
docker compose down --volumes
```

## Current SDK Caveat

Live ESI currently returns nullable `ship_type_id` values from `GetUniverseBloodlines`, while `@evespace/esi-client@2.0.0` expects numbers. Response validation is disabled only for that static operation; other ESI responses remain validated.

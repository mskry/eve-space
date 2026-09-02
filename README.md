# EVE Space

[![CI](https://github.com/mskry/eve-space/actions/workflows/ci.yml/badge.svg)](https://github.com/mskry/eve-space/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=mskry_eve-space&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mskry_eve-space)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mskry_eve-space&metric=coverage)](https://sonarcloud.io/summary/overall?id=mskry_eve-space)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

EVE Space is a self-hosted management platform for EVE Online corporations and alliances. It is
being built for organizations that want a modern member experience without giving up control of
their data, access rules, or deployment.

Members sign in through EVE Online and authorize each character they choose to attach. EVE Space
uses that verified character state for personal tools and organization access, while keeping hosting
administration separate from in-game corporation or alliance authority.

<p align="center">
  <img src="docs/images/demo.gif" alt="EVE Space walkthrough" width="720">
</p>

## Implemented

- Run a deployment for one corporation or an alliance and its member corporations
- Let each member attach multiple characters and choose a main character
- View character details, location, active ship, skills, wallet activity, employment history, and mail
- Read and compose EVE mail, manage labels, find recipients, and estimate CSPA charges
- Verify an EVE-backed organization owner and delegate HR or director authority independently from hosting administration
- Evaluate attached-character registration compliance and enforce version-bound organization access
- Inspect per-corporation roster coverage without presenting missing or stale data as complete
- Compose statically installed first-party modules without rebuilding the shared dashboard shell

EVE SSO authorizes one selected character at a time. It cannot discover every character on an EVE
account or prove that a member has no undisclosed characters; EVE Space reports only the characters
and roster coverage it can actually observe.

## Project Status

EVE Space is under active pre-release development. The current implementation includes
multi-character authentication, character and mail tools, durable background work, resilient ESI
access, first-party module composition, and the core organization governance foundation. The
activity-first landing page, activity source modules, and complete member/HR compliance experience
are still in progress.

Feedback, issue reports, technical review, and contributions are welcome. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) to get started.

## Roadmap

Current planned direction includes:

- Complete the organization action queue with corporation projects, freelance jobs, military campaigns, exact-character participation, freshness, and explicit alliance coverage
- Add privacy-aware strategic, economic, infrastructure, production, logistics, and combat signals for the audiences authorized to see them
- Expand owned-character readiness with Member Audit, personal finance, assets, clones, implants, and combat history
- Add provider-neutral delivery through Discord, Slack, and signed webhooks; link Discord identities; synchronize only explicitly managed, least-privilege Discord roles; and complete an observe-only staged rollout

Roadmap items describe planned direction, not functionality available in the current build.

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
esi-markets.read_character_orders.v1
esi-contracts.read_character_contracts.v1
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
esi-corporations.read_corporation_membership.v1
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

## Quality and Testing

Every pull request and push to `main` runs two GitHub Actions workflows:

- [`CI`](.github/workflows/ci.yml) checks linting, formatting, types, unit tests, module tests, packaging, and the production build.
- [`Coverage`](.github/workflows/coverage.yml) runs the frontend, API, module, PostgreSQL, Redis, and registry coverage suites, retains their LCOV reports as a workflow artifact, and sends them to SonarQube Cloud.

The API coverage suite enforces minimums of 80% for lines, functions, and statements and 75% for
branches. The badges at the top of this README show the live quality gate and combined coverage from
the default branch rather than a manually entered score. See
[`docs/local-sonarqube.md`](docs/local-sonarqube.md) to run the same analysis locally.

Run the same core checks locally:

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

Coverage suites exercise SSO, administrator and organization authorization, compliance, character, corporation and mail resources, module composition, status telemetry, ESI cache/quota behavior, and queue scheduling. `test:redis` runs a thresholded Testcontainers suite against Redis 7.4 Alpine; `test:postgres` exercises real PostgreSQL migrations and coordination behavior.

## Architecture

Detailed service boundaries, API routes, security decisions, persistence, Redis operations, ESI
resilience, and background-work recovery are documented in
[`docs/architecture.md`](docs/architecture.md).

## License

Copyright (C) 2026 skrypets@gmail.com

EVE Space is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE).

You may run EVE Space for your own corporation or alliance, modify it, and share it. If you run a
modified version as a network service, the AGPL requires you to offer that version's complete
corresponding source to its users.

## EVE Online Intellectual Property

EVE Online and the EVE logo are the registered trademarks of CCP hf. All rights reserved. All EVE
Online-related materials are property of CCP hf. This includes the EVE Online data served through
ESI, the Static Data Export, and the screenshots and recordings under `docs/images/`, none of which
are covered by the license above.

EVE Space is a third-party application and is not affiliated with, endorsed by, or sponsored by CCP
hf. Deployments must comply with the
[EVE Online Developer License Agreement](https://developers.eveonline.com/license-agreement) and the
EVE Online Terms of Service.

# @evespace/esi-client

[![npm](https://img.shields.io/npm/v/@evespace/esi-client.svg)](https://www.npmjs.com/package/@evespace/esi-client)
[![ESI Client](https://github.com/mskry/eve-space/actions/workflows/esi-client.yml/badge.svg)](https://github.com/mskry/eve-space/actions/workflows/esi-client.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=mskry_eve-space_esi-client&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mskry_eve-space_esi-client)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mskry_eve-space_esi-client&metric=coverage)](https://sonarcloud.io/summary/overall?id=mskry_eve-space_esi-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An ESM-only TypeScript SDK for EVE Online ESI, centered on `EsiClient` and generated from a pinned, corrected OpenAPI specification.

```ts
import { EsiClient } from '@evespace/esi-client';

const client = new EsiClient();
const status = await client.status.get();
```

`new EsiClient()` uses the standard ESI base URL and the package's pinned compatibility date, **2026-08-18**.

For one domain without loading the aggregate client, construct it from its subpath:

```ts
import { createStatusClient } from '@evespace/esi-client/domains/status';

const statusClient = createStatusClient();
const status = await statusClient.get();
const response = await statusClient.withMetadata().get();
```

## Install

```sh
npm install @evespace/esi-client zod
```

Zod `^4.5.4` is a required peer dependency. The package requires Node.js 24.20 or newer and publishes ESM only: use `import`, not CommonJS `require`.

## Authenticated Domain Call

Configure either `token` or an asynchronous `tokenProvider`. Credentials are resolved only for authenticated requests and are excluded from metadata and structured errors.

```ts
import { EsiClient } from '@evespace/esi-client';

const accessToken = process.env.ESI_ACCESS_TOKEN;
if (!accessToken) throw new Error('Set ESI_ACCESS_TOKEN before making this authorized request.');

const client = new EsiClient({ token: accessToken });
const characterId = 90000001;
const location = await client.location.get(characterId);
```

Required path identifiers are positional. Optional query and header values, including a per-operation compatibility-date override, are grouped in a final typed options object.

## Runtime Behavior

- Date and date-time values remain their JSON wire-format strings. The SDK does not transform them into JavaScript `Date` objects.
- Successful JSON responses are validated with generated Zod schemas by default. Set `validateResponses: false` to opt out.
- Typed request validation is off by default; opt in with `validateRequests: true`. Generic operation arguments are always validated before network activity.
- Domain methods return bare validated data. Use `client.<domain>.withMetadata().<method>(...)` for an `EsiResponse<T>` containing status, headers, request ID, pagination, cache, and ESI error-limit metadata.
- Compatibility date `2026-08-18` is pinned by default. Override it on the client with `new EsiClient({ compatibilityDate: 'YYYY-MM-DD' })` or in a domain method's final options object.

## Discovery And Generic Execution

Import `searchOperations` and `describeOperation` from `@evespace/esi-client/operations` to discover stable operation IDs and serializable contracts. Execute one validated request with `client.callOperation(stableId, arguments)`; generic execution always returns an `EsiResponse<T>` and never follows pagination automatically.

Domain methods use concise reviewed names such as `client.location.get(characterId)`. Stable OpenAPI operation IDs such as `GetCharactersCharacterIdLocation` remain unchanged for discovery, descriptions, schemas, diagnostics, and generic `callOperation` execution.

Generic mutations are denied by default. They require both `allowGenericMutations: true` when constructing the client and `{ confirmMutation: true }` on the individual `callOperation`. Named typed mutation methods express explicit caller intent and do not use these generic gates.

## Imports And Documentation

The root export is the convenient entry point. ESM subpaths provide narrower imports:

- `@evespace/esi-client/operations` for discovery, descriptors, and generic execution types
- `@evespace/esi-client/types` for natural generated request and response types
- `@evespace/esi-client/zod` for matching natural generated Zod schemas
- `@evespace/esi-client/domains/<domain>` for one generated domain client

For example, the status operation exposes these natural generated symbols:

```ts
import type {
  GetStatusData,
  GetStatusResponse,
  GetStatusResponses,
} from '@evespace/esi-client/types';
import { zGetStatusHeaders, zGetStatusResponse, zStatus } from '@evespace/esi-client/zod';
```

Method option interfaces use stable operation IDs, for example `GetAlliancesAllianceIdIconsOptions`, matching the operation's generated data, response, schemas, descriptor, manifest entry, and discovery identity. Their globally unique names are available from both the package root and corresponding domain subpath.

Every domain subpath exports a `create<Domain>Client` factory, such as `createStatusClient`. Factories accept the same client options applicable to `EsiClient`; domain client contracts are exported as TypeScript interfaces while configuration plumbing remains internal.

Domain subpaths reduce the runtime and TypeScript declaration graph reached by an import. They do not reduce npm installation size: the installed tarball still contains all domains, aggregate discovery metadata, and generated type and schema entries.

Start with the repository [`llms.txt`](llms.txt), then retrieve only the documentation needed:

- Concepts: [client configuration](docs/generated/concepts/client.md), [validation](docs/generated/concepts/validation.md), [metadata and pagination](docs/generated/concepts/metadata-pagination.md), and [mutation safety](docs/generated/concepts/mutation-safety.md)
- Domain: [location](docs/generated/domains/location.md)
- Operation: [`GetCharactersCharacterIdLocation`](docs/generated/operations/GetCharactersCharacterIdLocation.md)

The generated domain indexes link focused references for every supported operation; there is intentionally no monolithic endpoint list here.

## Development

Development uses Node.js 24.20+ and pnpm 11.22.0 from the EVE Space monorepo root. The package is owned and released independently but uses the root runtime pins, lockfile, and workspace configuration.

Run `pnpm esi:validate` from the repository root for generation reproducibility, documentation and example checks, formatting, linting, TypeScript 7 type checking, tests, build and package validation, installed-package smoke tests, and artifact inspection. Focused commands include `pnpm esi:generate:check`, `pnpm esi:package:check`, and `pnpm esi:smoke:package`.

Source generation uses exactly `@hey-api/openapi-ts@0.99.0` through the private `@evespace/esi-client-codegen` workspace package. Hey API is internal build-time tooling configured only for its bundled TypeScript and Zod plugins. It emits natural TypeScript and Zod 4 artifacts, not the SDK client or runtime; the request serializer, executor, domain facade, operation registry, and EVE-specific behavior remain maintained in this repository.

`pnpm --filter @evespace/esi-client generate` and `generate:check` operate offline from the committed corrected snapshot at `openapi/generated/esi-openapi.json`. The first replaces generated source, documentation, examples, tests, and OpenAPI artifacts atomically; the second reproduces and compares the complete generated target set without modifying the worktree. `generate:source:refresh` is the only networked generation path. It retrieves the ESI specification, applies the repository corrections, validates and records provenance, then generates from that staged corrected document.

Keep the generator pinned exactly. Any pin change must pass full generation, semantic, package, and installed-tarball validation before it is accepted.

Run `pnpm --filter @evespace/esi-client test:coverage` to produce the package-owned `coverage/lcov.info`. Local analysis uses `pnpm sonar:esi-client` with a package project token in the ignored `packages/esi-client/.env.sonar`; `pnpm quality:sonar:esi-client` generates coverage and scans together. The package has a separate Sonar project and quality gate from the application. Its GitHub workflow retains the package LCOV artifact for 14 days; fork pull requests run validation and coverage without receiving the scanner secret.

## Releases

Package releases use annotated scoped tags named `@evespace/esi-client@<version>`.

To release, update this package's version and changelog in a reviewed commit and merge it to `main` only after `CI`, root `Coverage`, and `ESI Client` checks succeed. Create an annotated tag at that exact commit and push it:

```bash
git tag -a '@evespace/esi-client@3.0.0' -m '@evespace/esi-client@3.0.0'
git push origin '@evespace/esi-client@3.0.0'
```

The tag-triggered workflow verifies stable tag syntax, package and changelog versions, annotation, `origin/main` ancestry, and registry nonexistence. It runs the complete package validation on Node.js 24.20, transfers exactly one tested tarball and SHA-256 digest, then publishes those bytes from the same Node.js release through npm trusted publishing with automatic provenance. It never uses a long-lived npm write token or republishes a duplicate version.

Before the first automated release, create the GitHub `npm` environment, restrict it to the scoped tag pattern, and configure npm trusted publishing for repository `mskry/eve-space`, workflow `esi-client-publish.yml`, environment `npm`, and direct publish permission. Protect scoped package tags so only authorized maintainers can create them. Do not push a release tag until these external settings are complete.

## License

MIT © Mykola Skrypets

The internal generator uses `@hey-api/openapi-ts@0.99.0`, distributed under the MIT License. It is not a runtime dependency or part of the published package graph.

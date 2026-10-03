# GraphQL application API

This guide records the shared read-admission and module contribution contracts for the read-only
GraphQL increment. The endpoint, generated operations and explorer are implemented and tracked in
`introduce-module-aware-graphql-api`.

## Admission strategies

| Strategy                             | Required authority                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public module read                   | Installed module and declared section enabled. No member session or organization membership.                                                                                    |
| Authenticated-session read           | Live member session. An organization policy is applied only when declared.                                                                                                      |
| Core owned-character read            | Explicit validated character ID, live member session, exact current ownership and subject lifecycle, current EVE authorization revision and the resource's required scope.      |
| Organization-member module read      | Enabled module/section plus current-version organization compliance, block, audience and every declared permission. An owned-character read may additionally carry this policy. |
| Reviewer or deployment administrator | Separate existing Hono authority. Neither substitutes for member identity or ownership; GraphQL support is outside this read increment.                                         |

Core assets remain available to their owner without organization membership. A main-character
session identifies the account; it never changes the explicitly selected subject. Unknown and
non-owned characters have the same `CHARACTER_NOT_FOUND` outcome. An administrator cookie alone
cannot authorize assets.

## Shared interface and owners

- `api/src/auth/read-policy.ts` owns safe denial contracts and `ReadAdmissionError`.
- `api/src/auth/read-admission.ts` admits a member session, exact owned character, or scoped owned
  read. It reads authorization metadata rather than credentials and freezes admitted bindings.
- `api/src/auth/read-work.ts` owns the work-slot contract. A limiter may supply a slot-local runner
  to its callback so authorization checks use the acquired slot without recursively acquiring it.
- `api/src/auth/admitted-read.ts` constructs a named owned read with a captured binding, an identity
  suitable for request-local keys, `assertCurrent()` and `read(input)`. The host supplies a live
  member-session loader. The implementation receives the fixed owner and subject; the caller's
  input does not replace them.
- `api/src/organization/read-admission.ts` translates the existing organization contribution
  decisions into transport-independent admission outcomes. The existing organization owner still
  decides compliance, audience and exact permissions, including additional required permissions.
- `api/src/platform/read-enablement.ts` is the module/section gate shared with Hono middleware.
- `api/src/platform/read-admission.ts` composes these owners into an immutable contribution/read
  binding. It reloads current organization session context through the organization owner and
  binds organization version, audience, permission inventory and entitlement scope.
- `api/src/platform/module-context-capabilities.ts` constructs the narrow session/owned contexts
  used by the Hono module adapters, including fixed-subject affiliation and collection-status reads.
- `api/src/platform/module-route-capabilities.ts` constructs admitted read-only core-data and
  persistence capabilities through `createPlatformModuleReadCapabilities`. Persistence methods
  must match exact installed module/contribution grants and be read-only. Core-data products must
  be explicitly provided by the trusted compiled declaration and permitted in its contribution
  context. There is no SQL, ESI, scheduling or command dispatcher in the supplied capability.
- `api/src/read-value.ts` owns the in-process read-value encoding shared by memo accounting and
  identity fingerprints. It preserves supported scalar values such as `bigint` and `undefined`.

These are host-internal construction interfaces. Feature code receives named read methods, not
the session loader, binding constructor or arbitrary actor/subject selector. Composition itself
performs no feature I/O; persistence execution uses the existing restricted read-only transaction
invoker and statement timeout. Optional work admission wraps actual backend invocations.

## Immutable binding and delayed release

An owned binding fixes user ID, character ID, subject lifecycle, EVE authorization revision and
required scope. A module binding additionally fixes module, contribution, read, section and the
applicable organization context. Permission arrays and subject/declaration objects are copied and
frozen so changes to caller-owned objects cannot broaden an existing grant.

Admission must be repeated before invoking a capability, before returning a request-local reused
result and after asynchronous work before release. `createAdmittedOwnedRead` performs these checks
for owned reads; `createModuleReadGuard` supplies `assertCurrent()` to guarded module methods and
the request-local reuse boundary. Future transport memoization must include that guard identity,
normalized result-changing arguments and pinned source revision; the identity alone is not a grant.

Module memo keys are bounded SHA-256 fingerprints of the admitted identity, arguments and parent
value. Parent payloads remain subject to the retained-result budget rather than the key-length
limit. The shared Node value encoding distinguishes scalar representations such as bigint and
string values; memoization retains the original result for GraphQL scalar completion. Encoded
retained-value bytes and final GraphQL response bytes are separate limits. These encodings and
fingerprints remain request-local and supply no authorization or browser-persistence category.

Queued capability reads recheck immediately after acquiring their work slot, before backend
invocation, using that slot's runner. The guard's ordinary preflight and release checks retain the
request work limiter. Limiters without a slot-local runner use immediate checks within the slot.
Pending token admission schedules the existing exact-lifecycle recovery and returns a temporary
denial until recovered credentials have been verified and promoted.

Rechecks verify the live member session and current owner/lifecycle/revision/scope, repeat
module/section enablement and organization authorization, and reject a changed organization
version or entitlement context. Transfer, revoked scope, pending credential rotation, permission
loss, block, disablement or logout cannot release an old private result. A version/lifecycle/revision
change requires a fresh read rather than silently admitting a replacement context. Ordinary token
refresh that advances the revision can conservatively require restart.

Hono's full-inventory assets adapter now uses this binding and release gate. Its successful DTO,
full collection semantics, exact-character reauthorization URL, existing resource failure outcomes,
`Cache-Control: private, no-store` and `Vary: Cookie` remain transport-owned.

## Safe outcomes and transport translation

Admission returns `{ admitted: true, binding }` or a safe denial with an application status and
intentional body. Organization admission returns its narrow organization context on success.
Hono middleware serializes these outcomes with its established status/body and private policy.
GraphQL adapters can translate the same denial into a field error without importing Hono into
readers or making one field's success authorize another subject.

`api/src/characters/resource-response.ts` owns resource-failure DTOs shared beneath the adapters:
scope-required and revoked-authorization reauthorization guidance, token-refresh unavailability,
cooldown timing, unavailable resources and invalid asset pagination. It takes the public callback
URL explicitly and never reads cookies, tokens or environment configuration. The Hono adapter sets
`Retry-After` for cooldowns and serializes the result.

## Authoring a module contribution

GraphQL is an optional `server.graphql` inventory. Omission normalizes to an empty inventory and
keeps existing modules compatible. The additive host contract is **1.1.0**; a new release using
GraphQL should declare `hostContractRange: '^1.1.0'`. Existing `^1.0.0` releases without the inventory
remain compatible. This is the host protocol version, separate from public package release
versions. Publish matching manifest/server/Nuxt release artifacts and regenerate the installed
registries together; do not rely on an older host understanding a new manifest property.

Use `@eve-space/platform-module-contract/graphql` for pure declaration types and the typed
`definePlatformGraphQLRead` helper. It imports neither Yoga nor the GraphQL runtime. Persistence
types come from `/persistence`, domain-product types from `@eve-space/core-data-contract`, and
operation definitions from `@eve-space/platform-module-server`. Feature packages may use their
own sibling readers. Host compiler, conformance, database, authorization, transport and unrelated
feature implementations are not contribution imports.

The independently packaged fixture lives under
`packages/platform-module-conformance/test/fixtures/release/`. Its manifest declares:

```json
{
  "id": "public-read",
  "exportName": "fixtureGraphQL",
  "rootField": "fixture",
  "types": ["FixtureRead"],
  "reads": [
    {
      "id": "root",
      "field": "Query.fixture",
      "strategy": "public",
      "cost": 1,
      "sourceCost": 0,
      "persistenceOperations": [],
      "coreDataProducts": []
    },
    {
      "id": "value",
      "field": "FixtureRead.value",
      "strategy": "public",
      "cost": 2,
      "sourceCost": 1,
      "persistenceOperations": [{ "operationId": "read-fixture" }],
      "coreDataProducts": []
    }
  ]
}
```

Its server root exports a static descriptor with literal SDL and an explicit read map:

```ts
import {
  definePlatformGraphQLRead,
  type PlatformGraphQLDefinition,
  type PlatformGraphQLReadCapabilities,
} from '@eve-space/platform-module-contract/graphql'

type FixtureCapabilities = PlatformGraphQLReadCapabilities<
  readonly [],
  { readFixture(input: { id: string }): Promise<{ value: string }> }
>

export const fixtureGraphQL = {
  typeDefs: `extend type Query { fixture: FixtureRead }
    type FixtureRead { value: String }`,
  reads: {
    'Query.fixture': () => ({}),
    'FixtureRead.value': definePlatformGraphQLRead<FixtureCapabilities>(
      async ({ capabilities }) =>
        (await capabilities.persistence.readFixture({ id: 'fixture' })).value,
    ),
  },
} satisfies PlatformGraphQLDefinition
```

Only the `value` binding receives `readFixture`; the root receives empty grants. Each executable
root or nested read needs its own stable ID, strategy, costs and exact grants. Field list metadata
contains a positive `defaultSize` and `maximum` (at most 1,000), optionally an argument controlling
its size. Fixed list projections declare the bound without an argument. Argument-bound lists
must match an SDL integer or list argument and its declared default. List defaults are checked
using GraphQL's coerced cardinality, including singleton coercion; integer page-size defaults use
their numeric value. Cost is positive (at most 5,000); source cost is a non-negative bounded
worst-case weight. Limits are conservative metadata,
not permission to bypass stricter domain bounds.

Owned reads require a non-null `EveId` subject argument and may declare `requiredScope`. The host
validates the exact safe numeric identity and supplies an immutable admitted `subject`; it never
substitutes the main character. Organization policy declares audience and exact module-owned
permissions, with optional additional permissions. Public declarations cannot carry protected
policy. Reviewer, administrator, command, scheduling, mutation and subscription inventories fail
compilation. Persistence references must name module-owned read operations; products must exist
and explicitly allow the `graphql-read` context.

Root fields use the module ID without hyphens as a prefix; owned types use its PascalCase prefix.
Market owns `Query.market` and `Market*`. Core reserves `ownedCharacters`, `ownedCharacter`,
`Query`, `Mutation`, `Subscription`, `OwnedCharacter`, `OwnedCharacterConnection`, `Asset`,
`AssetConnection`, `AssetEnrichment`, `AssetSource`, `PageInfo`, built-in scalar names, `EveId`,
`Decimal`, `BigInteger`, `UUID`, `UTCTime`, `UTCDate`, and all introspection names. Contributions
may define their own objects, inputs and enums and extend only their single nullable Query root.
They cannot extend or reference another owner's object types. Core scalars are shared references.

Keep the descriptor literal and side-effect-free: no composition-time I/O, computed/spread
descriptor keys, getters or environment-derived SDL. Named and wildcard relative barrel re-exports
are supported. Wildcard lookup continues across targets without the requested export, with bounded
traversal and strict failures for invalid descriptors, missing targets and cycles.
Publisher/host artifact validation statically inspects the packaged descriptor without
executing it, checks SDL against every read export, and composes sorted SDL before writing any
registry output. Read bindings target output-object fields or the permitted Query extension;
input-object fields cannot be executable bindings. Resolver identifiers must resolve to a local
function declaration or an immutable, statically callable binding. Unresolved imports, mutable
bindings and non-functions are rejected. The typed read helper must be imported from the approved
GraphQL contract export and receive a statically callable callback. DTO property projections use
data properties; callable values and accessors are rejected rather than executed as hidden
resolvers. List projections still need declared bounds.

Run `pnpm test:registry`, `pnpm test:modules`, and `pnpm registry:generate` after building public and
installed server packages. Registry generation validates the complete installed owner inventory,
emits `installed-module-graphql.ts` and the sorted `.graphql` composition artifact, and includes
exact `contributionId/readId` grants in the persistence contract fingerprint. The schema artifact
currently includes the core composition skeleton; the completed endpoint generation adds the full
core read projection in the execution/generation stages.

Runtime toggle changes do not change the installed schema. Every selected binding checks live
module/section enablement and its declared authority before feature execution, before request-local
reuse and after delayed work. Only the exact installed read grants reach the resolver. Aliases do
not bypass these checks. Host composition selects trusted installed descriptors; resolver
construction validates and binds that same descriptor without looking it up again in the registry.
`createGraphQLReadExecution` owns request-local admission, scheduling, reuse, cancellation and
capability construction. Callers execute a bound read through that operation; capability checks
inside a resolver's occupied slot use the immediate runner to avoid recursive slot acquisition.
Persistence construction still verifies every requested operation against installed read grants.

Section 3 verification is covered by `tests/platform/graphql-contributions.test.ts`, the isolated
registry type fixture, `api/tests/graphql-contributions.test.ts`, publisher packed-artifact tests,
the external-archive host suite, and the clean public-package consumer smoke check.

### Section 3 verification snapshot (2026-10-01)

- Registry/type contracts: 588 tests passed. Module suites and the isolated packed public-package
  consumer passed, including publisher SDL/read-map inspection and external host composition.
- API typecheck and coverage passed: 2,851 tests across 230 files. Redis passed 63 tests and
  PostgreSQL passed 431 tests. API and Nuxt production builds, formatting, registry drift checks,
  and affected dependency verifiers passed.
- Full repository lint passes after the assets and GraphQL execution lint fixes. Reviewed baseline
  updates remove resolved findings and refresh the existing auth test-suite wrapper entry; they add
  no new production-code allowances.
- Deployment of this worktree is **BLOCKED**: its 52-operation persistence inventory does not match
  the shared database's 53-operation Market staging inventory (`market/stage-market-pages`). The
  compatible 53-operation image was restored, its declared persistence privileges were reprovisioned
  through the existing migration owner, and startup attestation, health, authentication-denial,
  not-found, origin-protection and security-header probes passed. Database volumes were retained.
  Those probes verify the restored image; they do not establish deployment of the section 3 source.

Local verification logs use the `graphql-section3-*.log` prefix under the OpenCode temporary
directory. Reconcile the Market staging implementation and shared database inventory before
deploying this worktree again.

## Shared admission verification

Section 2 fixtures are in:

- `api/tests/read-admission.test.ts`: immutable exact subjects, scope/revocation, admission races
  and before-reuse/before-release authority checks.
- `api/tests/characters/assets-routes.test.ts`: mounted character route statuses, bodies, private
  headers, existing resource failures, non-main ownership without organization authority,
  administrator-only denial and delayed-result suppression.
- `api/tests/platform/read-admission.test.ts`: Hono/shared-interface parity over the same
  organization policy, current version, compliance, block, audience, permission and enablement;
  asynchronous invalidation and declaration immutability.
- `api/tests/platform/module-read-capabilities.test.ts`: exact installed grants, command exclusion,
  side-effect-free construction and guarded core-data/persistence execution.

Dependency checks are enforced by the auth, character, organization, platform and GraphQL
verifiers under `scripts/`. Source fixtures establish interface parity; deployment evidence is
recorded separately when the complete endpoint is mounted.

## Market read contribution

Section 4 installs the anonymous `Query.market` contribution. Its fields and traversal examples
are documented in the [Market contract](../features/market/docs/contract.md#graphql-read-projection).
Catalogue revision discovery loads metadata only, catalogue pages retain the canonical revision
and cursor, and book state reads no order rows. Explicit observation pages share the REST public
location/expiry mapping. History and reference projections share read-only domain readers with
REST. The GraphQL history projection checks the enabled profile revision before and after the
source read and rejects a concurrent profile change. Eligible full-region types with no demand
are returned as explicitly uncollected without recording demand.
Every field has its own declared grants, including bounded list projections with no backend grants.

The installed schema is composed without feature I/O. Market has no GraphQL capabilities for
private structures, administration, collection demand or queue admission. List bounds on page
wrappers charge selection work without multiplying the nested row bound twice. UTC serialization
accepts PostgreSQL source timestamp formats and preserves six fractional digits; input coercion
still requires the canonical UTC representation.

### Section 4 verification snapshot (2026-10-01)

- API coverage passed: 2,864 tests across 231 files. Final Market/scalar checks passed 28 tests;
  Market server checks passed 65 tests. Registry/type contracts passed 589 tests, with the final
  module-boundary fixture checks passing 160 tests.
- API typecheck, API and Nuxt production builds, full lint, formatting and generated registry
  drift checks passed. PostgreSQL passed 431 tests; Redis passed its thresholded integration suite.
  Logs are retained as `/private/tmp/eve-section4-*.log`.
- Deployment remains **BLOCKED** by the section 3 mismatch: this worktree declares 52 persistence
  operations, while the shared database retains 53 and the newer Market batching migration.
  Read-only checks confirmed matching core migration history and no missing or changed routines
  among the worktree's declared operations. The database also retains `market/stage-market-pages`.
  The attempted older startup removed that routine's execution grant; it was restored in a
  transaction that verified the compatible image's complete persistence contract before commit.
  API service was restored with that image and `/health` returned HTTP 200 with database connected.
  These runtime checks verify restoration, not deployment of section 4. Database data was retained.

## Core character selection and asset traversal

The core character fields are available for schema composition; the application endpoint mount
and operation-wide transport policy are completed in section 6 of the OpenSpec change.
`ownedCharacters(first: 50, after: null)` returns only the live member owner's attached identities:
`characterId`, `name`, and `isMain`. Database keyset paging orders by character ID and reads at
most `first + 1` identities. The maximum page size is 50. An owner-bound opaque selector cursor
cannot switch accounts. Session and page identity are checked again before release. Selection
performs no wallet, skills, profile, token, location, or ESI enrichment.

`ownedCharacter(characterId: "90000001")` selects an explicit subject. The main-character flag
never substitutes a different character. Each `assets` read checks current ownership, lifecycle,
authorization revision and `esi-assets.read_assets.v1` before reading and before release. A
subject returned earlier in the operation cannot silently adopt a newer authorization revision.
No organization membership or deployment administrator authority enters these core reads.

```graphql
query InventoryPage($characterId: EveId!, $first: Int! = 25, $after: String) {
  ownedCharacter(characterId: $characterId) {
    characterId
    name
    assets(first: $first, after: $after) {
      assets {
        itemId
        typeId
        quantity
        typeName
        customName
        locationId
        locationName
      }
      completeness
      sourcePage
      totalSourcePages
      anchor
      anchorSource {
        validatedAt
        cachedUntil
        stale
      }
      source {
        validatedAt
        cachedUntil
        stale
        retryAt
        refreshFailureClass
      }
      enrichment {
        types
        names
        locations
      }
      pageInfo {
        hasNextPage
        endCursor
        restartRequired
      }
    }
  }
}
```

Start with `after: null`, retain the returned `endCursor`, and submit it unchanged for the same
subject only while `hasNextPage` is true. Page sizes range from 1 to 100. Each invocation reads
source page one as its anchor and at most one additional selected page, each bounded to 1,000
source rows. It returns rows from one source page and may return fewer than `first` at its edge.
An empty source page may still provide a next cursor. No unselected source pages or singleton
names are loaded. The REST assets route continues to collect all advertised source pages,
validate counts, deduplicate item IDs and return the full enriched inventory.

Asset cursors are versioned selectors capped at 2,048 encoded characters. They bind the owner,
character, lifecycle, authorization revision, anchor fingerprint, page count, page/offset and
expiry. Continuing within a source page also binds that page's fingerprint. Fingerprints include
canonical page content, validation time and expiry; a renewed source may require a restart even
when its rows match. Cursors grant no authority. A changed anchor, page count, selected page,
subject binding, invalid position or expired cursor returns `ASSET_CURSOR_RESTART`. Discard the
traversal and restart with `after: null`; never silently retry an old cursor with a new subject
revision. Invalid upstream page counts return `ESI_RESPONSE_INVALID`.

`completeness: "source-page"` describes the bounded base page. The anchor and each selected page
retain independent source clocks. Even reaching the final source page does not establish an
atomic, simultaneous complete inventory: rows can move between pages. Clients should deduplicate
displayed item IDs and describe the result as paged source data. A permitted outage-stale first
page can retain base rows, but it cannot issue expired continuation authority. When more source
rows exist but continuation is unsafe, `restartRequired` is true, `hasNextPage` is false and
`endCursor` is null.

Type, singleton-name and public static-location enrichment each report `complete`, `partial`, or
`unavailable`. Missing optional enrichment retains base identities and quantities, deterministic
`Unknown type <id>` labels and nullable names. Location enrichment does not call protected
structure endpoints. IDs and quantities use exact string scalars; unsupported numeric backend
identities fail validation rather than rounding.

Source pages, singleton-name batches, type reads, static-location reads and universe-name
resolution (including bounded 404 splits) consume the same request work admission. Cancellation
stops new work; gateway attempt deadlines remain independent. Same-process collapsed reads keep
their upstream request alive while any admitted waiter remains, with separate caller cancellation
and release checks. The last waiter cancels the shared source. Static-location snapshot callers
can detach without canceling the shared cache refresh needed by another caller.

### Section 5 verification (2026-10-02)

- API coverage: 2,908 tests passed; statements 82.40%, branches 76.21%, functions 85.32%,
  lines 82.50%.
- PostgreSQL: 443 tests passed, including real bounded selector paging and owner isolation.
- Registry/conformance fixtures: 589 tests passed. Lint, formatting, API typecheck, API build,
  root Nuxt build and diff checks passed.
- Redis: all 65 tests passed after integrating main, including registered asset-page shared-waiter
  cancellation. The earlier quota-timing failures did not recur in this run.
- Integrated `main` at `0a8b3fc4`, including Market batch staging, and regenerated the combined
  persistence inventory. The rebuilt API passed startup attestation and is healthy. HTTP probes
  returned 200 for `/health`, 401 for an unauthenticated asset request and 400 for an invalid
  character ID. Section 6 still owns the GraphQL endpoint mount.

Detailed logs are in `/tmp/graphql-section5-{coverage,postgres,registry,lint,format,typecheck,api-build,build}.log`,
`/tmp/graphql-section5-redis-recheck.log` and `/tmp/graphql-section5-runtime-build.log` on the verification host.

## Guarded HTTP execution (section 6)

`/graphql` is mounted in the chained Hono app. It accepts one GET query or POST
`application/json` envelope. Yoga uses the original request, with its CORS, landing page,
HTTP batching, uploads, parser cache and response cache disabled. Responses are non-streaming
JSON even if the caller advertises streaming media. Mutations, subscriptions, `@defer` and
`@stream` are rejected before reads. OPTIONS follows host CORS; HEAD and unsupported methods
return 405 with no execution. Host CSRF, security headers and request logging remain authoritative.

The member session is resolved lazily through the same cookie/session helper as `loadSession`,
then checked again during private admission. Public reads do not load the session. Administrator
cookies grant no GraphQL authority. Core and installed reads share one request work controller;
module resolvers do not occupy a work slot while awaiting their bounded capabilities. Every
actual capability invocation consumes a slot and count, including repeated calls inside one
resolver. Core admission, source pages and enrichment use the same work controller.

### Finite limits and field weights

| Resource                                    | Limit                                                               |
| ------------------------------------------- | ------------------------------------------------------------------- |
| HTTP envelope / GET URL                     | 65,536 UTF-8 bytes                                                  |
| Document / parser tokens                    | 16,384 UTF-8 bytes / 2,000                                          |
| Expanded selections / aliases / field depth | 500 / 30 / 10 (16 within introspection types for standard GraphiQL) |
| Application read selections                 | 12; pure container/list projections do not count as backend reads   |
| Combined declared domain rows               | 1,000                                                               |
| Estimated application cost                  | 5,000 units                                                         |
| Introspection expansion cost                | 1,000,000 units, using installed schema cardinalities               |
| Actual backend invocations / concurrency    | 32 / 4                                                              |
| Request memo entries / encoded bytes        | 32 / 2,097,152                                                      |
| Serialized JSON response                    | 2,097,152 UTF-8 bytes                                               |
| Operation deadline                          | 15 seconds, including body parsing and serialization                |
| Returned errors                             | 20, with fixed safe messages and allowlisted guidance               |

Cost is the parent list multiplier times `(field weight × requested list size + source weight)`.
DTO leaves cost one per projected row. Nested list projections retain their declared worst-case
bounds even when the parent requests fewer rows. This intentionally overcounts some pages.
Repeated aliases/fragments still consume selection cost when admitted backend work is memoized.
Variables are coerced and directives evaluated on every request; no cached decision can admit
new variable-dependent cost. Skipped protected selections conservatively make a response private.

| Read                      | Field weight | Source weight                    | List maximum                                                                                                  |
| ------------------------- | ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Core character selector   | 1            | 2                                | 50                                                                                                            |
| Exact core character      | 1            | 3                                | —                                                                                                             |
| Owned assets              | 1            | 2,000 (two bounded source pages) | 100                                                                                                           |
| Market container          | 1            | 0                                | —                                                                                                             |
| Catalogue revision / type | 1            | 1                                | —                                                                                                             |
| Catalogue group page      | 1            | 100                              | 100                                                                                                           |
| Public profiles           | 1            | 1                                | 4                                                                                                             |
| Book state                | 1            | 3                                | —                                                                                                             |
| Observation order page    | 1            | 4                                | 100                                                                                                           |
| Daily history             | 1            | 365                              | 365 projected days                                                                                            |
| Reference prices          | 1            | 1                                | 100 input types and projected rows                                                                            |
| Declared DTO lists        | 1            | 0                                | assets/orders/catalogue/references: 100; selector: 50; history: 365; profile stations: 100; watched types: 16 |

The following examples fit the limits. Add real published identities when using the latter two:

```graphql
query PublicProfiles {
  market {
    profiles {
      profileId
      revision
      regionId
      mode
      marketScope
    }
  }
}
query OwnedPage($characterId: EveId!, $after: String) {
  ownedCharacter(characterId: $characterId) {
    characterId
    assets(first: 25, after: $after) {
      assets {
        itemId
        typeId
        quantity
        typeName
      }
      source {
        validatedAt
        cachedUntil
        stale
      }
      pageInfo {
        hasNextPage
        endCursor
        restartRequired
      }
    }
  }
}
query DailyHistory($profileId: UUID!, $typeId: EveId!) {
  market {
    history(profileId: $profileId, typeId: $typeId) {
      status
      freshness
      validatedAt
      freshUntil
      days {
        date
        averageIsk
        highIsk
        lowIsk
        volume
        orderCount
      }
    }
  }
}
```

Schema discovery follows the same document/depth/output/deadline limits. For GraphQL.js discovery,
use `getIntrospectionQuery({ typeDepth: 4 })`; its default deeper type-reference traversal exceeds
this endpoint's depth limit. Introspection never reads application data and always uses `no-store`.
Mixing it with application fields does not exempt those fields from their ordinary budget.

### Errors, cache policy and cancellation

Host method/media/envelope rejection uses HTTP 405/415/413; CSRF retains HTTP 403. Syntax,
schema, variables and cost rejection returns HTTP 400 with bounded GraphQL errors and no data.
Executed queries return HTTP 200 with nullable independent fields and path-addressed errors.
Known errors preserve safe application codes/status, bounded retry timing and exact-owned
reauthorization guidance. Unexpected errors are masked and recorded with host request correlation;
query text, variables, private source payloads and arbitrary exception messages are not logged.

`EveId`, `Decimal`, `BigInteger`, `UUID`, `UTCDate` and `UTCTime` serialize as strings (or nullable
GraphQL nulls). EVE ID inputs require canonical positive strings. Number-backed readers reject
unsafe IDs; decimal coercion rejects non-integer numeric backend values rather than attempting
to recover lost precision. Exact strings retain domain fractional digits, and UTC serialization
preserves submillisecond source precision.

Every POST, protected/mixed query, introspection, error and missing cache verdict uses `no-store`.
A public-only GET can cache only after every selected backend read supplies a valid freshness
verdict. The lifetime is floored to the shortest remaining source expiry and declared maximum
age. Stale, uncollected, incomplete or unavailable results downgrade the entire response. Pure
container and DTO projections inherit backend verdicts. There is no GraphQL response store.

The caller signal and operation deadline reach registered ESI reads, restricted persistence and
Market catalogue/location SQL. Existing source-attempt and SQL deadlines still apply. Exhausting
work or retained-result limits aborts the operation and prevents further backend admission.
Memoization rechecks immutable authority and never lets a cursor or cached result grant access.
A disconnected waiter detaches from collapsed source work; another admitted waiter keeps that
source alive. Real Redis tests cover cancellation while consuming an asset response body and
exactly one permit release.

### Section 6 verification (2026-10-02)

- All 2,933 API tests passed across 236 files. Coverage: statements 82.65%, branches 76.60%,
  functions 85.44%, lines 82.69%; configured thresholds passed.
- All 443 PostgreSQL, 66 Redis, 589 registry and 6 core-data contract tests passed.
- Lint (including architecture, generation and quality checks), formatting, complete API
  typecheck, API build, root Nuxt build, diff checks and strict OpenSpec validation passed.
- The rebuilt API and matching worker are healthy. The worker's older inventory had reported
  `schema-not-ready`; rebuilding it restored its healthcheck without changing database data.
- Runtime probes confirmed anonymous profiles/catalogue GET caching, introspection `no-store`,
  missing-session and mixed-field HTTP 200 errors, invalid/over-budget HTTP 400, and security
  headers. Authenticated ownership/scope changes, runtime disablement, authorization races and
  cancellation use controlled mounted tests; no live private inventory probe is claimed.

API image: `sha256:0c31a12f34686210ebd521f93989c33ab3a9492b6e6bbe2abcf40ffde642eafa`.
Worker image: `sha256:5be36106890fc032aa27251ae0c92f2f2d0df24d6a4020942d31736e1e856297`.
Logs use `/tmp/graphql-section6-{coverage,postgres,redis,registry,core-contract,lint,format,typecheck,api-build,build,runtime-build,worker-build,runtime-probes}.log`.

## Generated frontend contract and API explorer

The standard GraphiQL viewer is available directly at the API's `/graphql` endpoint.
The viewer discovers the endpoint's schema through introspection. It has no
module inventory, Market-specific UI, character selector, custom result adapter or installation
logic. Schema composition controls which fields exist; the API's per-field admission controls
which data a request may read. Visible schema fields confer no authority.

GraphiQL uses Yoga's pinned self-hosted renderer: scripts, styles, fonts and workers are bundled
locally rather than fetched from a CDN. Requests are credentialed JSON POSTs with no automatic
retry. Introspection and application operations retain all server validation, read budgets,
timeouts, scope/ownership checks and partial-error behavior. Documents, variables, headers,
results and query history are memory-only: GraphiQL storage is disabled and its default query-to-URL
callback is replaced. Leaving or reloading the viewer resets that memory. This page is a generic
API tool, not an application resource view or a substitute for private admission/presentation gates.

`pnpm graphql:generate` regenerates installed registries, the full application SDL at
`api/src/generated/graphql/application.graphql`, and root application contract artifacts in
`app/generated/`. `pnpm graphql:check` checks drift and the curated operation types; lint and
build dependencies run it. Generation needs built installed package prerequisites, but no API,
PostgreSQL, Redis, EVE credentials or running services. Output is sorted and fingerprinted with
SHA-256. An API test compares the generated SDL with the actual composed application schema.

Curated documents in `app/graphql/operations.graphql` are examples and typed application-client
contracts. They are separate from GraphiQL, which accepts arbitrary server-validated documents.
`EveId`, `Decimal`, `BigInteger`, `UUID`, `UTCTime` and `UTCDate` map strictly to strings; an
unmapped scalar fails generation. Hono `AppType` remains the existing REST contract.

```ts
import { marketGraphQLQuery, ownedAssetsGraphQLQuery } from '~/queries/graphql'

const publicOptions = marketGraphQLQuery(publicContext)
const ownedOptions = ownedAssetsGraphQLQuery(ownedContext, {
  characterId: '7001',
  first: 25,
  after: null,
})

if (import.meta.client && publicContext.canRun())
  await publicContext.queryCache.fetch(publicOptions)
if (import.meta.client && ownedContext.canRun()) await ownedContext.queryCache.fetch(ownedOptions)
```

The contexts above come from the application caller. `ownedContext.canRun()` must check the live
verified member session, exact ownership and the captured owner/admission revision. Use that
same current-context gate when presenting `data`, including partial results; cached success alone
cannot open a view. The query options recheck the gate after asynchronous execution and forward
field authorization denials to the shared private lifecycle. `ExplorerMarketDocument` and
`ExplorerOwnedAssetsDocument` are the generated documents used by these options. Direct
`executeTypedGraphQL` calls for protected selections require the same
browser/execution/presentation gates; credentialed fetch alone does not forward cookies during SSR.

The schema-independent transport is exported from `@eve-space/platform-module-nuxt/runtime`:
`executeTypedGraphQL`, `GraphQLDocument`, the JSON variable/envelope types,
`normalizeGraphQLVariables`, and `readGraphQLFieldError`. Feature-owned generated documents can
use these contracts without importing root application operations, API/schema code, or another
feature. Root `app/graphql/` helpers re-export the same implementation for existing callers.
The platform Nuxt module registers `usePlatformGraphQL()` through its normal auto-import strategy.
It captures `runtimeConfig.public.apiBase` and returns a typed executor; constructing it performs
no request or startup work.

Both executors send JSON POST requests to the configured `/graphql` endpoint with
`credentials: 'include'`, `cache: 'no-store'`, and a 16-second deadline composed with the caller's
abort signal. They preserve HTTP 200 partial envelopes and HTTP 400 GraphQL rejection envelopes;
other HTTP failures use the safe API error contract. Aborted or expired requests cannot release
a late successful response. They add no retries, query cache, persistence, authentication, or
admission decisions.

Genuinely public selections may execute during SSR through the host's payload-aware query
infrastructure and hydrate from that result. The caller still owns selection identities,
freshness, retries, cache residency, and persistence classification. Protected selections use
client-only execution gated by a live verified session, exact subject ownership/admission, and
current authorization revision, with release and presentation checked again after asynchronous
work. The configured executor does not forward an incoming SSR cookie, so it is not an
authenticated SSR path. A mixed document must follow the requirements of its protected fields.

Application callers use the established query, browser-only session and exact ownership gates.
`app/queries/graphql.ts` supplies typed options with owner/subject/admission/schema/operation and
normalized-variable identities, zero retries and `esiPersistence: { kind: 'none' }`. The request
adapter preserves HTTP 400 document errors and HTTP 200 partial data/field errors; host failures
use the existing safe API error contract. These client helpers do not grant server authority.
Supply the application `queryCache` in the query context. Owned asset keys extend
`PRIVATE_QUERY_KEYS.character(characterId)` and retain owner and admission revision isolation;
the owned-character selector uses the collection scope. Character removal or authorization
changes clear these entries through the shared lifecycle. HTTP 200 field errors forward
authentication and character authorization denials to that lifecycle without replacing the
partial GraphQL envelope. Authentication denials clear all private partitions; character
denials affect the admitted character scope.

For assets, pass an explicit owned character and bounded `first` (25 in the example). Follow the
opaque `pageInfo.endCursor` with `after`. `ASSET_CURSOR_RESTART` requires starting over with
`after: null`; independent pages do not establish an atomic complete inventory. Inspect source
page/count/completeness, anchor/current source clocks and separate enrichment statuses. Scope
errors include exact-character reauthorization guidance. Public reference prices remain exact
strings and non-executable estimates.

To extend the typed application contract, declare and validate the contribution using the module
procedure above, regenerate the schema, add application selection documents and regenerate
operations. Run isolated platform/feature typechecks and `graphql:check`. GraphiQL discovers the
resulting endpoint schema automatically and needs no module-specific changes.

### Feature-owned operation artifacts

The selected-item Market pilot owns `features/market/nuxt/src/runtime/app/market-operations.graphql`.
Its generated sibling `market-graphql.ts` contains only selected result/variable/fragment types,
referenced enums, typed document strings, and SHA-256 schema/document identity. Its sole import is
the generic `GraphQLDocument` type from the public platform runtime. It includes no application SDL,
root-generated schema contract, API implementation, server runtime, or runtime GraphQL library.
The common generator scalar mapping keeps EVE IDs, decimal values, big integers, UUIDs and UTC
values as strings; an unmapped scalar or invalid selection fails generation.

| Operation                 | Contract                                                                 |
| ------------------------- | ------------------------------------------------------------------------ |
| `MarketItem`              | Catalogue revision and selected type identity/name                       |
| `MarketProfiles`          | Enabled public profiles, revisions, modes, stations and watched types    |
| `MarketBook`              | State, replacement and complete observation discovery without order rows |
| `MarketInitialOrders`     | Independent seller/buyer aliases, at most 100 rows each                  |
| `MarketOrderContinuation` | One side, explicit observation and opaque cursor, at most 100 rows       |
| `MarketHistory`           | History source clocks and at most 365 retained days                      |

Build the installed contract/server prerequisites before changing documents or schema with
`pnpm build:nuxt:dependencies`. After editing a feature document, run `pnpm graphql:generate`
and `pnpm graphql:check`. The host-side generator uses the composed application SDL, checks
named query selections, and writes the Market sibling together with the root example artifacts.
Generation/checking needs built installed packages, but no running API, database, Redis, EVE
credentials, or schema discovery request. Artifact drift fails the existing lint/build gates.
To extend the pilot, add a named query to the same document, regenerate, and exercise it through
the actual application selection policy before adding a consumer.

`pnpm --filter @eve-space/market-nuxt typecheck:graphql` compiles only the generated consumer
contract and its feature-owned strict type fixture. The normal Market build/typecheck and root
`graphql:types` include that check. Invalid IDs, order-side values, missing cursors, lossy numeric
result assumptions, and unselected fields are compile errors. This contract check does not
replace runtime/SFC compilation. Host `typecheck:nuxt` includes `typecheck:market:runtime`,
which delegates to the feature's `typecheck:runtime` script and `tsconfig.runtime.json`.
That check compiles every Market runtime TypeScript file and SFC with prepared host Nuxt types,
the host API augmentation and its presentation-contract rejection fixture. Independent package
wire checks remain host-free.
The generator emits a safety justification beside each typed document assertion, derived from
validation and generation against the same schema and operation.

`pnpm test:graphql:packages` checks drift, builds dependencies, packs the actual Market and public
platform packages, and installs copied tarballs into a temporary consumer outside the checkout.
It compiles the same type fixture against the installed Market artifact and executes its generated
document through the installed transport. There are no workspace links or host-source aliases.
The authoritative `test:modules` runner includes this package check. The Market archive retains
its document and generated sibling under `src/runtime/app/`, following its existing Nuxt runtime
packaging strategy; no new feature export facade is required.

### Section 7 verification (2026-10-02)

Offline generation, strict operation type fixtures and composed-schema equality pass. The API,
Redis/PostgreSQL, registry/module, frontend and production-browser suites pass, as do required
lint, formatting, typechecks and production builds. The rebuilt API serves self-hosted GraphiQL
and preserves no-store public/denied/mixed/error behavior. See the
[scoped fetching review](graphql-explorer-fetching-compliance.md) for commands, evidence and the
standalone viewer's memory/reset semantics. The comprehensive integration review remains section 8.

## Coordinated deployment and rollback

Build and check the installed registry, composed SDL/fingerprint and generated operation artifacts
before building API and Nuxt. Release the API, installed module packages/registry, frontend and
dependency lockfile as one compatible artifact set. Check schema drift, startup persistence
attestation, `/health`, representative existing Hono routes and `/graphql`; a successful
source test is not a successful deployment probe. The worker consumes the same installed server
inventory, so verify its health when that inventory changes.

To roll back, redeploy the prior compatible API, Nuxt, installed module/registry and lockfile
artifacts together, including the matching worker artifact where its inventory changed. An
alternative source rollback removes the GraphQL endpoint/explorer/client integration and restores
the prior dependency/artifact set before rebuilding. Preserve current database migrations, module
data, event history, Redis coordination and volumes; this transport adds no database migration or
retained response store. Independently delivered Market migrations are not GraphQL rollback work.
Verify the prior inventory against retained persistence routines rather than downgrading or
rewriting an applied migration. Then check health, authentication denial, anonymous Market and
owned Hono routes before reopening access. Generated frontend operations and schema fingerprints
must match their deployed API; private query keys include the fingerprint and GraphQL results
are excluded from browser persistence.

The section 8 [fetching and runtime review](graphql-fetching-compliance.md) records executed
checks, deployed identity, acceptance evidence and any remaining blockers. The rollback procedure
is reviewed against the artifact and persistence boundaries; it does not claim an exercised
deployment rollback unless that review records one.

Feature queries that explicitly opt out of browser persistence use
`defineNonPersistentQueryOptions()` from `@eve-space/platform-module-nuxt/runtime`. It accepts only
`esiPersistence: { kind: 'none' }`, retains the caller's finite Colada residency, and enforces the
classification even if runtime metadata attempts to override it. The general classification factory
remains reserved for host queries; protected feature queries retain their existing platform admission
seam. This options helper grants neither route admission nor permission to execute protected reads.

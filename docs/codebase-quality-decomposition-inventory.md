# Codebase Quality Decomposition Inventory

This inventory records the implementation before the `harden-codebase-quality` task 7
decomposition. It is a historical caller and transaction map, not a compatibility contract. The
target files listed below replace the original authentication store directly; no facade or barrel is
retained.

## Authentication Persistence Before Decomposition

`api/src/auth/store.ts` combines four persistence responsibilities with character lifecycle,
domain-event, and organization-compliance orchestration.

### Current callers and exported contracts

| Caller                                                                                                       | Contract used before decomposition                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/src/auth/routes.ts`                                                                                     | `OAuthStateContext`, `storeOAuthState`, `consumeOAuthState`, `saveLogin`, `attachCharacter`, `reauthorizeCharacter`, `CharacterOwnershipConflictError`, `findSession`, `deleteSession`                                                             |
| `api/src/auth/tokens.ts`                                                                                     | `StoredCharacterToken`, token lookup and cache-authorization lookup with optional transaction participation, compare-and-set update/delete, refresh and lifecycle lock wrappers, `CharacterTokenNotFoundError`, `TokenRefreshLockUnavailableError` |
| `api/src/middleware/auth-session.ts`                                                                         | `SessionAccount`, `findSession`                                                                                                                                                                                                                    |
| `api/src/middleware/owned-character.ts`                                                                      | `SessionAccount`, `OwnedCharacterSummary`, `findOwnedCharacter`                                                                                                                                                                                    |
| `api/src/characters/core-routes.ts`                                                                          | `listUserCharacters`, `setMainCharacter`, `deleteCharacter`                                                                                                                                                                                        |
| `api/src/characters/routes.ts`                                                                               | `deleteCharacter`                                                                                                                                                                                                                                  |
| `api/src/commands/local-organization-fixture.ts`                                                             | `saveLogin`, `findSession`                                                                                                                                                                                                                         |
| `api/src/index.ts`, `api/src/organization/owner-evidence.ts`, `api/src/platform/resource-execution-guard.ts` | `CharacterTokenNotFoundError`                                                                                                                                                                                                                      |
| PostgreSQL integration tests                                                                                 | OAuth single-use behavior, lifecycle/domain-event rollback, lifecycle-scoped token reads, token generation, advisory locking, compliance recomputation, and deletion outcomes through the same exports                                             |
| API route and module tests                                                                                   | Mock the store seam to establish session, ownership, character lifecycle, and token behavior                                                                                                                                                       |

The original exported type interface is `CharacterSummary`, `OwnedCharacterSummary`,
`SessionAccount`, `OAuthStateContext`, `StoredCharacterToken`, and
`StoredCharacterCacheAuthorization`. The original exported error interface is
`TokenRefreshLockUnavailableError`, `CharacterTokenNotFoundError`, and
`CharacterOwnershipConflictError`. The original function interface is every function named in the
table above plus `findCharacterToken`, `findCharacterCacheAuthorization`,
`findCharacterTokenForLifecycle`, `findCharacterCacheAuthorizationForLifecycle`,
`updateCharacterToken`, `deleteCharacterTokenAuthorization`,
`withCharacterTokenRefreshLock`, and `withCharacterTokenLifecycleLock`.

### Current transaction and lock boundaries

- `storeOAuthState` performs expired-state cleanup and insertion as two autocommit statements. It
  hashes the bearer before insertion and persists the intent-specific user, character, return-path,
  and organization binding. `consumeOAuthState` is one atomic `DELETE ... RETURNING` statement over
  the hash and expiry predicate, so only one concurrent caller can consume a state.
- `saveLogin` owns one database transaction. Its lock order is character advisory lock, current
  organization-version key-share lock, then existing user row lock when applicable. Character/user
  creation or identity update, lifecycle creation, encrypted token upsert and generation increment,
  scope or attachment event, hashed session insertion, and compliance recomputation commit or roll
  back together.
- `attachCharacter` owns one database transaction with character advisory lock, current
  organization-version key-share lock, then target user row lock. Ownership validation, character
  and lifecycle creation or identity update, encrypted token upsert, domain event, and compliance
  recomputation participate in that transaction.
- `reauthorizeCharacter` rejects a mismatched character before opening one database transaction.
  Inside it, the lock order and atomic identity, encrypted token, scope-event, and compliance work
  match attachment. It returns the affiliation observation that actually won the timestamp update.
- `setMainCharacter` owns one database transaction and locks the user row before reading or
  changing main-character state. Both character updates and the conditional main-change domain
  event are atomic.
- `deleteCharacter` owns one database transaction. Its lock order is character advisory lock,
  current organization-version key-share lock, then user row lock. Lifecycle-bound ownership,
  main-character, retained authority evidence, and active corporation-source checks precede the
  delete. Character/token cascade, detached event, and compliance recomputation are atomic.
- Session lookup and deletion use autocommit statements. Session creation is transaction-aware and
  currently occurs inside `saveLogin`; only the SHA-256 session hash is persisted.
- Character-token reads default to the shared database but accept the active transaction. Token
  update and deletion require the expected token version and can participate in the refresh
  transaction. The refresh lock wrappers own a transaction, set the local lock timeout, acquire the
  character advisory lock, re-read the token (optionally for an exact subject lifecycle), and map
  PostgreSQL lock timeout `55P03` to `TokenRefreshLockUnavailableError`.

### Current and target dependency direction

Before decomposition, transport, middleware, character routes, token refresh orchestration, and
commands all depend on `auth/store.ts`. That store in turn imports domain-event persistence and the
organization compliance application module, so a nominal persistence module depends upward on
application workflows.

The target direction is:

```text
auth routes / character routes / middleware / commands
  -> character lifecycle or token-refresh orchestration
    -> oauth-state store / session store / character-token store
    -> domain-event recorder / organization compliance application
      -> database and schema
```

The direct replacement owners are:

| Target module                           | Owned interface                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `api/src/auth/oauth-state-store.ts`     | `OAuthStateContext`, hashed state storage, and atomic single-use consumption                                                               |
| `api/src/auth/session-store.ts`         | `CharacterSummary`, `SessionAccount`, hashed session lookup/deletion, and transaction-participating session insertion                      |
| `api/src/auth/character-token-store.ts` | Encrypted token records, lifecycle-scoped authorization reads, token CAS/version writes and deletes, and bounded refresh-lock transactions |
| `api/src/auth/character-lock.ts`        | The shared transaction-scoped character advisory lock operation                                                                            |
| `api/src/auth/character-lifecycle.ts`   | Login, attachment, reauthorization, roster/ownership reads, main selection, deletion, domain events, and compliance coordination           |

OAuth-state, session, and character-token stores are lower-tier persistence modules. They do not
import character lifecycle, token refresh, domain events, organization workflows, HTTP transport,
or process entry points. Character lifecycle owns transaction composition and depends downward on
the focused stores. Callers import the owning module directly; the original aggregate store is
removed.

## Organization Routes Before Decomposition

`api/src/organization/routes.ts` exports the single chained `organizationRoutes` contract. Its
production caller is `api/src/index.ts`, which mounts it at `/api/organization`; the focused route
suite imports the same router directly. No other production module imports the transport module.

The router applies private no-store response handling, session loading, session enforcement, and
organization-session loading to every route in that order. Route-local middleware then applies
trusted-origin and organization activity, owner, registration-policy owner, manager, or HR gates
before calling the relevant organization application or read module. Zod validators define the
path, query, and JSON input contracts. Inline error mappers define the existing JSON bodies and
statuses. The chained router and its mount contribute directly to the exported `AppType` contract.

The transport module does not own a database transaction. Each imported organization mutation or
read owns its transaction policy; the route must not wrap those calls in a second transaction.
Current dependencies point from the transport module into policy, adapter, service, and application
modules as declared by `scripts/organization/boundaries.ts`. Lower organization tiers do not import
the routes. Tasks 7.1-7.4 do not change this router; its later cohesive route split must preserve the
mount, middleware order, authorization precedence, private response policy, validators, error
bodies, and inferred Hono contract.

## Mail Composition Before Decomposition

`api/src/mail/routes.ts` exports the chained `mailRoutes` contract. Its production caller is
`api/src/index.ts`, which mounts it at `/api/me/characters`; the focused route suite imports it
directly. The route module is the only production caller of the composition operations exported by
`api/src/mail/mailbox.ts`:

- Reads: `listMailHeaders`, `getMailDetail`, `getMailLabels`, and `getMailingLists`.
- Recipient composition: `resolveMailRecipients`, `searchMailRecipients`, and
  `calculateMailCspaCharge`.
- Mutations: `sendMail`, `createMailLabel`, `updateMail`, `deleteMail`, and `deleteMailLabel`.
- Shared route interface: `mailLabelColors` and the mailbox error classes translated by
  `mailError`.

The mailbox additionally exports intentional DTO and input types for mail pages, details, labels,
lists, recipient results, CSPA results, and mutation results. Focused mailbox tests import these
contracts directly.

Mail composition owns no PostgreSQL transaction. Routes enforce private response policy, validated
character IDs and inputs, application session, and explicit character ownership before mailbox
execution. `mailbox.ts` depends on resilient ESI representations and execution, token authorization,
universe-name resolution, and text normalization. ESI execution owns cache, mutation, token-refresh,
and upstream request semantics. Tasks 7.1-7.4 do not change mail composition; its later split must
keep route paths, generation guards, CSPA approval flow, authorization feedback, and user-visible
outcomes unchanged.

# Market server module

Pure market representations (bounds, order mapping and expiry, depth, derivation, and profiles)
depend only on other representations and the declared platform contract. Collection
depends on representations but owns no connection. Persistence and ESI operation
definitions are declarative leaves. Resource implementations coordinate injected gateway
operation methods and named persistence methods; routes consume declared capabilities
and may call the pure quote collector. The package root exports contributions but owns
no execution.

`intelligence-representation.ts` owns metric input/result schemas, null reasons, and
schema-derived TypeScript types. Formula code, report envelopes, and generation persistence
consume that owner directly. `intelligence-policy.ts` returns profile-scoped targets and
exclusion metadata for both reconciliation and watched derivation.

The daily-history resource composes bounded catalogue reconciliation and report derivation
helpers. These helpers use only declared local catalogue products and named Market
persistence; they own no connection or ESI execution. Watched report work checks the
catalogue revision independently of upstream source changes. Report cursors use Web Crypto
with a server-only random key retained with their immutable generation.

Shared public reads depend on representations and injected named read capabilities.
Hono and GraphQL adapters depend on these reads. GraphQL declarations import only the
role contract and shared reads; they receive no collection or scheduling capabilities.

The host owns gateway authorization, caching, rate coordination, queue admission, and
current-character lifecycle checks. Market owns profile bounds, complete-observation
validation, price-time quotation, safe DTOs, and module SQL routines. Public profile
and regional observation reads cannot import or address private structure rows.

`scripts/verify-market-server-boundaries.ts` enforces exact source membership, import
direction, and cycles. The existing first-party module verifier enforces the runtime
SDK/gateway/database import bans across feature source and release artifacts.

## Initial release schema

`migrations/market-001-initial.sql` is the fresh-install baseline. Installed databases
advance through subsequent ordered migrations. Never rewrite an applied migration;
preserve its declared routine identities and add new routines for changed publication
contracts. Draft migrations preceding the baseline are not release contracts.

Local databases that already applied the draft migration chain require separate,
data-preserving re-baselining of Market migration and attestation state. Do not run the
fresh-install baseline over existing draft tables or reset core or other module data.

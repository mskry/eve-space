# Market server module

Pure market representations (bounds, order mapping and expiry, depth, derivation, and profiles)
depend only on other representations and the declared platform contract. Collection
depends on representations but owns no connection. Persistence and ESI operation
definitions are declarative leaves. Resource implementations coordinate injected gateway
operation methods and named persistence methods; routes consume declared capabilities
and may call the pure quote collector. The package root exports contributions but owns
no execution.

The host owns gateway authorization, caching, rate coordination, queue admission, and
current-character lifecycle checks. Market owns profile bounds, complete-observation
validation, price-time quotation, safe DTOs, and module SQL routines. Public profile
and regional observation reads cannot import or address private structure rows.

`scripts/verify-market-server-boundaries.ts` enforces exact source membership, import
direction, and cycles. The existing first-party module verifier enforces the runtime
SDK/gateway/database import bans across feature source and release artifacts.

## Initial release schema

Market is unreleased. `migrations/market-001-initial.sql` is its fresh-install baseline,
including final table definitions and active persistence routines. Draft migrations and
superseded routines are not release contracts. After release, add new ordered migrations
and preserve applied routine identities.

Local databases that already applied the draft migration chain require separate,
data-preserving re-baselining of Market migration and attestation state. Do not run the
fresh-install baseline over existing draft tables or reset core or other module data.

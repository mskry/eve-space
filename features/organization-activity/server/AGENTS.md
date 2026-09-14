# Organization activity server

Representations and pure projections depend only on other representations. Storage and status
adapters depend on representations. Collection and provider orchestration depend on these
adapters; adapters must not import their callers. Entry points compose those services.

Keep persistence control flow in the declared module SQL routines and call only generated named
methods from storage adapters. The platform retains schema, authorization, timeout, and transaction
ownership. Provider reads must use bounded concurrency, cover every supplied managed character, and
stop scheduling after cancellation.

`scripts/verify-organization-activity-boundaries.ts` owns the exact tier membership and enforces
this direction, including type-only dependencies.

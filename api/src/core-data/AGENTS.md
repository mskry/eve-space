# Core Data Subsystem

## Dependency Direction

- Capability construction depends on executable catalog declarations and product adapters.
- Catalog declarations bind pure contract metadata to exactly one product adapter.
- Product adapters depend only on the pure contract and the narrow canonical source/read boundary they adapt.
- The subsystem never imports platform orchestration, installed features, ESI SDK or gateway execution, HTTP, workers, queues, or caches.
- Resource-projection products are bounded local reads and must never perform network execution.

Keep exact file membership and import allowlists in the core-data dependency verifier rather than duplicating them here.

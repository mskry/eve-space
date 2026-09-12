# Character Module Direction

The character subsystem is a flat set of deep modules. Keep each module's interface focused and preserve this dependency direction:

```text
root Hono / auth / organization / queue orchestration
                         |
                         v
character route adapters and affiliation use cases
                         |
                         v
character reads and local projections
                         |
            +------------+-------------+
            v                          v
registered ESI execution seam    pure/shared leaf modules
```

## Route Adapters

- Route adapters own Hono route composition, validation and middleware order, response privacy, DTO shaping, and failure translation.
- Hono belongs only in this tier. Reads, projections, affiliation use cases, and pure leaves must not import route adapters or Hono.
- Keep each method and path owned by one route adapter. Do not introduce a character facade or barrel.

## Affiliation Use Cases

- Affiliation use cases own character-domain observation, deterministic due selection, batching, persistence, and domain-event sequencing.
- Queue orchestration calls these interfaces but retains job contracts, stable job identity, producer admission, BullMQ adaptation, and worker delivery disposition.
- Character modules must not import BullMQ or queue modules.

## Reads And Projections

- Read modules own registered ESI representations, cache-facing input identity, character DTO composition, and resource-specific invariants.
- Projection modules may enrich reads through their reviewed database, alliance, corporation, universe, text, or training seams.
- Reads and projections may depend on other reads, projections, and pure leaves. They must not depend on route adapters or affiliation orchestration.

## Registered ESI Seam

- Cross ESI through the registered feature execution interface and its public failure interface. Use generated operation descriptors and response types only to define registered representations.
- Never import ESI gateway internals, construct an SDK domain client or transport, or call ESI through raw `fetch` from this subsystem.
- New alliance, corporation, or universe reads require an explicit review and verifier update.

## Pure Leaves

- Pure leaves express shared character policy or mapping behavior without Hono, persistence, queue delivery, ESI execution, or imports from higher character tiers.
- Promote shared behavior to a leaf when a second production caller needs it; keep one-caller helpers private.

Exact module membership and reviewed cross-subsystem imports are maintained by the character dependency verifier under `scripts/characters`.

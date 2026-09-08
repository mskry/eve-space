# Universe Subsystem

## Static Location Cache

The static-location cache has one-way dependencies from orchestration to database and state, and from both of those to pure snapshot types.

- `static-location-types.ts` is the pure representation leaf and has no local dependencies.
- `static-location-cache-state.ts` exclusively owns mutable process-local cache state and depends only on representation.
- `database-read.ts` owns shared bounded, cancellable PostgreSQL read mechanics and has no local universe dependencies.
- `static-location-store.ts` owns PostgreSQL revision and snapshot reads and depends only on representation and shared database reads within this subsystem.
- `static-locations.ts` is the public orchestration entry point and may depend on every lower tier.

Do not import orchestration into the state or database adapter. Keep ESI resolution caches, private resource state, and routing state outside this cache.

## Universe Routing

- `route-types.ts` is the consumer-independent representation leaf.
- `topology-state.ts` exclusively owns mutable process-local topology state, revision-check timing, and failure throttling.
- `topology-store.ts` projects and validates route topology from one completed SDE snapshot.
- `topology.ts` coordinates bounded build checks, concurrent loading, stale-check fallback, and atomic replacement.
- `route-calculator.ts` dispatches explicit route policies and depends only on topology and route representations.

Keep routing independent from HTTP, characters, assets, ESI, and Redis. Add future route policies behind the calculator rather than branching in consumers.

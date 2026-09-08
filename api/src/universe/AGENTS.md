# Universe Subsystem

## Static Location Cache

The static-location cache has one-way dependencies from orchestration to database and state, and from both of those to pure snapshot types.

- `static-location-types.ts` is the pure representation leaf and has no local dependencies.
- `static-location-cache-state.ts` exclusively owns mutable process-local cache state and depends only on representation.
- `static-location-store.ts` owns PostgreSQL revision and snapshot reads and depends only on representation within this subsystem.
- `static-locations.ts` is the public orchestration entry point and may depend on every lower tier.

Do not import orchestration into the state or database adapter. Keep ESI resolution caches, private resource state, and routing state outside this cache.

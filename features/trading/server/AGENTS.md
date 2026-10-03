# Trading server ownership

Trading owns its declared GraphQL contribution and presentation of admitted inventory DTOs. Input parsing and DTO presentation are pure leaves; the contribution depends on those leaves and the public platform contract. The package entry exports the contribution for generated installed composition. Trading has no persistence, ESI, HTTP routing, scheduler or authorization implementation.

Run the isolated package build/typecheck, registry and GraphQL drift checks after contribution changes. Mounted GraphQL behavior and host cursor/admission tests live in `api/tests/graphql-inventory.test.ts`; generated operation type fixtures live in the Trading Nuxt package. See `features/trading/docs/contract.md` for the current fields and bounds.

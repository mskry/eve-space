# Trading Nuxt ownership

Trading owns its inventory page, filters and DTO presentation. Its query orchestration depends on generated operation documents, pure presentation helpers and the public platform runtime. It never imports application query internals, Member Audit implementations or server code. The platform owns live aggregate admission, cancellation and private presentation; inventory values remain in component memory and never enter persisted queries or SSR payloads.

Run isolated operation/runtime typechecks and affected platform lifecycle tests. Browser journeys in `test/trading-inventory.e2e.test.ts` consume the matching production fixture build, using the root E2E runner. Document behavior in `features/trading/docs/experience.md`.

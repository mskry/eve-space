# Platform Nuxt module

`src/module.ts` coordinates explicit Nuxt Kit registration. Navigation generation
and page composition are pure transformations; file resolution and template/runtime
registration own build-time effects. Feature package roots are resolved once per
setup and reused for page and exposure checks. See [AGENTS.md](AGENTS.md) for the
enforced dependency direction.

## Typechecking

`pnpm --filter @eve-space/platform-module-nuxt typecheck` checks both the standalone
package build and every runtime TypeScript/Vue file against a prepared Nuxt fixture.
The standalone build uses official `nuxt/app` type re-exports, rather than copied
function signatures. Those build shims are excluded from runtime typechecking and
the published files.

Kit writes the generated navigation template during preparation so Nuxt can check
it against the shared navigation types. Runtime configuration extends Nuxt's schema
through a registered type template.

## Module Builder assessment

The current build remains `tsc` plus component asset copying. Nuxt's
[`@nuxt/module-builder`](https://github.com/nuxt/module-builder) can replace that
pipeline and provide runtime transformations and module metadata. It is a separate
packaging migration, rather than a requirement for using Nuxt Kit.

This package exposes a root module, a separate `src/runtime.ts` public facade, and
a focused runtime API subpath. A migration must explicitly preserve all three
exports, declaration resolution, Vue assets, and source-based fixture aliases.
Module Builder's default module output layout differs from the existing
`dist/module.js`/`dist/module.d.ts` layout. Retain the current build until those
exports and a clean packed-package consumer are verified under the new builder.

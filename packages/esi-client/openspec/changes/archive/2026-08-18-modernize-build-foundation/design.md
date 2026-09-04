## Context

The package is already ESM-only but builds through unmaintained tsup, publishes source maps, declares Node 18 support, and has lint and test scripts that cannot validate the repository. The current source almost satisfies `isolatedDeclarations`; a compiler check reports only eight missing exported annotations in `src/runtime.ts` when the build configuration is excluded from the library compilation. See `proposal.md` for why this work is separated from the SDK rewrite.

This change must remain independently landable without replacing the prototype API or OpenAPI generation. It is a source-control prerequisite and will not be published before the subsequent `2.0.0` SDK change.

## Goals / Non-Goals

**Goals:**

- Validate the modern bundler, declaration, package-resolution, and quality-tool stack against the existing source.
- Establish one repeatable validation command that later generation work can extend.
- Remove published source maps and capture a trustworthy package baseline.
- Preserve current prototype imports and request behavior during this prerequisite.

**Non-Goals:**

- Change ESI methods, models, configuration, generation, or runtime behavior.
- Introduce Zod, domain clients, operation metadata, or LLM documentation.
- Publish an intermediate npm version.
- Generate package exports by mutating `package.json` during each build.

## Decisions

### Pin tsdown 0.22.14 as the library build layer

Use exact `tsdown@0.22.14`, the current stable npm release, rather than a caret range while the project remains pre-1.0. tsdown is the official Rolldown library layer and includes declaration generation through `rolldown-plugin-dts`, dependency policy, publint, and attw integration. The configuration uses current tsdown option names so a later 0.23+ upgrade does not depend on deprecated tsup compatibility.

Direct Rolldown was considered but rejected because it would require separately assembling and maintaining declaration, dependency, and package-validation behavior. Keeping tsup was rejected because its repository explicitly states that it is no longer actively maintained.

### Standardize development on Node 22.18+ and pnpm 11.21.0

Set the package engine floor to Node 22.18 and declare `pnpm@11.21.0` through `packageManager`. Build and CI use that baseline. The package output targets ES2022 rather than Node-specific syntax so modern browser bundlers remain viable.

Supporting older build runtimes was considered but rejected because there are no consumers and current tsdown already requires the selected Node floor.

### Use a neutral, bundled, inspectable ESM build

The initial tsdown entry remains the current package root, expressed in object form so later changes can add schemas, operations, and domain entries. Configuration is ESM-only, `platform: 'neutral'`, `target: 'es2022'`, clean output, no minification, no JavaScript source maps, and no declaration source maps. Normal bundled mode is retained; unbundle mode is deferred until package measurements show a concrete benefit.

Package exports remain explicit and source-controlled. Build-time export mutation is avoided because it creates review noise and npm publishing differences. The packed artifact, not the source tree, is the package-validation target.

### Enable isolated declarations now

Enable `isolatedDeclarations` for library source and exclude build/test configuration files from the declaration project. Add explicit annotations to the small set of exported runtime declarations reported by TypeScript. This lets tsdown use its fast Oxc declaration path and forces the later SDK generator to emit independently declarable exports from its first implementation.

Falling back permanently to TypeScript declaration bundling was considered but would postpone a known generator constraint until the larger change.

### Enforce dependency and package-resolution policy

The foundation package has no runtime dependencies. Configure tsdown to externalize packages and reject any emitted runtime import until an approved dependency is declared. Enable publint at error level and attw at error level with the ESM-only profile. Add an installed-tarball smoke test so validation covers actual package contents and exports.

### Use the native TypeScript and Oxc quality stack

Pin exact `typescript@7.0.2`, `oxlint@1.79.0`, `oxlint-tsgolint@7.0.2001`, and `oxfmt@0.64.0`. The `typecheck` command runs `tsc --noEmit`, which is the native Go compiler distributed by TypeScript 7. Oxlint runs with type-aware rules through `oxlint-tsgolint`; it does not install or invoke ESLint, typescript-eslint, or JavaScript-based compatibility plugins. Oxfmt is the only formatter and provides separate check and write commands.

Generated code is validated by native type checking, declaration generation, generated contract tests, and deterministic regeneration. Oxfmt and Oxlint configuration may exclude the existing third-party-generated prototype tree where checking it would create unrelated churn; maintained code is always checked, and the subsequent SDK generator must emit deterministic output compatible with the configured gates.

Use Vitest for ESM-native unit tests. Add format check, lint, typecheck, test, build, package validation, and pack inspection scripts, then compose them into one non-interactive `validate` command. Initial tests cover package imports, declaration resolution, and a mocked representative prototype request; an empty suite remains an error.

ESLint and Prettier were rejected because their JavaScript plugin/configuration stacks duplicate capabilities provided by Oxc. Vitest is selected over repairing Jest and ts-jest because the project is greenfield, ESM-only, and moving into the Rolldown/Vite tool ecosystem.

### Record but do not yet tighten package budgets

Record JavaScript, declaration, tarball, unpacked, and file-count measurements after source maps are removed. The subsequent SDK change will turn these accepted measurements into per-entry regression budgets because its generated entries materially change package shape.

## Risks / Trade-offs

- [tsdown is pre-1.0] -> Pin the exact stable version and require reviewed output diffs for upgrades.
- [`isolatedDeclarations` may expose more issues as source changes] -> Keep it in both native type checking and the tsdown declaration build so violations fail immediately.
- [Type-aware Oxlint support is provided by a separate native package] -> Pin `oxlint-tsgolint` with Oxlint and execute type-aware linting in CI so a missing binary fails closed.
- [Neutral platform output may differ from the old Node-oriented bundle] -> Run both Node installed-package and modern browser-bundler smoke tests.
- [Changing several quality tools at once can obscure failures] -> Land configuration in dependency order and keep one focused smoke test per tool.
- [No intermediate publication means the prerequisite is not independently verified by npm users] -> Validate the exact packed tarball locally and in CI.

## Migration Plan

1. Declare the Node and pnpm baselines and install pinned tsdown, TypeScript 7, Oxlint, `oxlint-tsgolint`, Oxfmt, and test dependencies.
2. Replace tsup configuration with the minimal equivalent tsdown ESM build and verify current root exports.
3. Enable isolated declarations, add required explicit runtime annotations, and verify declaration output.
4. Add native type checking, type-aware Oxlint, Oxfmt, Vitest, publint, attw, installed-package smoke, and pack-inspection commands.
5. Remove tsup and obsolete ESLint, Prettier, Jest, and ts-jest tooling, regenerate the pnpm lockfile, and run the complete validation command.
6. Record package measurements and land the prerequisite without publishing it.

Rollback restores the previous package, TypeScript, and tsup configuration plus the prior lockfile. No consumer data or API migration is involved.

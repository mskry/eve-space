## Why

The project currently depends on unmaintained tsup, has no working lint or test configuration, and has not validated whether its generated declarations satisfy the modern build path planned for the SDK rewrite. Establishing a green build foundation first isolates toolchain risk from the substantially larger generation and client change.

## What Changes

- Replace tsup with the exact latest stable tsdown release and use its Rolldown-powered library build, declaration generation, dependency controls, publint integration, and attw integration.
- **BREAKING** Raise the package and development runtime baseline to Node.js 22.18+ while retaining ESM-only package output.
- Configure bundled ESM output for a neutral platform and ES2022 target, keep package exports source-controlled, and omit JavaScript and declaration source maps from the published package.
- Enable `isolatedDeclarations` and add the explicit annotations needed for the existing prototype source to pass declaration generation.
- Establish pnpm as the declared package manager and align build, native TypeScript 7 type-check, Oxlint, Oxfmt, test, package-validation, and pack-inspection scripts.
- Add type-aware Oxlint through `oxlint-tsgolint`, Oxfmt checks, and Vitest scaffolding with initial build and package smoke tests.
- Record package bundle, declaration, tarball, unpacked, and file-count baselines for later SDK size budgets.
- Keep the current client API and OpenAPI generation behavior unchanged; this prerequisite will be landed but not published independently before the planned `2.0.0` SDK release.

## Capabilities

### New Capabilities
- `modern-library-build`: ESM package construction, declarations, runtime baseline, package resolution validation, and repeatable quality commands for the TypeScript library.

### Modified Capabilities

None. This project has no existing OpenSpec capability specifications.

## Impact

- tsdown, TypeScript 7's native Go compiler, Oxlint, `oxlint-tsgolint`, Oxfmt, publint, attw, and Vitest replace the current tsup and incomplete quality-tool setup.
- `package.json`, the pnpm lockfile, TypeScript configuration, build configuration, Oxlint/Oxfmt/test configuration, and a small number of exported runtime annotations will change.
- Build and package validation will require Node.js 22.18+ and pnpm 11.21.0.
- The package remains ESM-only and retains its current client API during this prerequisite.
- No intermediate npm release is planned; `2.0.0` remains reserved for the subsequent breaking SDK surface.

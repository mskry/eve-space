## 1. Runtime and Package Manager Baseline

- [x] 1.1 Set Node.js 22.18+ in package engines and development-version files, and declare `pnpm@11.21.0` as the package manager.
- [x] 1.2 Install exact `tsdown@0.22.14`, `typescript@7.0.2`, `oxlint@1.79.0`, `oxlint-tsgolint@7.0.2001`, and `oxfmt@0.64.0` plus current compatible publint, attw, and Vitest development dependencies through pnpm.
- [x] 1.3 Add package scripts for format checking, linting, type checking, testing, building, package validation, pack inspection, and aggregate validation.

## 2. tsdown ESM Build

- [x] 2.1 Replace `tsup.config.ts` with a typed tsdown configuration for object-form root entry, bundled ESM, neutral platform, ES2022 target, clean output, no minification, and no source maps.
- [x] 2.2 Configure dependency policy to externalize declared packages and reject every unexpected runtime import in JavaScript or declarations.
- [x] 2.3 Keep package exports explicit, point them to tsdown output, and verify the current root implementation and declaration files build successfully.
- [x] 2.4 Add Node installed-tarball and modern browser-bundler smoke tests for the current package root.

## 3. Isolated Declarations

- [x] 3.1 Split or constrain TypeScript configuration so library source enables `isolatedDeclarations` while build and test configuration files are excluded from declaration compilation.
- [x] 3.2 Add explicit annotations to the exported runtime declarations identified by the isolated-declaration compiler check without changing runtime behavior.
- [x] 3.3 Verify tsdown uses its isolated declaration path and that emitted declarations resolve under ESM and bundler TypeScript resolution.

## 4. Working Quality and Package Gates

- [x] 4.1 Configure Oxlint with `oxlint-tsgolint` type-aware rules and zero-warning CI behavior for maintained source, with explicit exclusions for third-party-generated prototype code where required.
- [x] 4.2 Configure Oxfmt as the only formatter, add non-mutating format checks and an explicit write command, and document generated-file boundaries.
- [x] 4.3 Configure native TypeScript 7 `tsc --noEmit` type checking and verify that the command uses the installed TypeScript 7 binary.
- [x] 4.4 Add Vitest configuration and tests for representative current imports, a mocked request, error propagation, and the requirement that the suite is non-empty.
- [x] 4.5 Enable publint at error level and attw at error level with the ESM-only profile against the packed artifact.
- [x] 4.6 Add pack inspection that rejects source maps and records bundle, declaration, tarball, unpacked, and file-count measurements.

## 5. Integration and Baseline

- [x] 5.1 Compose all checks into one non-interactive validation command and run it from a Node 22.18+ pull-request CI workflow.
- [x] 5.2 Remove tsup and obsolete ESLint, typescript-eslint, Prettier, Jest, and ts-jest dependencies and configuration, then regenerate the pnpm lockfile.
- [x] 5.3 Run clean install, Oxfmt check, native TypeScript 7 typecheck, type-aware Oxlint, tests, build, publint, attw, installed-package smoke tests, and pack inspection from scratch.
- [x] 5.4 Record the accepted package measurements for the SDK change, verify the prototype API remains intact, and land without publishing an intermediate npm version.

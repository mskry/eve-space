## Purpose

Provide a modern, repeatable, and validated ESM build foundation that can safely support the generated SDK without carrying obsolete toolchain or runtime constraints.

## ADDED Requirements

### Requirement: Modern ESM runtime baseline
The package SHALL advertise and support Node.js 22.18 or newer, SHALL provide ESM implementation and declaration entries, and SHALL not advertise or emit a CommonJS implementation.

#### Scenario: Supported Node import
- **WHEN** a consumer on Node.js 22.18 or newer imports the package root
- **THEN** the ESM implementation and TypeScript declarations resolve successfully

#### Scenario: CommonJS resolution
- **WHEN** package validation evaluates a CommonJS `require` path
- **THEN** the package does not claim to provide a CommonJS implementation

### Requirement: Standards-based package output
The package SHALL emit standards-based ES2022 modules suitable for Node.js and modern browser bundlers without runtime compatibility shims.

#### Scenario: Browser-bundler consumption
- **WHEN** a modern browser bundler resolves the package entry
- **THEN** it can process the neutral ESM output without Node-specific wrapper code

### Requirement: Isolated declaration generation
All published source exports SHALL satisfy isolated declaration generation and the build SHALL produce declarations that resolve consistently with their JavaScript entries.

#### Scenario: Declaration build
- **WHEN** the package is built from a clean checkout
- **THEN** declaration generation succeeds without inferred exported declarations that violate isolation

### Requirement: Controlled runtime dependencies
The build SHALL externalize declared runtime packages, SHALL reject undeclared runtime imports in emitted JavaScript or declarations, and SHALL not silently inline development dependencies.

#### Scenario: Unexpected runtime import
- **WHEN** emitted output imports a package absent from the approved runtime dependency set
- **THEN** package validation fails before publication

### Requirement: Validated package resolution
The build SHALL validate package metadata, ESM implementation resolution, declaration resolution, and named exports against the packed artifact.

#### Scenario: Export points to a missing file
- **WHEN** a package export references an output file that was not emitted
- **THEN** the validation command fails

### Requirement: Reproducible quality commands
The project SHALL provide non-interactive commands for Oxfmt formatting checks, type-aware Oxlint linting, native TypeScript 7 type checking, unit tests, building, package validation, and pack inspection, and each command SHALL return a non-zero status on failure.

#### Scenario: Formatting drift
- **WHEN** a maintained file does not match the configured Oxfmt output
- **THEN** the formatting check exits unsuccessfully without rewriting the file

#### Scenario: Lint violation
- **WHEN** source violates an enabled lint rule
- **THEN** the lint command exits unsuccessfully

#### Scenario: Type error
- **WHEN** source violates the TypeScript project contract
- **THEN** the native TypeScript 7 type-check command exits unsuccessfully

#### Scenario: Empty test suite
- **WHEN** the configured test command discovers no tests
- **THEN** the test command exits unsuccessfully rather than reporting success

### Requirement: Lean published artifact
The packed package SHALL omit JavaScript and declaration source maps and SHALL record compressed size, unpacked size, bundle size, declaration size, and file count for regression comparison.

#### Scenario: Package inspection
- **WHEN** the package is packed from a clean build
- **THEN** no source map is included
- **THEN** all recorded package measurements are produced

### Requirement: Prototype API stability
The build-foundation change SHALL preserve the prototype's current ESM client exports and runtime request behavior until the subsequent SDK change replaces them.

#### Scenario: Existing prototype smoke test
- **WHEN** the foundation build is complete
- **THEN** representative current API imports and a mocked request continue to work through the packed artifact

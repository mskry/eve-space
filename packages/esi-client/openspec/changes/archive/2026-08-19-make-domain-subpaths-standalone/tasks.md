## 1. Lock Generated Boundaries

- [x] 1.1 Add emitter fixtures that require deterministic model dependency modules and one operation-schema module per generated domain.
- [x] 1.2 Add emitter fixtures for public abstract domain contracts, protected constructors, `create<Domain>Client` factories, and non-exported configuration binders.
- [x] 1.3 Add generation validation that rejects unresolved schema dependencies, duplicate granular exports, missing domain factories, and descriptor imports from another domain's operation-schema module.
- [x] 1.4 Add exact type-contract assertions for every factory's options, normal domain methods, metadata view, and operation input/output types.

## 2. Partition Generated Schemas

- [x] 2.1 Extend the normalized schema model to compute a deterministic transitive model dependency closure for every operation and domain.
- [x] 2.2 Emit one canonical module per model schema and one operation-schema module per domain without duplicating schema definitions.
- [x] 2.3 Rebuild aggregate model, operation, and schema barrels over the granular modules while preserving all existing public schema export names.
- [x] 2.4 Update each domain descriptor and domain type contract to import only its assigned operation schemas and required model types.
- [x] 2.5 Regenerate schemas, descriptors, provenance, and generated schema tests; verify all 233 operations retain request and success-response schema coverage.

## 3. Add Standalone Domain Factories

- [x] 3.1 Generate abstract public domain and metadata-view class contracts whose published constructors expose no internal configuration type.
- [x] 3.2 Generate internal concrete domain implementations and binders that retain one configuration across normal and metadata views.
- [x] 3.3 Generate an options-based `create<Domain>Client` export for every public domain subpath using the same configuration normalization as the aggregate client.
- [x] 3.4 Update aggregate `EsiClient` assembly to use the internal binders with its single shared configuration while preserving every existing domain property.
- [x] 3.5 Add maintained parity tests for standalone and aggregate request construction, compatibility dates, authentication, validation, errors, metadata, and typed-mutation behavior.
- [x] 3.6 Replace constructor-oriented package smoke assertions with factory construction while retaining runtime `instanceof` coverage against the public abstract class values.

## 4. Enforce Transitive Entry Budgets

- [x] 4.1 Implement syntax-aware packed-artifact graph tracing for static imports, re-exports, and literal dynamic imports in emitted JavaScript and declarations.
- [x] 4.2 Make graph tracing normalize relative paths, count each reachable packed file once, record approved external edges, and fail on missing, escaping, unsupported, or undeclared edges.
- [x] 4.3 Add graph-analyzer tests covering cycles, duplicate paths, re-exports, declaration imports, literal dynamic imports, approved peers, missing targets, and undeclared packages.
- [x] 4.4 Version the package-budget schema forward and replace direct-target entry budgets with sorted transitive runtime/declaration file lists and unique byte maxima.
- [x] 4.5 Adjust deterministic tsdown chunking until every domain graph excludes the root, global operation registry, unrelated domain implementations, and unrelated operation-schema modules.
- [x] 4.6 Refresh and review the packed-path and byte baseline only after aggregate totals and all public-entry transitive graphs pass the new isolation assertions.

## 5. Prove Installed Modular Use

- [x] 5.1 Add an installed-tarball runtime smoke consumer that imports only the status domain subpath, constructs its factory with mock fetch, invokes the curated `get` method, and exercises `withMetadata()`.
- [x] 5.2 Add installed TypeScript consumers that compile every generated domain factory without importing the package root and reject inaccessible configuration types in public declarations.
- [x] 5.3 Assert every packed domain runtime and declaration closure excludes unrelated domains and aggregate operation-discovery artifacts.
- [x] 5.4 Regenerate domain and operation documentation with standalone factory examples alongside aggregate `EsiClient` examples, and compile all generated examples.
- [x] 5.5 Update the README and changelog with the standalone factory API, direct-constructor migration, and the distinction between import footprint and total installation size.

## 6. Validate the Corrected Release Candidate

- [x] 6.1 Run clean generation twice and verify source, documentation, examples, tests, provenance, package exports, and budget artifacts are reproducible with no diff.
- [x] 6.2 Run formatting, type-aware linting, TypeScript checks, all unit and generated tests, example compilation, build, publint, ATTW, installed-package smoke tests, and package inspection.
- [x] 6.3 Verify the complete CI matrix passes on supported Ubuntu and Windows runners, including standalone factory execution and transitive graph gates.
- [x] 6.4 Inspect the final tarball and confirm generated documentation remains excluded, Zod remains external, all public entries resolve, and no npm publication occurs during implementation.
- [x] 6.5 Report the existing pushed `v2.0.0` tag as stale and leave tag replacement or version increment to a separate explicit release action after validation.

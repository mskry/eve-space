## Context

See `proposal.md` for motivation. Generated domain entrypoints currently export concrete classes whose public constructors require `EsiClientConfiguration`, but that class is not a public package value. The aggregate `EsiClient` can construct those classes because it owns the configuration internally, and the installed-package tests only prove that a root-created domain is assignable to a subpath-exported class.

The emitted graph also defeats narrow retrieval. Every descriptor imports runtime schemas from one generated operation-schema module, so a status-only runtime reaches the global schema chunk. Its declarations similarly reach the global operation declaration file. Package inspection records only each `exports` target's own bytes, not imported chunks.

The configuration is immutable, the maintained executor already centralizes transport behavior, and Zod must remain external. The aggregate root, schema barrel, and operation-discovery registry must continue to work, while generated output must remain deterministic and isolated-declaration compatible.

## Goals / Non-Goals

**Goals:**

- Provide one options-based factory per domain that is usable from the domain subpath alone.
- Keep root-created and factory-created domains on the same executor, configuration normalization, response shapes, metadata behavior, and mutation rules.
- Make domain runtime and declaration graphs contain only that domain's operation schemas plus genuinely shared client or model dependencies.
- Preserve runtime class identity for consumers that use `instanceof`, without exposing an internal-configuration constructor.
- Measure and gate the unique transitive files and bytes reachable from every public code entry.
- Keep the aggregate entries complete and generated from the same operation model.

**Non-Goals:**

- Lazy-load properties on `EsiClient` or change its synchronous construction API.
- Add automatic pagination, retries, caching, middleware, or mutable transport state.
- Add domain-specific schema package exports in this change; domain-local schema modules are internal graph boundaries behind existing public entries.
- Reduce the npm tarball to the size of one selected domain. Installation size remains an aggregate package concern; this change limits what an imported entry evaluates and what TypeScript resolves.
- Publish the package or mutate the existing release tag during implementation.

## Decisions

### Generate domain factories as the supported standalone constructor

Every public domain entry exports `create<Domain>Client(options?)`, for example `createStatusClient(options?)`. The factory accepts `EsiClientOptions`, performs the same normalization as `EsiClient`, and returns the normal domain view. `withMetadata()` remains the explicit way to obtain the metadata-returning view. Typed mutations retain their existing intent semantics; the factory does not introduce generic mutation gates for named methods.

The generated public class values remain available for stable names and `instanceof`, but become abstract public contracts with protected constructors. Generated implementation classes and configuration-binding helpers move behind non-exported internal modules. The public factory creates one normalized configuration and calls the internal binder; aggregate `EsiClient` calls the same binder with its one shared configuration. Published declarations therefore expose no constructor parameter typed as an inaccessible internal class.

This structure provides these two paths without duplicating request behavior:

```text
createStatusClient(options)
          │
          ▼
normalize configuration ─────┐
                             ▼
                       bind status domain ──▶ shared executor
                             ▲
EsiClient shared config ─────┘
```

Alternative considered: export `EsiClientConfiguration` from the root. Importing the root defeats narrow loading, and making configuration plumbing the primary domain API is unnecessarily low-level. A dedicated configuration subpath would solve selective multi-domain composition, but no current requirement needs it.

Alternative considered: let every domain constructor accept `EsiClientOptions`. That either creates separate configurations for every aggregate domain or requires a public overload that leaks the internal configuration type. Public factories plus internal binders keep one aggregate configuration and one clear standalone path.

Alternative considered: replace classes with interfaces. That is simpler but unnecessarily removes runtime identity already exercised by package smoke tests.

### Emit schemas at dependency-addressable granularity

The schema emitter splits the monolithic output into deterministic model modules and per-domain operation-schema modules. Each model schema has one canonical generated definition. A domain operation module imports only the model schemas in the transitive schema dependency closure of that domain's operations. Domain descriptors and public domain contracts import their runtime schemas and types from the matching domain operation module.

Aggregate schema barrels re-export the granular modules, and the global operation registry continues to assemble all domain descriptors. The build may produce shared chunks for client infrastructure and model schemas used by multiple domains, but it must not combine unrelated operation-schema modules into a chunk that makes one domain entry reach another domain. Chunk names are not API; the measured graph is the acceptance boundary.

Alternative considered: keep monolithic generated schema sources and rely on export tree shaking. Multi-entry code splitting currently preserves the monolithic module as a shared chunk, and declarations still resolve the entire file, so source granularity must change.

Alternative considered: independently bundle every domain into a self-contained file. That narrows imports but duplicates the executor and shared schemas across all entries, inflating the tarball and creating more opportunities for emitted behavior drift.

### Preserve one aggregate source of truth

The corrected normalized operation model remains the only generator input. It derives model dependency modules, per-domain operation schemas, public domain contracts, internal implementations, factories, aggregate barrels, registry entries, documentation, and tests in one deterministic run. Generation fails on unresolved schema dependencies, duplicate exports, missing factories, or a descriptor importing an operation schema outside its assigned domain.

Factory-created and root-created clients both call the maintained descriptor executor. Authentication remains token-or-provider based, successful domain calls return bare validated data, metadata views return `EsiResponse<T>`, and generic mutation policy remains confined to generic execution.

### Budget transitive public-entry graphs

Package inspection starts at each public entry's `import` and `types` targets and follows static relative imports and re-exports through packed JavaScript and declarations. Literal dynamic imports, if introduced, are included. Each reachable packed file contributes bytes once per entry, even when multiple paths reach it. Approved external packages such as Zod are recorded as external edges but are not charged as packed bytes.

Inspection fails closed on missing relative targets, paths escaping the packed package, syntax it cannot analyze, or undeclared external runtime imports. The baseline schema is versioned forward and stores, for every public code entry:

- Runtime target, sorted reachable runtime files, external edges, and unique bytes.
- Declaration target, sorted reachable declaration files, external edges, and unique bytes.
- Tight maxima using the existing reviewed headroom policy.

Aggregate compressed, unpacked, JavaScript, declaration, file-count, and exact packed-path gates remain. Direct target sizes may remain diagnostic fields, but they are not the modularity budget.

Alternative considered: use only bundler-reported entry sizes. Declaration graphs are outside the bundler, and package validation must inspect the exact packed artifact consumers install, so one packed-graph analyzer covers both surfaces.

### Test installed behavior and graph isolation

Generated type assertions verify every domain exports its expected factory and that factory return methods match generated schema types. Installed-package smoke tests use a fresh consumer that imports only a representative domain subpath, constructs it with a mock fetch implementation, invokes an operation, and exercises its metadata view. The test source must contain no root import.

Packed-graph tests assert that each domain entry excludes the aggregate root, global operation registry, unrelated domain implementations, and unrelated operation-schema declarations. Documentation generation emits both standalone factory and aggregate-client examples, and the examples project compiles both forms.

Testing every domain's graph is required because a representative smoke request cannot detect one emitter partitioning error in another domain. Runtime invocation remains representative to avoid duplicating generated operation-contract coverage.

## Risks / Trade-offs

- [Granular schema generation can create many source modules and emitted chunks] -> Keep npm package file count gated, group only modules with compatible entry reachability, and review the refreshed packed-path baseline.
- [A model shared by many domains can accidentally cause the bundler to merge unrelated schemas] -> Treat emitted transitive graph assertions as the acceptance boundary and configure deterministic chunking based on reachability when automatic chunking is too broad.
- [Abstract public contracts and internal implementations complicate generation] -> Derive both from the same domain method model and compile exact signature assertions for normal and metadata views.
- [Removing public concrete constructors can affect unreleased 2.0.0 examples or local consumers] -> Keep class values and `instanceof`, document factories as the migration path, and update all repository examples before publication.
- [Static graph parsing can undercount unusual module edges] -> Use syntax-aware parsing, support imports and re-exports explicitly, include literal dynamic imports, and fail on unsupported or unresolved syntax.
- [Tighter graph budgets can be sensitive to harmless bundler changes] -> Pin the build stack, store reachable file lists for explainability, and require deliberate baseline refreshes.

## Migration Plan

1. Extend generation tests first so expected factory names, public contracts, internal binders, schema partitions, and deterministic output are specified before replacing generated artifacts.
2. Generate granular model and domain operation-schema modules, update descriptors and aggregate barrels, and verify schema/type parity remains complete for all operations.
3. Generate abstract public domain contracts, internal implementations, and public factories; update aggregate `EsiClient` to bind every domain through the shared internal path.
4. Update documentation, examples, type tests, and installed-package runtime smoke tests to make factory usage executable rather than decorative.
5. Add packed runtime/declaration graph analysis, migrate the budget schema, inspect every domain closure, and accept a new baseline only after unrelated-domain edges are absent.
6. Run clean regeneration and the complete validation suite on supported Ubuntu and Windows environments.
7. Leave npm publication and the stale pushed `v2.0.0` tag untouched during implementation. After validation, handle tag replacement or a version increment as a separate explicit release action.

Rollback before publication consists of reverting the change and retaining the prior aggregate-only candidate; there is no published 2.0.0 consumer migration to preserve.

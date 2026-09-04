## 1. Prerequisite and SDK Dependencies

- [x] 1.1 Confirm `modernize-build-foundation` is complete and its clean validation, isolated declarations, package smoke tests, and recorded measurements pass before SDK implementation.
- [x] 1.2 Declare Zod `^4.0.0` as a required peer dependency, install the exact tested Zod version as a development dependency, and add Zod to the prerequisite's approved external runtime imports.
- [x] 1.3 Add and lock the development dependencies needed for OpenAPI parsing, JSON Patch application, deterministic generation, documentation rendering, and package-size budgets.
- [x] 1.4 Define maintained and generated source, documentation, example, test, and OpenAPI snapshot boundaries so generation cannot target maintained code.

## 2. Canonical Specification Pipeline

- [x] 2.1 Implement compatibility-date resolution, staged ESI specification download, validation, normalized snapshot output, SHA-256 provenance, and failure-safe temporary output handling.
- [x] 2.2 Add the ordered RFC 6902 correction manifest with compatibility-date ranges and precondition checks, then migrate known semantic fixes into reviewed patches.
- [x] 2.3 Implement the typed normalized operation model, reference resolution, deterministic ordering, OpenAPI construct inventory, and explicit exclusion validation.
- [x] 2.4 Implement staged emitter orchestration that produces all declared generated source, metadata, documentation, examples, and tests before atomically replacing generated paths.
- [x] 2.5 Add deterministic naming and safety override inputs plus provenance headers, generated barrels, and operation accounting reports.
- [x] 2.6 Add generation tests proving unchanged inputs are byte-stable, retrieval or patch failures preserve prior generated output, maintained source is untouched, and every operation is generated or excluded.

## 3. Runtime Schema Generation

- [x] 3.1 Implement deterministic Zod emitters for references, primitives, formats, enums, arrays, loose objects, nullable values, `allOf`, `oneOf`, and `anyOf`, failing on unsupported constructs.
- [x] 3.2 Generate model, operation request, operation success-response, collection, composed, and no-content schemas from the normalized operation model.
- [x] 3.3 Generate schema barrels, operation input and output types, explicit `isolatedDeclarations`-compatible annotations, and compile-time assertions tying domain signatures to inferred schema types.
- [x] 3.4 Add generated and maintained schema tests for minimal valid data, invalid known fields, nested collections, unknown-field preservation, date-time strings, composition, and no-content responses.

## 4. Shared Transport, Metadata, and Errors

- [x] 4.1 Implement immutable client configuration for base URL, compatibility date, language, token or token provider, fetch implementation, validation policies, and `allowGenericMutations`.
- [x] 4.2 Implement stable structured discovery, authentication, mutation, HTTP, parse, and request/response validation errors with allowlist serialization, secret redaction, response metadata, and bounded parsed ESI error bodies.
- [x] 4.3 Implement descriptor-driven path substitution and query, header, and body serialization with required-parameter and unsafe-value validation.
- [x] 4.4 Implement single-request fetch execution, deferred token resolution, compatibility and language headers, successful JSON parsing, explicit `undefined` no-content results, and response validation policy.
- [x] 4.5 Build immutable `EsiResponse<T>` envelopes with status, all headers, request ID, X-Pages/cursor pagination, cache validators, and ESI error-limit metadata.
- [x] 4.6 Add transport tests proving request placement, auth timing, validation policies, custom fetch behavior, metadata extraction, no-content shapes, parsed HTTP errors, and secret-free failures.

## 5. Single Domain Client Surface

- [x] 5.1 Add reviewed facade naming and safety override files with validation for stale entries, duplicate stable IDs, domain collisions, and unclassified non-GET operations.
- [x] 5.2 Generate thin domain clients with positional required identifiers, final typed options objects, compatibility-date overrides, bare-data default results, metadata-enabled domain views, and complete operation coverage.
- [x] 5.3 Implement `EsiClient` domain assembly and make the package's pinned compatibility date the default for minimal public-client construction.
- [x] 5.4 Replace the prototype root exports with `EsiClient`, domain, schema, error, and operation-discovery exports, then remove OpenAPI Generator source, scripts, enum post-processing, and dependencies.
- [x] 5.5 Extend the prerequisite tsdown entries and explicit ESM package exports for the root, schemas, operations, and generated domain modules while keeping peer Zod external.
- [x] 5.6 Add installed-package smoke tests for every public export condition and representative root, schema, operation, and domain imports on Node 22.18+.

## 6. LLM Operation Discovery and Execution

- [x] 6.1 Generate executable operation descriptors and a credential-free serializable manifest containing parameters, schema references, auth scopes, pagination, cache, and mutation metadata.
- [x] 6.2 Implement deterministic bounded `searchOperations` scoring and filters with a default limit of 20 and hard maximum of 100.
- [x] 6.3 Implement `describeOperation` with serializable contracts and a structured unknown-operation failure.
- [x] 6.4 Implement `callOperation` through the shared transport with unconditional argument validation, exactly one request per invocation, and serializable `EsiResponse<T>` results.
- [x] 6.5 Enforce default generic mutation denial, reviewed read-like POST overrides, `allowGenericMutations`, and per-call generic confirmation while allowing named typed mutations without generic gates.
- [x] 6.6 Add discovery and execution tests covering ranking, filtering, limits, unknown IDs, authenticated scope errors, credential secrecy, read-like POSTs, generic mutation gates, typed mutation intent, metadata, and single-page pagination behavior.

## 7. Generated LLM Documentation

- [x] 7.1 Generate repository and documentation-site `llms.txt`, shared concept pages, domain indexes, and one operation reference per stable operation ID from the serializable registry.
- [x] 7.2 Generate domain-method and generic-execution snippets plus standalone public, authenticated, paginated, metadata, validation-error, and mutation-safety examples using only safe placeholders.
- [x] 7.3 Add a dedicated TypeScript project that compiles every generated example and validates documented package subpath imports without executing requests.
- [x] 7.4 Add documentation consistency tests for complete operation coverage, provenance hashes, valid links, credential placeholders, stale output, and exclusion of generated docs/examples/`llms.txt` from the npm tarball.
- [x] 7.5 Update the maintained README to lead with `EsiClient`, link progressive LLM documentation, explain JSON-native date values, and document the Node 22.18+ ESM-only baseline.

## 8. Contract, Drift, and Release Assurance

- [x] 8.1 Generate operation contract tests for HTTP methods, paths, parameter placement, authentication, request bodies, response schemas, and no-content behavior.
- [x] 8.2 Implement pinned-versus-latest specification drift reporting for operations, parameters, fields, responses, pagination metadata, cache metadata, and authentication scopes.
- [x] 8.3 Add a single validation command that runs generation reproducibility, Oxfmt checks, type-aware Oxlint, native TypeScript 7 checks, unit and generated tests, example compilation, tsdown build, publint, attw, export smoke tests, and package checks.
- [x] 8.4 Extend the prerequisite pull-request CI to reject uncommitted generated source, documentation, examples, or provenance changes.
- [x] 8.5 Add a scheduled drift workflow that publishes a structured report without changing the pinned specification or generated source.
- [x] 8.6 Promote the prerequisite measurements into checked-in compressed, unpacked, per-entry bundle, declaration, and file-count budgets; verify generated documentation is absent and fail unexplained growth.
- [x] 8.7 Run clean end-to-end regeneration and validation, verify all corrected-spec operations are accounted for, inspect the packed ESM package, record the accepted compatibility date, and prepare the breaking `2.0.0` release.

## Context

The prototype runs OpenAPI Generator directly against the live ESI URL, deletes all of `src`, post-processes missing enum references, and exposes repetitive compile-time-only models and methods. The `modernize-build-foundation` prerequisite addresses build and quality-tool deficiencies independently. See `proposal.md` for motivation and the capability specs for required behavior.

The project has no consumers, so implementation can replace the prototype rather than preserve its API. ESI uses a compatibility-date header, publishes OpenAPI 3.1 JSON, and contains defects that cannot safely be reproduced verbatim. Generated artifacts are committed so package builds and consumer installs do not depend on network access. The separate `modernize-build-foundation` change establishes tsdown, Node 22.18+, ESM packaging, isolated declarations, native TypeScript 7 checking, Oxlint, Oxfmt, package validation, and initial size measurements before this change starts.

## Goals / Non-Goals

**Goals:**

- Establish one normalized operation model from which schemas, facade methods, metadata, documentation, examples, and tests are emitted.
- Make regeneration deterministic, reviewable, and unable to destroy maintained source or a previously valid generated tree on failure.
- Produce one small and predictable client surface without duplicate generated implementations or model representations.
- Make operation discovery and generic execution safe enough to embed behind an LLM tool adapter.
- Keep Zod external to emitted bundles and enforce package-size changes in CI.
- Preserve complete ESI response metadata without burdening normal typed calls with envelopes.
- Keep large generated documentation and examples outside the npm tarball.

**Non-Goals:**

- Add an MCP server or provider-specific OpenAI, Anthropic, or other tool adapter.
- Add caching, retries, automatic all-page pagination, circuit breaking, or rate-limit scheduling.
- Hand-maintain response schemas or duplicate endpoint definitions outside reviewed correction and naming files.
- Preserve the prototype's OpenAPI Generator classes, converters, or request interfaces.
- Automatically accept an upstream ESI specification update without review.
- Use direct Rolldown configuration when tsdown already provides the required library build, declaration, dependency, and package-validation behavior.

## Decisions

### Use a staged generation orchestrator and committed specification snapshot

A maintained Node generation orchestrator will resolve an explicit compatibility date, download the OpenAPI document to a staging directory, validate it, apply corrections, normalize it, compute a SHA-256 hash, and generate all outputs before replacing declared generated paths. The accepted normalized snapshot and a small provenance file will be committed under an `openapi/` directory. Generated source will live under `src/generated/`; maintained code will live in sibling directories.

The orchestrator will use temporary output under the operating system's temporary directory and only replace generated paths after every emitter and validation step succeeds. Replacement paths will be enumerated rather than derived from user input. This prevents a failed fetch or emitter from deleting the last known-good SDK.

Alternative considered: continue generating directly from the URL during build. This is simpler but is non-reproducible, makes builds network-dependent, and cannot reliably distinguish upstream drift from generator changes.

### Apply ordered JSON Patch corrections before normalization

Known ESI defects will be represented as ordered, version-controlled RFC 6902 patch documents with a human-readable reason and affected compatibility-date range in a companion manifest. The pipeline will fail if a patch target no longer exists or if an expired patch still applies. Every emitter consumes the corrected normalized document, never the uncorrected source.

Alternative considered: continue source-text post-processing such as `fix-api-enums.mjs`. Text replacement is removed with OpenAPI Generator; API-semantic corrections belong before generation so all artifacts agree.

### Remove OpenAPI Generator and emit one client surface

OpenAPI Generator, its model converters, and its generated runtime will be removed. The normalized operation model will emit domain methods, schemas, types, descriptors, and tests directly, while one maintained transport performs requests for both typed domain methods and generic operation execution. This avoids shipping two request implementations and two representations of every response.

Alternative considered: retain OpenAPI Generator as an advanced subpath. With no consumers to migrate, that would preserve the largest source of package and declaration size while forcing documentation and tests to explain two APIs.

### Build one typed normalized operation model for all new artifacts

A maintained parser will convert corrected OpenAPI paths, operations, parameters, security, request bodies, responses, cache extensions, and pagination indicators into a deterministic intermediate representation. Stable operation IDs come from the specification; a reviewed naming override file maps awkward or colliding IDs to facade domain and method names. Generation fails on duplicate stable IDs, duplicate facade names within a domain, unresolved references, or unsupported schema constructs unless an explicit exclusion exists.

All emitters consume this intermediate representation in one process:

- Zod model, request, and operation response schemas
- Domain methods and `EsiClient` assembly
- Runtime and serializable operation registries
- Package subpath barrels
- Domain and operation documentation
- Usage snippets and representative standalone examples
- Request-construction, validation, and type test cases

Alternative considered: run unrelated third-party generators for each artifact. Independent generators interpret names, nullability, and OpenAPI composition differently and would require a drift layer between outputs.

### Generate Zod 4 schemas with JSON-native public results

The schema emitter will support the OpenAPI constructs used by ESI, including references, primitives, formats, enums, arrays, objects, nullable values, `allOf`, `oneOf`, and `anyOf`. Unknown constructs fail generation instead of degrading to `any` or `unknown`. Object responses use loose-object behavior so unknown upstream fields survive. Date and date-time fields validate their wire strings and remain JSON-native strings in public results.

Public operation types are inferred from generated schemas. Compile-time assertions compare generated domain signatures with schema input and output types. Generated source includes explicit export annotations and satisfies the prerequisite's `isolatedDeclarations` gate.

Zod is declared as a required peer dependency with range `^4.0.0` and as an exact development dependency at the version exercised by generation and tests. This avoids bundling or nesting a second schema runtime while ensuring exported schemas compose with the consumer's supported Zod 4 instance.

Alternative considered: emit TypeScript interfaces and annotate handwritten Zod schemas. This repeats the competitor's maintenance burden and makes complete regeneration impossible. Transforming date-time values to `Date` was also rejected because JSON-native values are easier to serialize, document, and pass through LLM tools.

### Validate at the generic execution boundary

The maintained transport accepts a generated runtime operation descriptor and arguments. It validates generic execution arguments unconditionally, builds path/query/header/body values from descriptor metadata, applies client configuration, performs one fetch, handles no-content responses, parses JSON, and validates response data according to client policy. Generated typed domain methods call the same execution path but may skip request validation when client request validation is disabled because their TypeScript signatures already constrain normal callers.

Validation errors use stable codes and contain operation ID, direction, and normalized issue paths. HTTP and discovery errors use the same structured error base. HTTP errors include status, response metadata, and a size-bounded parsed JSON ESI error body when available, falling back to bounded response text when JSON parsing fails. Error serialization and logging use an allowlist; request headers, tokens, token-provider values, and raw authenticated request bodies are not attached.

Alternative considered: validate in fetch response middleware. Middleware lacks reliable operation identity and makes request-schema validation and structured metadata more difficult.

### Return bare domain data with an explicit metadata view

The shared transport always produces an internal `EsiResponse<T>` containing `data` and immutable metadata. Normal domain methods unwrap and return `T` for ergonomic use. Every generated domain exposes `withMetadata()`, returning the same typed method surface but with `Promise<EsiResponse<T>>` results. Generic `callOperation` always returns the serializable envelope because tool callers require status, pagination, and rate information.

Metadata contains status, all response headers as a lowercase-keyed read-only record, request ID, normalized `X-Pages` pagination data, cursor values when present, ETag/Expires/Last-Modified cache data, and ESI error-limit remaining/reset data. Raw headers remain available so newly introduced ESI headers do not require an SDK release. A no-content domain method resolves to `undefined`; metadata and generic variants return `{ data: undefined, meta }`.

Returning envelopes from every domain method was considered but rejected because it makes ordinary SDK use noisy. Exposing only selected normalized fields was rejected because ESI can introduce operationally relevant headers before the client updates.

### Generate thin domain wrappers over the shared transport

`EsiClient` owns immutable shared configuration and exposes generated domain properties. Required path identifiers remain positional for readable calls; optional query and header parameters are grouped into a final typed options object. The package's pinned compatibility date is the default, with a client-level override and an operation-level override in the options object. The safety option is named `allowGenericMutations` to make its scope explicit.

Each domain method delegates to the same descriptor executor. This avoids maintaining hundreds of request implementations while preserving direct method autocomplete. Authentication accepts a token or asynchronous token provider and is resolved only when an authenticated request is executed. Calling a named typed mutation is treated as explicit developer intent and is not gated by `allowGenericMutations` or generic per-call confirmation; normal request validation and authentication still apply.

Alternative considered: generate independent request implementations for domain and generic APIs. Shared descriptor execution prevents behavior drift and substantially reduces generated runtime code.

### Separate executable descriptors from the serializable manifest

The runtime registry contains Zod schemas and internal execution metadata. A generated JSON-compatible manifest contains schema references and JSON Schema representations but no functions. `describeOperation` reads the serializable view. `searchOperations` uses a precomputed lowercase search document, deterministic scoring, stable ID tie-breaking, and a default result limit of 20 with a hard maximum of 100.

Generic `callOperation` performs one operation invocation and returns an `EsiResponse<T>` envelope. It does not follow page headers or cursor tokens automatically. Every non-GET operation is classified as a mutation unless a reviewed safety override marks a read-like POST. Generic mutations require `allowGenericMutations: true` at client construction and `confirmMutation: true` on the individual call.

Alternative considered: export every endpoint directly as an LLM tool. Hundreds of tool definitions consume excessive context and make safety policy difficult to centralize. Search, describe, and call provide progressive disclosure.

### Generate documentation from registry templates

Documentation emitters produce a compact `llms.txt`, shared concept pages, domain indexes, and one operation reference per stable ID. Operation references include domain-method and generic-execution examples. Every operation gets an inline generated usage snippet; a smaller representative set becomes standalone examples for public, authenticated, paginated, metadata, validation-error, and mutation flows.

Generated examples use fixed placeholder identifiers and environment-token placeholders. A dedicated TypeScript project compiles all examples without executing them. Documentation and examples carry the same provenance hash as source generation. The repository stores these artifacts and the documentation deployment publishes them, including `llms.txt` at the site root. They are excluded from npm package files; the tarball contains runtime/declaration output, package metadata, README, and license only.

Alternative considered: generate one complete API document. The resulting context is difficult for retrieval systems and repeats the current monolithic declaration problem.

### Extend the prerequisite package foundation

This change assumes `modernize-build-foundation` has landed and does not repeat its bundler migration, Node baseline, native TypeScript/Oxlint/Oxfmt/test scaffolding, or package-validation work. It adds explicit tsdown entries for the root, schemas, operation discovery, and generated domain barrels and extends the source-controlled package exports accordingly.

Zod is added to the prerequisite's approved external runtime imports as a required peer. Generated documentation and examples remain outside package files. Normal bundled multi-entry output with automatic shared chunks remains in place; unbundle mode is not introduced.

The root remains a convenience entrypoint. LLM documentation recommends narrow subpaths to reduce retrieved declarations. CI promotes the prerequisite measurements into explicit compressed tarball, unpacked size, per-entry bundle, declaration, and file-count budgets; unexplained growth fails validation.

### Generate tests and gate drift rather than trusting generation

The pipeline generates test vectors for every operation covering method, path substitution, query/header/body placement, authentication, and declared no-content behavior. Schema fixtures cover valid minimal responses, unknown fields, and representative invalid fields. Maintained tests cover transport, redaction, mutation safety, search ranking, and failure atomicity. Type tests compile domain signatures, generic execution, schema imports, package subpaths, and documentation examples.

CI runs generation and rejects a dirty tree, then runs Oxfmt checks, type-aware Oxlint, native TypeScript 7 checking, tests, build, package-export smoke tests, and package-size checks. A scheduled workflow compares the pinned and latest specifications and publishes a report or opens a regeneration proposal, but does not overwrite the pinned snapshot.

Alternative considered: rely only on live ESI smoke tests. Live tests are useful as a limited scheduled signal but are non-deterministic, require credentials for broad coverage, and cannot replace request-construction or schema tests.

## Risks / Trade-offs

- [Custom schema and metadata emitters must correctly implement the ESI subset of OpenAPI 3.1] -> Inventory constructs before implementation, fail closed on unsupported forms, and generate contract fixtures for each construct.
- [Generated Zod schemas and multiple entries increase source and package size] -> Externalize Zod, omit published source maps, publish narrow entries, and enforce measured budgets.
- [`isolatedDeclarations` constrains generated and maintained export shapes] -> Make explicit public annotations an emitter invariant and run declaration type checks before replacing generated output.
- [Operation naming overrides can become stale] -> Validate every override against the pinned specification and reject unused or colliding entries.
- [Loose object schemas can preserve unexpected data] -> Validate every known field, document passthrough behavior, and never use unknown properties for authentication or request construction.
- [A specification correction can conceal a real upstream change] -> Scope corrections by compatibility date, require reasons, and fail when patch preconditions no longer match.
- [Generic execution creates a powerful dynamic surface] -> Validate arguments unconditionally, execute one page only, block mutations twice, and redact secrets by construction.
- [The convenience root still aggregates all domains] -> Direct retrieval and size-sensitive use to domain and schema subpaths and enforce per-entry declaration budgets.

## Migration Plan

1. Require the completed and validated `modernize-build-foundation` change before implementation begins.
2. Introduce the staged specification snapshot, correction, normalization, and provenance pipeline.
3. Implement generated schemas, operation descriptors, domain wrappers, metadata envelopes, and the shared transport in parallel with generated tests.
4. Replace the prototype root exports and remove OpenAPI Generator, its generated source, enum post-processing, and development dependency.
5. Generate operation discovery, repository/site documentation, examples, contract tests, and CI checks; establish package budgets from the prerequisite measurements.
6. Run clean generation, validation, installed-package smoke tests, and an npm pack inspection, then publish the breaking surface as `2.0.0`.

There is no consumer migration or rollback compatibility requirement. During implementation, rollback is a source revert to the last committed generated snapshot and package configuration. Because generated replacement is staged, a failed generation does not require reconstructing prior output.

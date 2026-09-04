## Context

See `proposal.md` for motivation. The normalized model preserves each upstream operation ID as stable identity. Facade metadata then uses the first OpenAPI tag as the default domain and lower-camel-cases the complete operation ID as the default method unless a maintained override exists. The current naming override list is empty, so all 233 public methods use that mechanical fallback.

The resolved facade metadata already drives domain source, manifests, search, documentation, examples, and tests. Existing validation rejects stale overrides and exact `domain.method` collisions, but it permits incomplete coverage and does not reserve every generated client member. Domain names also determine generated class names, filenames, build entries, and package subpaths. Exported input, output, schema, and descriptor symbols remain keyed to stable operation IDs.

The operation IDs must remain stable because generic execution, schema identity, errors, operation discovery, drift accounting, and generated provenance depend on them. Transport, validation, metadata return shapes, dependency semantics, and mutation safety are unaffected by facade spelling.

## Goals / Non-Goals

**Goals:**

- Make every public domain method the result of explicit human review rather than a generator fallback.
- Establish one coherent naming grammar across all domains while retaining qualifiers that carry real meaning.
- Make missing naming review a generation-blocking state for every future operation.
- Keep the accepted catalog deterministic, diffable, and traceable to stable operation IDs and route context.
- Preserve one facade mapping consumed by runtime clients, declarations, manifests, search, docs, examples, and tests.
- Coordinate naming regeneration with the standalone-domain change before the 2.0.0 release candidate is rebuilt.

**Non-Goals:**

- Rename stable operation IDs, schema exports, descriptor identities, or generic `callOperation` keys.
- Change operation grouping into deeper nested resource namespaces.
- Add aliases, deprecations, or compatibility wrappers for the unpublished transliterated methods.
- Change arguments, return values, metadata access, authentication, validation, errors, or mutation classification.
- Derive final public names automatically from summaries or routes without human acceptance.
- Publish the package or alter the existing pushed release tag during implementation.

## Decisions

### Use an exhaustive facade catalog rather than exception overrides

Replace the exception-oriented naming configuration with a versioned catalog containing exactly one entry for every normalized operation. Each entry contains:

- Stable `operationId` key.
- Explicit facade `domain`.
- Explicit facade `method`.
- `reviewed: true` acceptance marker.
- Optional concise note only when a non-obvious scope or verb choice needs explanation.

The catalog is sorted by stable operation ID for deterministic diffs. The loader compares its key set exactly with the normalized operation key set; missing and stale entries are both errors. Generation has no production fallback from operation ID to facade method after the catalog is introduced. Default naming remains available only to candidate-report tooling and focused unit fixtures.

Alternative considered: populate only high-value overrides. That creates a visibly mixed API and lets every future operation silently publish a raw transliteration.

Alternative considered: require a rationale for all 233 entries. Most entries are self-explanatory, so mandatory prose would add review noise. The explicit reviewed marker, route context report, and optional notes provide sufficient auditability.

### Review names using domain and signature context

The review grammar is:

1. Keep lower-camel-case TypeScript method names and concise noun phrases.
2. Use the domain as the primary resource context; do not repeat it in a method unless needed to distinguish a different actor or resource.
3. Use positional identifier arguments as visible context; do not encode path placeholders or `Id` suffixes into the method name.
4. Use `list` for collection retrieval, `get` for one detail or state value, and `create`, `update`, `set`, `delete`, or `remove` for ordinary mutations.
5. Prefer an established ESI semantic verb when CRUD terminology would lose intent, such as `search`, `send`, `invite`, `accept`, or `open`.
6. Retain concise actor or visibility qualifiers when one domain contains character, corporation, alliance, structure, regional, or public variants that would otherwise collide or mislead.
7. Normalize closed compounds and acronyms into readable SDK terminology instead of preserving upstream artifacts such as `Corporationhistory`, `Skillqueue`, `Openwindow`, or `Skinr` casing blindly.
8. Resolve collisions with meaningful semantic qualifiers, never numeric suffixes or input-order-dependent names.

Representative direction:

```text
GetCharactersCharacterIdAgentsResearch
  character.agentsResearch(characterId)

GetCharactersCharacterIdSkillqueue
  skills.getSkillQueue(characterId)

PostUiOpenwindowContract
  userInterface.openContract(contractId)
```

These examples establish style but do not substitute for reviewing the complete catalog. Collection/detail semantics and the need for scope qualifiers are decided from the normalized route, parameters, response shape, and summary together.

Current tag-derived domains are retained by default because they already provide coherent package subpaths. A domain reassignment is allowed only when review finds the existing grouping misleading; it requires coordinated source filename, class name, package export, build entry, documentation index, and collision updates.

Alternative considered: implement a semantic naming algorithm that strips tags, path owners, and identifiers automatically. Such heuristics can propose candidates, but path or summary changes could silently churn public API. Accepted names must be locked explicitly.

Alternative considered: introduce deeper namespaces such as `client.wallet.corporation.listTransactions()`. That could improve a few dense domains but changes facade metadata, generated shape, and package ergonomics far beyond this release correction.

### Generate a review report but never auto-accept it

A deterministic report groups operations by facade domain and shows stable ID, HTTP method and path, required path identifiers, summary, current transliteration, proposed candidate, accepted method, stable-operation-ID-keyed options type, and optional note. Candidate names bootstrap review and expose inconsistencies, but only the checked-in catalog is authoritative.

The report is a repository and documentation-site artifact, not an npm package file. Generation provenance covers both the catalog input and report output so stale review material is detected.

Alternative considered: review the JSON catalog without context. That makes it too easy to choose names that collide semantically or hide character/corporation/public distinctions.

### Expand collision and style validation

In addition to exact `domain.method` uniqueness and TypeScript identifier validation, catalog validation reserves generated and inherited members such as `constructor`, `withMetadata`, `configuration`, and `callOperation`, plus factory names introduced by `make-domain-subpaths-standalone`. Domain-derived filenames and class names are checked case-insensitively before generated output is replaced.

Method names must begin lowercase, domains must begin lowercase, and class/factory/type derivations must remain valid and unique. Method names are resolved in domain context and need only be unique within that domain. Exported option interfaces occupy a flat module namespace, so they use `<StableOperationId>Options`, matching the existing `<StableOperationId>Input`, `<StableOperationId>Output`, schema, and descriptor naming rule. Operation-ID keying guarantees traceability to discovery and uniqueness by construction while allowing concise methods such as `client.status.get()`.

Validation errors report the stable operation IDs and conflicting derived symbols. No automatic suffixing is allowed because it would hide an API-design decision.

### Preserve stable IDs as the machine interface

The catalog changes only `facade.domain` and `facade.method`. Stable operation IDs continue to identify descriptors, request and response schemas, serialized manifest entries, errors, generic execution, operation references, and drift reports. Search indexes both the stable ID and curated facade so callers can find an operation using either vocabulary.

Domain method and generic execution parity remains unchanged: both resolve to the same descriptor and maintained transport. Typed mutation intent and generic mutation gates continue to depend on operation classification, not naming.

### Remove raw names instead of carrying aliases

Clean generation emits only accepted methods and stable-operation-ID-keyed options types. The raw transliterations are not emitted as deprecated aliases, manifest aliases, or compatibility declarations. This keeps autocomplete, declaration size, documentation, and search results centered on the intended API.

Alternative considered: preserve raw aliases for migration. npm latest is 1.0.1 and the generated 2.0.0 API is unpublished, so aliases would permanently double parts of the surface to protect no released consumer.

### Apply naming before final standalone-domain regeneration

The naming catalog is resolved before all domain emitters. `curate-domain-facade-names` should be applied before, or rebased into, `make-domain-subpaths-standalone` so its public contracts, factories, graph assertions, and documentation are generated with final method names. Both changes must validate together; neither should establish a release tag independently.

## Risks / Trade-offs

- [Reviewing 233 names is subjective and can produce local inconsistency] -> Define the grammar first, review in domain batches, and run a final cross-domain verb and qualifier audit.
- [Over-shortening can erase character, corporation, public, or regional scope] -> Review route, positional parameters, response shape, and sibling methods together; retain meaningful actor qualifiers.
- [Concise methods and flat exported type names have different uniqueness constraints] -> Key option interfaces to stable operation IDs and include them in the report and installed declaration tests.
- [Domain reassignment can break package entries and conflict with standalone graph work] -> Retain existing domains by default and require explicit coordinated validation for any reassignment.
- [A candidate algorithm may be mistaken for source of truth] -> Generation consumes only reviewed catalog entries and fails when one is missing.
- [Large generated diffs can conceal unintended transport changes] -> Verify stable IDs, descriptors, HTTP methods, paths, classifications, argument placement, and schema references remain unchanged across the naming regeneration.
- [Concurrent active changes touch the same generated files] -> Apply the catalog first and regenerate the standalone-domain change against accepted facade metadata rather than merging generated output manually.

## Migration Plan

1. Version the facade configuration as an exhaustive catalog and update loader tests to require exact normalized-operation coverage.
2. Add naming grammar, reserved-symbol, derived-type, case-insensitive path, and collision validation before changing production names.
3. Generate a candidate review report from the pinned model, then review and accept all operations in domain-sized batches.
4. Run a cross-domain audit for verb consistency, actor qualifiers, compounds, acronyms, and stable operation/type traceability.
5. Regenerate clients, manifests, search data, documentation, examples, tests, accounting, and provenance from the accepted catalog.
6. Verify stable IDs, descriptors, schemas, transport arguments, authentication, mutation classification, and public return shapes did not change.
7. Rebase or regenerate `make-domain-subpaths-standalone` against the final facade catalog and run both changes through clean generation and complete package validation.
8. Leave npm publication and the existing stale `v2.0.0` tag untouched; release handling remains a separate explicit action after both release-blocking changes pass CI.

Rollback before publication consists of reverting the catalog and regenerated artifacts. No compatibility aliases or consumer migration layer must be maintained because the affected 2.0.0 facade has not been published.

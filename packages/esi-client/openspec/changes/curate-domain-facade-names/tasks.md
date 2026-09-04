## 1. Make Naming Review Mandatory

- [x] 1.1 Replace the exception-oriented naming configuration schema with an exhaustive, operation-ID-sorted facade catalog supporting reviewed domain, method, and optional note fields.
- [x] 1.2 Update facade metadata loading to require exact catalog coverage of the normalized model and remove production fallback to operation-ID transliteration.
- [x] 1.3 Expand validation for lowercase style, reserved generated and inherited members, derived class/factory/options symbols, exact facade collisions, and case-insensitive domain path collisions.
- [x] 1.4 Add focused tests for missing, stale, duplicate, unreviewed, malformed, reserved, colliding, and non-deterministically ordered catalog entries.
- [x] 1.5 Preserve default-name helpers only for candidate tooling and synthetic tests, and prove production orchestration cannot consume an unreviewed fallback.

## 2. Build the Naming Review Surface

- [x] 2.1 Generate deterministic candidate names using domain, route, positional parameters, response shape, summary, and the approved verb and terminology rules.
- [x] 2.2 Generate a domain-grouped review report showing stable ID, HTTP route, positional identifiers, summary, current transliteration, candidate name, accepted name, derived options type, and optional note.
- [x] 2.3 Add report tests for complete 233-operation coverage, stable ordering, collision visibility, readable compounds, and unchanged output under reordered model input.
- [x] 2.4 Include the accepted catalog and review report in generation provenance while keeping the report and other generated documentation outside the npm tarball.

## 3. Review All Facade Names

- [x] 3.1 Review and accept names for access-list, activities, alliance, assets, calendar, and character operations.
- [x] 3.2 Review and accept names for clones, contacts, contracts, corporation, corporation-projects, and cosmetics operations.
- [x] 3.3 Review and accept names for dogma, faction-warfare, fittings, fleets, and freelance-jobs operations.
- [x] 3.4 Review and accept names for incursions, industry, insurance, killmails, location, and loyalty operations.
- [x] 3.5 Review and accept names for mail, market, meta, military-campaigns, paragon-hub, and planetary-interaction operations.
- [x] 3.6 Review and accept names for routes, search, skills, sovereignty, status, structures, universe, user-interface, wallet, and wars operations.
- [x] 3.7 Audit all accepted names together for consistent verbs, singular/plural terminology, actor and visibility qualifiers, acronym casing, collision resolution, and absence of redundant domain or identifier tokens.
- [x] 3.8 Review any proposed domain reassignment explicitly and either reject it or update its class name, filename, package export, build entry, documentation index, and case-insensitive collision checks as one change. No domain reassignment was accepted.

## 4. Propagate the Accepted Catalog

- [x] 4.1 Regenerate every domain client and metadata view with only accepted method names and stable-operation-ID-keyed options interfaces.
- [x] 4.2 Update operation manifests and search documents so stable IDs and curated facade names remain separately searchable and serializable.
- [x] 4.3 Regenerate domain indexes, operation references, snippets, standalone examples, and representative examples with the curated methods.
- [x] 4.4 Update generated exact-signature, operation-coverage, documentation, example, and runtime tests to consume the one resolved facade mapping.
- [x] 4.5 Update README and changelog examples to use the curated API and explain that stable operation IDs remain unchanged for generic execution.
- [x] 4.6 Add invariance tests proving HTTP methods, paths, parameter placement, schemas, authentication, safety classification, return shapes, and stable operation IDs are unchanged by facade renaming.

## 5. Integrate the Standalone Domain Change

- [x] 5.1 Apply or regenerate `make-domain-subpaths-standalone` against the accepted facade catalog instead of manually merging generated client or documentation output.
- [x] 5.2 Verify every standalone factory, abstract domain contract, internal binder, aggregate domain property, and graph assertion uses the curated methods and stable-operation-ID-keyed options types.
- [x] 5.3 Add installed-package type checks that accept representative curated methods and stable-operation-ID-keyed options types while rejecting replaced raw transliterations.
- [x] 5.4 Add installed runtime parity checks showing a curated domain call and the matching stable-ID generic call reach the same descriptor and request.

## 6. Validate the Corrected Facade

- [x] 6.1 Run clean generation twice and verify the catalog, report, clients, manifests, search data, docs, examples, tests, accounting, and provenance are reproducible with no diff.
- [x] 6.2 Run formatting, type-aware linting, TypeScript checks, all unit and generated tests, example compilation, build, publint, ATTW, installed-package smoke tests, and package inspection.
- [x] 6.3 Inspect the packed declarations and runtime exports to confirm all 233 operations have one curated facade method, no raw compatibility aliases remain, and Zod stays external.
- [x] 6.4 Verify the complete CI matrix passes on supported Ubuntu and Windows runners with both release-blocking changes applied.
- [x] 6.5 Confirm no npm publication or release-tag mutation occurs during implementation and report the existing `v2.0.0` tag as stale for separate release handling.

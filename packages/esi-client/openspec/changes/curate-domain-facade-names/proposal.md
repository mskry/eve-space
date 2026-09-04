## Why

All 233 generated domain methods currently expose mechanical lower-camel-case transliterations of their stable OpenAPI operation IDs, producing repetitive calls such as `client.character.getCharactersCharacterIdAgentsResearch(characterId)` instead of a deliberate SDK facade. Because 2.0.0 is still unpublished, this is the last low-cost opportunity to establish concise, consistent method names before consumers depend on them.

## What Changes

- Replace the empty exception-style naming override file with a complete reviewed facade-name catalog covering every normalized operation.
- Establish naming conventions that treat the domain and positional identifiers as context, use consistent action verbs, preserve meaningful scope qualifiers, and normalize awkward upstream compounds and acronyms.
- Require every generated operation to have exactly one reviewed domain and method mapping; fail generation on missing, stale, duplicate, colliding, reserved, or stylistically invalid names.
- Keep stable OpenAPI operation IDs unchanged for generic execution, schemas, descriptors, diagnostics, drift accounting, and operation discovery identity.
- Propagate curated names deterministically through domain clients, operation manifests, search results, documentation, examples, and generated tests while keeping exported option type names keyed to stable operation IDs.
- Add a reviewable naming report that pairs each stable operation ID, HTTP route, parameters, summary, and accepted facade name.
- **BREAKING**: Remove the raw transliterated domain method names in favor of curated facade names. Exported option interfaces use stable-operation-ID names consistent with generated input, output, schema, and descriptor symbols. No compatibility aliases are added because 2.0.0 has not been published.
- Keep generated documentation, examples, and naming review reports in the repository and documentation site; only runtime and declaration changes enter the npm tarball.

## Capabilities

### New Capabilities
- `curated-domain-facade`: Complete reviewed naming and stability requirements for the generated domain-oriented SDK surface.

### Modified Capabilities

None.

## Impact

- Affects the maintained facade naming configuration, operation metadata validation, domain client generation, operation manifests, search results, generated documentation, examples, tests, and provenance.
- Changes every or nearly every generated domain method from its raw operation-ID transliteration to a curated name while retaining stable IDs for `callOperation`.
- Requires coordinated regeneration with `make-domain-subpaths-standalone`; both changes consume the same resolved facade metadata and must pass together before release.
- Adds no runtime dependency and does not alter transport, configuration, authentication, validation, metadata, mutation safety, or error behavior.
- Invalidates the current unpublished 2.0.0 release candidate and documentation until the reviewed catalog and regenerated package pass validation.

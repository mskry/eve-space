## Why

The generated domain subpaths resolve, but consumers cannot construct a domain client without first importing and instantiating the aggregate root client because domain constructors require a non-exported configuration class. Their size budgets also measure only facade files while each domain transitively loads global operation-schema runtime and declaration chunks, so the package does not deliver the standalone, narrow domain imports promised for the 2.0.0 SDK.

## What Changes

- Add a generated, options-based factory to every domain subpath so consumers can construct and invoke one domain without importing the package root or handling internal configuration objects.
- Generate domain-local operation schema and type modules so a domain client does not depend on the global operation-schema module.
- Preserve aggregate root, schema, and operation-discovery entries as convenience surfaces assembled from the domain-local artifacts.
- Replace direct-entry byte budgets with transitive runtime and declaration graph budgets for every public code entry.
- Add installed-package tests that construct and invoke representative domain factories and prove their resolved graphs exclude the root client, global registry, and unrelated domains.
- Regenerate domain documentation and examples to demonstrate standalone subpath use.
- **BREAKING**: Define factories, rather than direct domain-class construction with internal configuration, as the supported standalone domain construction API. Existing root `EsiClient` behavior remains supported.
- Keep generated documentation and examples in the repository and documentation site; do not add them to the npm tarball.

## Capabilities

### New Capabilities
- `modular-domain-clients`: Standalone domain construction, invocation, and isolation requirements for generated domain subpaths.

### Modified Capabilities
- `modern-library-build`: Measure and enforce each public entry's transitive runtime and declaration footprint instead of only its direct export-target files.

## Impact

- Affects generated domain clients, schema emitters, descriptor imports, client assembly, generated documentation, examples, and generation provenance.
- Affects tsdown chunking, package inspection, package budget baselines, installed-package smoke tests, and type tests.
- Adds generated factory exports to every `@evespace/esi-client/domains/*` entry while retaining `EsiClient` as the aggregate convenience API.
- Does not add a runtime dependency; Zod remains an external required peer.
- Invalidates the current unpublished 2.0.0 release candidate and its package measurements until the corrected artifacts pass validation.

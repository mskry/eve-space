## Purpose

Provide a deliberately named domain API whose concise, stable methods use domain and parameter context instead of exposing mechanical OpenAPI operation-ID transliterations.

## ADDED Requirements

### Requirement: Complete reviewed facade catalog
Every operation in the normalized ESI specification SHALL have exactly one reviewed facade domain and method name before client generation succeeds.

#### Scenario: Current specification coverage
- **WHEN** generation validates the pinned specification containing 233 operations
- **THEN** the reviewed facade catalog contains exactly one current entry for each stable operation ID

#### Scenario: New upstream operation
- **WHEN** a refreshed specification contains an operation without a reviewed facade entry
- **THEN** generation fails instead of publishing a mechanically derived public method name

#### Scenario: Stale catalog entry
- **WHEN** the facade catalog references an operation ID absent from the normalized specification
- **THEN** generation fails and identifies the stale entry

### Requirement: Contextual domain method names
Facade method names SHALL treat the selected domain and positional identifiers as context, SHALL use concise lower-camel-case action and resource terminology, and SHALL retain only qualifiers needed to distinguish operations within that domain.

#### Scenario: Character research operation
- **WHEN** the character domain exposes the operation identified by `GetCharactersCharacterIdAgentsResearch`
- **THEN** its method name does not repeat `characters`, `characterId`, or the HTTP operation-ID prefix
- **THEN** the resulting call reads as a concise character-domain action such as `client.character.agentsResearch(characterId)`

#### Scenario: Multiple caller scopes in one domain
- **WHEN** one domain contains otherwise similar character, corporation, and public operations
- **THEN** their curated names retain concise scope qualifiers sufficient to distinguish those operations

#### Scenario: Awkward upstream compound
- **WHEN** an operation ID contains a closed compound or acronym spelling such as `Corporationhistory`, `Skillqueue`, or `Openwindow`
- **THEN** the facade uses reviewed human-readable terminology rather than preserving the upstream spelling artifact

### Requirement: Unique and safe facade surface
Each reviewed domain and method pair SHALL identify exactly one operation and SHALL not collide with generated helpers, client members, language-reserved identifiers, package subpaths, or another facade name under case-sensitive or case-insensitive package constraints.

#### Scenario: Method collision
- **WHEN** two reviewed entries resolve to the same domain and method pair
- **THEN** generation fails and identifies both stable operation IDs

#### Scenario: Generated helper collision
- **WHEN** a reviewed method uses a generated member name such as `withMetadata` or `constructor`
- **THEN** generation rejects the name before replacing generated output

#### Scenario: Domain package collision
- **WHEN** two reviewed domains would emit the same package path under case-insensitive filesystem rules
- **THEN** generation fails before build metadata or package exports are changed

### Requirement: Stable operation identity
Curated facade names SHALL not change stable operation IDs used by generic execution, schema exports, operation descriptions, errors, drift accounting, or serialized operation identity.

#### Scenario: Curated and generic parity
- **WHEN** a curated domain method and `EsiClient.callOperation` target the same operation with equivalent arguments
- **THEN** both retain the same stable operation ID and transport behavior

#### Scenario: Facade rename review
- **WHEN** a reviewed facade method is renamed while its upstream operation remains unchanged
- **THEN** generated documentation and manifests reflect the new facade name while stable generic execution continues to use the unchanged operation ID

### Requirement: Consistent generated public surface
The accepted facade catalog SHALL drive domain clients, operation manifests, search results, documentation, examples, and generated type and contract tests from one deterministic mapping. Exported option interfaces SHALL remain keyed to stable operation IDs.

#### Scenario: Accepted method propagation
- **WHEN** a reviewed facade name changes
- **THEN** clean generation updates every generated runtime, declaration, manifest, search, documentation, example, and test reference to that name
- **THEN** a second generation produces no further diff

#### Scenario: Naming review output
- **WHEN** maintainers review the facade catalog
- **THEN** they can inspect each stable operation's HTTP route, parameters, summary, current generated name, and accepted domain and method together

#### Scenario: Contextual method and flat option namespaces
- **WHEN** concise methods in different domains use the same contextual method name
- **THEN** each operation's exported options interface uses its globally unique `<StableOperationId>Options` name
- **THEN** the options name visibly matches that operation's input, output, schemas, descriptor, manifest, and discovery identity

### Requirement: No unpublished compatibility aliases
The 2.0.0 package SHALL expose only the reviewed facade method for each operation and SHALL not retain the unpublished raw operation-ID transliteration as an alias.

#### Scenario: Packed domain declaration
- **WHEN** an installed consumer resolves a domain declaration from the corrected 2.0.0 candidate
- **THEN** the reviewed method and its stable-operation-ID-keyed options type are present
- **THEN** the replaced raw method is absent

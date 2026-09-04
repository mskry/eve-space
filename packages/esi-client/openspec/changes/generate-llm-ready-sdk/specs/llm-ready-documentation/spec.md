## Purpose

Generate concise, progressively discoverable, and continuously verified documentation that helps humans and LLMs select correct ESI operations and produce compilable usage code.

## ADDED Requirements

### Requirement: Compact LLM entry document
The project SHALL publish an `llms.txt` document at the documentation-site root and maintain the same generated document at the repository root. It SHALL contain installation, ESM import, client construction, authentication, validation, response metadata, pagination, error handling, safety guidance, and links to domain and operation references without embedding the complete API reference.

#### Scenario: Initial package discovery
- **WHEN** a coding agent reads only `llms.txt`
- **THEN** it can identify the supported import patterns and locate the appropriate domain or operation documentation

### Requirement: Domain and operation references
The documentation generator SHALL produce one domain index and one focused reference section for every supported operation using the generated operation registry as its source.

#### Scenario: Operation reference generation
- **WHEN** documentation is generated for an operation
- **THEN** its reference includes stable identifier, domain-method and generic-execution usage, parameters, result type, authentication scopes, pagination behavior, cache behavior, and structured errors

### Requirement: Compilable examples
The documentation system SHALL generate representative public, authenticated, paginated, metadata, validation-error, and mutation-safety examples for the repository and documentation site and SHALL compile every generated TypeScript example in CI.

#### Scenario: Generated API changes
- **WHEN** regeneration changes a method signature or type
- **THEN** CI fails if any generated example no longer type-checks

### Requirement: Documentation consistency
Generated documentation SHALL use the same normalized operation model as generated clients, schemas, and operation metadata, and CI SHALL reject stale generated documentation.

#### Scenario: Documentation is not regenerated
- **WHEN** operation metadata changes without corresponding documentation updates
- **THEN** the reproducibility check fails

### Requirement: Progressive disclosure
Documentation SHALL be partitioned so a consumer can retrieve package, domain, or individual operation guidance independently without loading a monolithic declaration or full-reference document.

#### Scenario: Retrieve one domain
- **WHEN** a consumer needs only character operations
- **THEN** the character domain document links its operations and shared concepts without including unrelated domain references

### Requirement: Safe example content
Generated documentation and examples SHALL use placeholders for credentials and identifiers, SHALL avoid logging access tokens, and SHALL label mutation examples as requiring explicit authorization and confirmation.

#### Scenario: Authenticated example generation
- **WHEN** an authenticated example is generated
- **THEN** it obtains a token from configuration or an environment placeholder
- **THEN** the example never embeds or prints a real credential

### Requirement: Documentation distribution boundary
Generated operation references, domain pages, examples, and `llms.txt` SHALL be repository and documentation-site artifacts and SHALL be excluded from the npm tarball. The npm tarball SHALL contain only runtime and declaration output plus mandatory package metadata, README, and license files.

#### Scenario: npm package inspection
- **WHEN** the package tarball is inspected
- **THEN** generated operation pages, domain documentation, examples, and `llms.txt` are absent
- **THEN** runtime operation metadata remains available through documented package exports

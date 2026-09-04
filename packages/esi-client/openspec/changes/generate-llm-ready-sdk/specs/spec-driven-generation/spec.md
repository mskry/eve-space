## Purpose

Provide a reproducible pipeline that derives one coherent SDK surface and every supporting artifact from one traceable and corrected ESI OpenAPI input without overwriting maintained source code.

## ADDED Requirements

### Requirement: Canonical specification input
The generation system SHALL resolve an explicit ESI compatibility date, retain the normalized specification input, and record its compatibility date and content hash in generated provenance metadata.

#### Scenario: Generation from an explicit compatibility date
- **WHEN** generation is requested with a valid compatibility date
- **THEN** every generated artifact is derived from the specification resolved for that date
- **THEN** the generated provenance identifies the date and specification hash

#### Scenario: Specification retrieval fails
- **WHEN** the requested specification cannot be retrieved or parsed
- **THEN** generation fails before replacing the previously generated artifact tree

### Requirement: Auditable specification corrections
The generation system SHALL apply version-controlled corrections to the canonical specification before producing clients, schemas, metadata, documentation, examples, or tests.

#### Scenario: Corrected operation generation
- **WHEN** a correction changes an operation parameter location or shape
- **THEN** all generated artifacts represent the corrected operation consistently
- **THEN** the correction remains independently reviewable from generated output

### Requirement: Isolated deterministic output
The generation system SHALL replace only declared generated directories and SHALL produce byte-equivalent output for equivalent generator versions, configuration, corrected specification content, and source compatibility date.

#### Scenario: Regeneration with unchanged inputs
- **WHEN** generation is run twice with unchanged inputs and tool versions
- **THEN** the second run produces no source-controlled differences

#### Scenario: Maintained source is present
- **WHEN** generation replaces generated artifacts
- **THEN** maintained runtime, facade, configuration, and test-support source outside generated directories remains unchanged

### Requirement: Complete operation accounting
The generation system SHALL account for every operation in the corrected specification as generated or explicitly excluded with a machine-readable reason.

#### Scenario: Supported operation is encountered
- **WHEN** the corrected specification contains a supported operation
- **THEN** the pipeline generates its domain method, generic operation descriptor, runtime schemas, metadata, documentation, usage snippet, and applicable contract tests

#### Scenario: Operation cannot be generated
- **WHEN** an operation uses an unsupported construct
- **THEN** generation fails unless an explicit reviewed exclusion records the operation and reason

### Requirement: Specification drift reporting
The system SHALL compare the pinned specification with the latest available ESI specification and report added, removed, and changed operations, fields, parameters, response shapes, and authentication scopes without silently updating the pinned input.

#### Scenario: Upstream specification changes
- **WHEN** scheduled drift detection finds a difference from the pinned specification
- **THEN** it emits a structured change report suitable for review and regeneration
- **THEN** the published client remains based on the pinned specification until the change is accepted

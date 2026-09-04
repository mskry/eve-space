## MODIFIED Requirements

### Requirement: Lean published artifact
The packed package SHALL omit JavaScript and declaration source maps, SHALL record compressed size, unpacked size, total JavaScript size, total declaration size, and file count for regression comparison, and SHALL record the unique transitive internal JavaScript and declaration footprint of every public code entry.

#### Scenario: Package inspection
- **WHEN** the package is packed from a clean build
- **THEN** no source map is included
- **THEN** all aggregate package measurements are produced
- **THEN** each public code entry records its complete reachable internal runtime and declaration files and their unique total bytes

#### Scenario: Transitive public-entry growth
- **WHEN** a public entry's direct facade remains small but a reachable internal runtime or declaration artifact causes its transitive footprint to exceed the accepted budget
- **THEN** package validation fails before publication

#### Scenario: Invalid internal package edge
- **WHEN** a public entry's runtime or declaration graph references a missing packed file or an undeclared external runtime package
- **THEN** package validation fails before publication

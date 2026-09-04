## Why

The current generated prototype exposes repetitive OpenAPI mechanics, compile-time-only types, monolithic declarations, and minimal documentation that make it difficult for developers and LLMs to discover and use safely. Because the project has no consumers yet, it can replace that prototype with one coherent, validated SDK rather than preserve duplicate compatibility surfaces.

## What Changes

- Replace the destructive whole-`src` regeneration flow with a pinned, reproducible pipeline that writes generated artifacts under a dedicated generated source tree and applies explicit ESI specification corrections before generation.
- **BREAKING** Remove the OpenAPI Generator `typescript-fetch` classes, model converters, repetitive request interfaces, and raw compatibility exports instead of maintaining a second client surface.
- Generate one SDK from a normalized operation model, including Zod request and response schemas, schema-inferred TypeScript types, domain clients, operation metadata, documentation, examples, and contract tests.
- Add an `EsiClient` with consistent domain methods and client-level compatibility date, authentication, language, base URL, fetch, validation, metadata, and generic-mutation safety behavior.
- Generate a machine-readable operation registry containing identifiers, paths, methods, parameters, authentication scopes, pagination, cache metadata, and runtime schemas.
- Add safe operation search, description, and execution primitives for LLM agents, with mutations disabled by default and credentials excluded from metadata and errors.
- Return bare validated data from normal domain calls, expose complete response headers and normalized pagination/cache/error-limit details through metadata-enabled domain calls, and return metadata envelopes from generic execution.
- Generate compact domain and operation documentation, a documentation-site and repository `llms.txt`, and compilable examples from the operation registry while excluding generated documentation from the npm tarball.
- Generate request-construction, schema-validation, and type-level tests; add reproducibility, specification-drift, package-size, and documentation checks to CI.
- Require Zod 4 as a peer dependency and use generated Zod schemas as the public runtime contract and type source.
- Do not add an MCP server in this change; the generated registry and safe operation APIs will form the reusable foundation for a later adapter.

## Capabilities

### New Capabilities
- `spec-driven-generation`: Reproducible generation from a pinned, corrected ESI OpenAPI document into one client, schema, type, metadata, documentation, example, and test surface.
- `runtime-schema-validation`: Generated Zod schemas, configurable request and response validation, stable validation errors, and public schema exports.
- `ergonomic-esi-client`: The primary consistent domain client, generic operation escape hatch, modern ESM package entries, and centralized shared ESI configuration.
- `llm-operation-discovery`: Machine-readable operation metadata plus bounded search, description, and safety-controlled execution APIs for tool-using LLMs.
- `llm-ready-documentation`: Generated progressive-disclosure documentation and compilable examples designed for accurate retrieval and code generation.

### Modified Capabilities

None. This project has no existing OpenSpec capability specifications.

## Impact

- OpenAPI Generator, generated model converters, and the current low-level API surface will be removed before the first supported release.
- Generated source layout will change substantially, while maintained generation, transport, configuration, and error code will remain outside the generated tree.
- The public package will expose `EsiClient`, schemas, operation discovery, and domain subpaths as its only supported API surface.
- Zod 4 will become the only required runtime peer dependency and the single source for public runtime validation and inferred operation types.
- This change requires the `modernize-build-foundation` prerequisite and extends its tsdown entries, dependency policy, declaration isolation, package validation, and size gates rather than reimplementing them.
- Build, test, and CI configuration will gain generation reproducibility, contract, documentation, and packaging checks.
- Release automation will report ESI compatibility date, source specification hash, and detected API changes.
- The breaking SDK surface will be published as `2.0.0`; npm currently exposes `1.0.1`, and the local `2.0.0` version remains unpublished and reserved for this release.

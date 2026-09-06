import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';

import { createProvenanceHeader, type ArtifactProvenance } from './artifacts.ts';
import {
  renderOperationSnippets,
  renderStandaloneExampleDocumentation,
  type OperationSnippets,
} from './examples-emitter.ts';
import { createSerializableOperationManifest } from './operation-registry.ts';
import type {
  SerializableOperationManifest,
  SerializableOperationManifestEntry,
} from './operation-registry.ts';
import type {
  EmitterContext,
  GeneratedOutputClaim,
  GeneratedOutputEmitter,
} from './generation-contracts.ts';
import { generatedTargetFor, normalizeGeneratedPath } from './paths.ts';
import { domainFileName, facadeParameterName } from './internal/facade-naming.ts';
import { compareText } from './internal/text.ts';

export interface RenderedGeneratedDocumentation {
  readonly generatedFiles: ReadonlyMap<string, string>;
  readonly llmsText: string;
}

interface DocumentationDomain {
  readonly domain: string;
  readonly fileName: string;
  readonly operations: readonly SerializableOperationManifestEntry[];
}

const documentationTargets = Object.freeze({
  generated: generatedTargetFor('documentation').path,
  llms: Object.freeze([
    generatedTargetFor('repositoryLlms').path,
    generatedTargetFor('siteLlms').path,
  ]),
});
const conceptPages: readonly (readonly [string, string])[] = Object.freeze([
  ['installation', 'Installation'],
  ['client', 'Client configuration'],
  ['auth', 'Authentication'],
  ['validation', 'Validation'],
  ['metadata-pagination', 'Metadata and pagination'],
  ['errors', 'Structured errors'],
  ['mutation-safety', 'Mutation safety'],
]);
const safeSegmentPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u;

export function renderGeneratedDocumentation(
  manifest: SerializableOperationManifest,
  provenance: ArtifactProvenance,
  namingReviewReport: string,
): RenderedGeneratedDocumentation {
  validateManifest(manifest, provenance);
  if (typeof namingReviewReport !== 'string' || namingReviewReport.length === 0) {
    throw new TypeError('Generated naming review report must be a non-empty string');
  }
  const operations = [...manifest.operations].toSorted((left, right) =>
    compareText(left.operationId, right.operationId),
  );
  const domains = indexDomains(operations);
  const generatedFiles = new Map<string, string>();
  const snippets = renderOperationSnippets(manifest);

  generatedFiles.set('facade-naming-review.md', namingReviewReport);

  for (const [slug, title] of conceptPages) {
    generatedFiles.set(`concepts/${slug}.md`, renderConceptPage(slug, title, provenance));
  }
  for (const domain of domains) {
    const firstOperation = domain.operations[0];
    const domainSnippets =
      firstOperation === undefined ? undefined : snippets.get(firstOperation.operationId);
    if (domainSnippets === undefined) {
      throw new Error(`Missing generated domain snippets: ${domain.domain}`);
    }
    generatedFiles.set(
      `domains/${domain.fileName}.md`,
      renderDomainPage(domain, domainSnippets, provenance),
    );
  }
  for (const [path, content] of renderStandaloneExampleDocumentation(provenance)) {
    generatedFiles.set(path, content);
  }
  for (const operation of operations) {
    const operationSnippets = snippets.get(operation.operationId);
    if (operationSnippets === undefined) {
      throw new Error(`Missing generated operation snippets: ${operation.operationId}`);
    }
    generatedFiles.set(
      `operations/${operationFileName(operation.operationId)}.md`,
      renderOperationPage(operation, operationSnippets, provenance),
    );
  }

  return Object.freeze({
    generatedFiles,
    llmsText: renderLlmsText(domains, operations, provenance),
  });
}

export async function emitGeneratedDocumentation(
  context: EmitterContext,
): Promise<readonly GeneratedOutputClaim[]> {
  if (context === null || typeof context !== 'object') {
    throw new TypeError('Documentation emitter context must be an object');
  }
  const manifest = createSerializableOperationManifest(
    context.normalizedModel,
    context.operationMetadata,
    context.provenance,
  );
  const rendered = renderGeneratedDocumentation(
    manifest,
    context.provenance,
    context.namingReviewReport,
  );
  const generatedDirectory = context.outputPath(documentationTargets.generated);
  await mkdir(generatedDirectory, { recursive: true });

  const writes: Promise<void>[] = [];
  for (const [relativePath, content] of rendered.generatedFiles) {
    const outputPath = join(generatedDirectory, validateRelativeDocumentationPath(relativePath));
    writes.push(
      mkdir(dirname(outputPath), { recursive: true }).then(() => writeFile(outputPath, content)),
    );
  }
  for (const target of documentationTargets.llms) {
    const outputPath = context.outputPath(target);
    writes.push(
      mkdir(dirname(outputPath), { recursive: true }).then(() =>
        writeFile(outputPath, rendered.llmsText),
      ),
    );
  }
  await Promise.all(writes);

  return [
    { target: documentationTargets.generated, kind: 'directory' },
    ...documentationTargets.llms.map((target) => ({ target, kind: 'file' as const })),
  ];
}

export const generatedDocumentationEmitter: GeneratedOutputEmitter = Object.freeze({
  name: 'generated-documentation',
  emit: emitGeneratedDocumentation,
});

function renderLlmsText(
  domains: readonly DocumentationDomain[],
  operations: readonly SerializableOperationManifestEntry[],
  provenance: ArtifactProvenance,
): string {
  const domainLinks = domains
    .map(
      ({ domain, fileName, operations: domainOperations }) =>
        `- [${markdownText(domain)}](/docs/generated/domains/${fileName}.md) (${domainOperations.length} ${pluralizeOperations(domainOperations.length)})`,
    )
    .join('\n');
  const concepts = conceptPages
    .map(([slug, title]) => `- [${title}](/docs/generated/concepts/${slug}.md)`)
    .join('\n');
  const firstOperation = operations[0];
  const operationLink =
    firstOperation === undefined
      ? ''
      : ` See the [operation reference format](/docs/generated/operations/${operationFileName(firstOperation.operationId)}.md); every operation is linked from its domain index.`;
  return markdownDocument(
    provenance,
    `# @evespace/esi-client

> ESM-only TypeScript SDK for EVE Online ESI. Requires Node.js 24.20+ and Zod 4.

Use narrow domain, type, Zod, and operation imports when possible. The generated references are derived from the pinned ESI registry; this entry document intentionally does not embed the complete API.

## Start

${concepts}
- [Standalone examples](/docs/generated/examples/index.md)

## Imports

- Client: \`import { EsiClient } from '@evespace/esi-client';\`
- Types: \`@evespace/esi-client/types\`
- Zod schemas: \`@evespace/esi-client/zod\`
- Discovery and generic execution: \`@evespace/esi-client/operations\`
- One domain: \`@evespace/esi-client/domains/<domain>\`

## API by domain

${domainLinks}

## Operation references

Use \`searchOperations\` to find stable IDs, \`describeOperation\` to retrieve serializable contracts, and \`client.callOperation\` for validated single-call execution.${operationLink}

Generic mutations are disabled by default and require both client enablement and per-call confirmation. Typed mutation methods express caller intent and do not use the generic gates. Never embed or log credentials.`,
  );
}

function renderConceptPage(slug: string, title: string, provenance: ArtifactProvenance): string {
  const bodies: Record<string, string> = {
    installation: `Install the SDK and its required Zod 4 peer with your package manager:

\`pnpm add @evespace/esi-client zod\`

The package is ESM-only and requires Node.js 24.20 or newer. Import \`EsiClient\` from the package root, or use a documented domain, \`types\`, \`zod\`, or \`operations\` subpath for a narrower dependency surface.`,
    client: `Create a public client with \`new EsiClient()\`. The pinned compatibility date, standard ESI base URL, English language, response validation, and the global \`fetch\` implementation are defaults.

Constructor options include \`baseUrl\`, \`compatibilityDate\`, \`language\`, \`token\` or \`tokenProvider\`, \`fetch\`, \`validateResponses\`, \`validateRequests\`, and \`allowGenericMutations\`. Configuration is immutable. Operation options can override the compatibility date where the registry declares support.`,
    auth: `Public operations need no authentication. Authenticated operation references list every required OAuth scope.

Configure either \`token\` or an asynchronous \`tokenProvider\`; do not configure both. Token providers are resolved only for authenticated requests. Credentials and authorization headers are excluded from the serializable registry, response metadata, and structured errors.`,
    validation: `Successful JSON responses are validated by generated Zod 4 schemas by default. Natural TypeScript exports are available from \`@evespace/esi-client/types\`; matching natural Zod exports are available from \`@evespace/esi-client/zod\`. Known object fields are checked while unknown response fields are preserved for forward compatibility. Date and date-time values remain JSON strings.

Typed request validation is opt-in with \`validateRequests: true\`. Generic \`callOperation\` arguments are always validated before network activity. Response validation can be disabled explicitly with \`validateResponses: false\`.`,
    'metadata-pagination': `Normal domain methods return validated bare data. Call \`client.<domain>.withMetadata().<method>(...)\` for an \`EsiResponse<T>\` envelope containing status, all response headers, request ID, pagination, cache validators, and ESI error-limit metadata. Generic execution always returns this envelope.

Generic execution performs exactly one request. For offset pagination, pass the documented page parameter and inspect \`meta.pagination.pages\`. For cursor pagination, pass the documented cursor and inspect the cursor metadata or response headers. The SDK does not automatically traverse pages.`,
    errors: `SDK failures extend \`EsiError\` and expose a stable \`code\`, \`operationId\`, message, and an allowlisted \`toJSON()\` result. Validation errors add \`direction\` and structured \`issues\`. Authentication failures add required scopes. HTTP and parse failures add status and response metadata; HTTP failures may include a bounded parsed ESI body.

Handle errors by class or stable code. Error serialization excludes credentials, authorization headers, token-provider values, and raw authenticated request bodies.`,
    'mutation-safety': `Named typed mutation methods are explicit caller intent and execute after normal validation and authentication checks.

Generic mutation execution is denied unless the client is constructed with \`allowGenericMutations: true\` and that call passes \`{ confirmMutation: true }\`. Missing either gate fails before network activity. Reviewed read-like POST operations are classified as reads in each operation reference and do not require generic mutation confirmation.`,
  };
  const body = bodies[slug];
  if (body === undefined) throw new Error(`Missing documentation concept body: ${slug}`);
  return markdownDocument(
    provenance,
    `# ${title}

${body}

## Related

- [LLM entry document](../../../llms.txt)
- [Structured errors](errors.md)
- [Mutation safety](mutation-safety.md)`,
  );
}

function renderDomainPage(
  domain: DocumentationDomain,
  snippets: OperationSnippets,
  provenance: ArtifactProvenance,
): string {
  const rows = domain.operations
    .map((operation) => {
      const auth = operation.authentication.required ? 'required' : 'public';
      return `| [\`${operation.operationId}\`](../operations/${operationFileName(operation.operationId)}.md) | \`${operation.http.method}\` | \`${operation.facade.method}\` | ${auth} | ${operation.pagination.kind} | ${operation.classification} | ${tableText(operation.summary ?? 'No summary.')} |`;
    })
    .join('\n');
  return markdownDocument(
    provenance,
    `# ${markdownText(domain.domain)} domain

- Client property: \`client.${domain.domain}\`
- Package subpath: \`@evespace/esi-client/domains/${domain.fileName}\`
- Operations: ${domain.operations.length}

| Stable ID | HTTP | Domain method | Auth | Pagination | Safety | Summary |
| --- | --- | --- | --- | --- | --- | --- |
${rows}

## Standalone domain factory

Use the domain subpath when this is the only ESI domain the module needs:

\`\`\`ts
${snippets.standaloneDomainMethod.trim()}
\`\`\`

## Aggregate client

Use the root client when one configuration should serve multiple domains:

\`\`\`ts
${snippets.domainMethod.trim()}
\`\`\`

## Shared concepts

- [Client configuration](../concepts/client.md)
- [Authentication](../concepts/auth.md)
- [Validation](../concepts/validation.md)
- [Metadata and pagination](../concepts/metadata-pagination.md)
- [Structured errors](../concepts/errors.md)
- [Mutation safety](../concepts/mutation-safety.md)`,
  );
}

function renderOperationPage(
  operation: SerializableOperationManifestEntry,
  snippets: OperationSnippets,
  provenance: ArtifactProvenance,
): string {
  let authentication = 'Public; no access token is required.';
  if (operation.authentication.required) {
    authentication = 'Required; no OAuth scopes are declared by the operation.';
    if (operation.authentication.scopes.length > 0) {
      const scopes = operation.authentication.scopes
        .map((scope) => `\`${markdownText(scope)}\``)
        .join(', ');
      authentication = `Required scopes: ${scopes}.`;
    }
  }
  return markdownDocument(
    provenance,
    `# ${operation.operationId}

${markdownText(operation.summary ?? 'No summary is available for this operation.')}

- Stable ID: \`${operation.operationId}\`
- HTTP: \`${operation.http.method} ${markdownText(operation.http.path)}\`
- Domain method: \`client.${operation.facade.domain}.${operation.facade.method}(${domainMethodArguments(operation)})\`
- Generic call: \`client.callOperation("${operation.operationId}", arguments, callOptions?)\`
- Domain import: \`@evespace/esi-client/domains/${domainFile(operation.facade.domain)}\`
- Domain index: [${markdownText(operation.facade.domain)}](../domains/${domainFile(operation.facade.domain)}.md)

Required path identifiers are positional in the domain method. Other request values and an available compatibility-date override are fields in its final options object. Generic arguments use \`path\`, \`query\`, \`headers\`, and \`body\` groups matching the parameter table.

## Standalone domain-factory snippet

\`\`\`ts
${snippets.standaloneDomainMethod.trim()}
\`\`\`

## Aggregate EsiClient snippet

\`\`\`ts
${snippets.domainMethod.trim()}
\`\`\`

## Generic-execution snippet

\`\`\`ts
${snippets.genericExecution.trim()}
\`\`\`

## Parameters

${renderParameters(operation)}

## Result and schemas

- Request type: \`${operation.requestType.module}\` export \`${operation.requestType.export}\`
- Request-layer schemas: ${renderRequestSchemas(operation)}
- Response type: \`${operation.responseType.module}\` export \`${operation.responseType.export}\`
- Domain result: bare validated success data; a no-content response resolves to \`undefined\`.
- Metadata result: \`client.${operation.facade.domain}.withMetadata().${operation.facade.method}(...)\` returns \`EsiResponse<T>\`.
- Generic result: \`callOperation\` returns one serializable \`EsiResponse<T>\` envelope.

${renderResponses(operation)}

## Authentication

${authentication}

## Pagination and cache

${renderPagination(operation)}

${renderCache(operation)}

## Mutation safety

${renderSafety(operation)}

## Structured errors

${renderErrors(operation)}

Error serialization is allowlisted and excludes credentials and authorization headers.

## Standalone examples

${snippets.standaloneExamples.map((fileName) => `- [${standaloneExampleTitle(fileName)}](../examples/${fileName})`).join('\n')}

## Shared concepts

- [Authentication](../concepts/auth.md)
- [Validation](../concepts/validation.md)
- [Metadata and pagination](../concepts/metadata-pagination.md)
- [Structured errors](../concepts/errors.md)
- [Mutation safety](../concepts/mutation-safety.md)`,
  );
}

function renderParameters(operation: SerializableOperationManifestEntry): string {
  const rows = operation.parameters.map(
    (parameter) =>
      `| ${tableText(parameter.name)} | ${parameter.placement} | ${parameter.required ? 'yes' : 'no'} | ${tableText(schemaSummary(parameter.schema))} | ${tableText(parameter.description ?? '')} |`,
  );
  if (operation.requestBody !== null) {
    const contentSchema =
      operation.requestBody.content
        .map(({ mediaType, schema }) => `${mediaType}: ${schemaSummary(schema)}`)
        .join('; ') || 'no content schema';
    rows.push(
      `| body | body | ${operation.requestBody.required ? 'yes' : 'no'} | ${tableText(contentSchema)} | ${tableText(operation.requestBody.description ?? '')} |`,
    );
  }
  if (rows.length === 0) return 'This operation has no caller-supplied parameters.';
  return `| Name | Placement | Required | Schema | Description |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}`;
}

function renderResponses(operation: SerializableOperationManifestEntry): string {
  const rows = operation.responses
    .map(
      (response) =>
        `| \`${response.status}\` | ${response.body} | \`${response.schema.module}\` | \`${response.schema.export}\` | ${tableText(response.description)} |`,
    )
    .join('\n');
  return `| Status | Body | Schema module | Schema export | Description |\n| --- | --- | --- | --- | --- |\n${rows}`;
}

function renderRequestSchemas(operation: SerializableOperationManifestEntry): string {
  if (operation.requestSchemas.length === 0) return 'none.';
  return `${operation.requestSchemas
    .map(
      ({ group, schema }) => `\`${group}\` uses \`${schema.module}\` export \`${schema.export}\``,
    )
    .join('; ')}.`;
}

function renderPagination(operation: SerializableOperationManifestEntry): string {
  if (operation.pagination.kind === 'none') {
    return 'Pagination: none declared. Generic execution still performs exactly one request.';
  }
  return `Pagination: \`${operation.pagination.kind}\`. Request parameters: ${codeList(operation.pagination.requestParameters)}. Response headers: ${codeList(operation.pagination.responseHeaders)}. Generic execution returns only the requested page or cursor response.`;
}

function renderCache(operation: SerializableOperationManifestEntry): string {
  const headers = codeList(operation.cache.responseHeaders);
  const extensionNames = Object.keys(operation.cache.extensions).toSorted(compareText);
  if (operation.cache.responseHeaders.length === 0 && extensionNames.length === 0) {
    return 'Cache behavior: no operation-specific cache metadata is declared. Metadata-enabled results still preserve all response headers.';
  }
  return `Cache response headers: ${headers}. Cache extension keys: ${codeList(extensionNames)}. Metadata-enabled and generic results expose normalized cache fields plus all original response headers.`;
}

function renderSafety(operation: SerializableOperationManifestEntry): string {
  if (operation.classification === 'read') {
    if (operation.safety.readLikeOverride !== null) {
      return `This operation is a reviewed read-like \`${operation.http.method}\` and does not use generic mutation gates. Review reason: ${markdownText(operation.safety.readLikeOverride.reason)}`;
    }
    return 'This operation is classified as a read and does not use generic mutation gates.';
  }
  return 'The named typed method expresses mutation intent. Generic execution requires both `allowGenericMutations: true` on the client and `{ confirmMutation: true }` on this call.';
}

function renderErrors(operation: SerializableOperationManifestEntry): string {
  const rows: [string, string, string][] = [
    [
      'EsiRequestValidationError',
      'ESI_REQUEST_VALIDATION_ERROR',
      'Invalid request arguments; generic calls always validate before network activity.',
    ],
    [
      'EsiResponseValidationError',
      'ESI_RESPONSE_VALIDATION_ERROR',
      'A successful response does not match the generated schema.',
    ],
    [
      'EsiHttpError',
      'ESI_HTTP_ERROR',
      'ESI returns a non-success status; includes status, metadata, and a bounded body when available.',
    ],
    [
      'EsiResponseParseError',
      'ESI_RESPONSE_PARSE_ERROR',
      'A successful JSON response cannot be parsed.',
    ],
  ];
  if (operation.authentication.required) {
    rows.push([
      'EsiAuthenticationRequiredError',
      'ESI_AUTHENTICATION_REQUIRED',
      'No credential is available; includes required scopes.',
    ]);
  }
  if (operation.classification === 'mutation') {
    rows.push(
      [
        'EsiGenericMutationDisabledError',
        'ESI_GENERIC_MUTATION_DISABLED',
        'Generic mutation enablement is absent.',
      ],
      [
        'EsiGenericMutationUnconfirmedError',
        'ESI_GENERIC_MUTATION_UNCONFIRMED',
        'Per-call generic mutation confirmation is absent.',
      ],
    );
  }
  const errorRows = rows
    .map(([name, code, behavior]) => `| \`${name}\` | \`${code}\` | ${behavior} |`)
    .join('\n');
  return `| Error | Code | Behavior |\n| --- | --- | --- |\n${errorRows}`;
}

function domainMethodArguments(operation: SerializableOperationManifestEntry): string {
  const pathParameters = new Map(
    operation.parameters
      .filter(({ placement }) => placement === 'path')
      .map((parameter) => [parameter.name, parameter]),
  );
  const signatureArguments: string[] = [];
  for (const match of operation.http.path.matchAll(/\{([^{}]+)\}/gu)) {
    const parameter = pathParameters.get(match[1]);
    if (parameter !== undefined) signatureArguments.push(facadeParameterName(parameter.name));
  }
  const nonPathParameters = operation.parameters.filter(({ placement }) => placement !== 'path');
  const hasOptions =
    nonPathParameters.length > 0 ||
    operation.requestBody !== null ||
    operation.transport.compatibilityDateOverride;
  if (hasOptions) {
    const optionsRequired =
      nonPathParameters.some((parameter) => parameter.required) ||
      operation.requestBody?.required === true;
    signatureArguments.push(optionsRequired ? 'options' : 'options?');
  }
  return signatureArguments.join(', ');
}

function schemaSummary(schema: unknown): string {
  if (schema === true) return 'any JSON value';
  if (schema === false) return 'no value';
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return 'JSON value';
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- typeof narrows to object, not an indexable record
  const record = schema as Record<string, unknown>;
  if (typeof record.$ref === 'string') return `reference ${record.$ref}`;
  if (Array.isArray(record.type)) return (record.type as readonly string[]).join(' | ');
  if (record.type === 'array') return `array<${schemaSummary(record.items)}>`;
  if (typeof record.type === 'string') {
    return typeof record.format === 'string' ? `${record.type} (${record.format})` : record.type;
  }
  if (Array.isArray(record.oneOf)) return 'oneOf';
  if (Array.isArray(record.anyOf)) return 'anyOf';
  if (Array.isArray(record.allOf)) return 'allOf';
  return 'JSON value';
}

function indexDomains(
  operations: readonly SerializableOperationManifestEntry[],
): DocumentationDomain[] {
  const byDomain = new Map<string, SerializableOperationManifestEntry[]>();
  const fileNames = new Map<string, string>();
  for (const operation of operations) {
    const domain = operation.facade.domain;
    const fileName = domainFile(domain);
    const fileKey = fileName.toLowerCase();
    const priorDomain = fileNames.get(fileKey);
    if (priorDomain !== undefined && priorDomain !== domain) {
      throw new Error(`Documentation domain path collision: ${priorDomain} and ${domain}`);
    }
    fileNames.set(fileKey, domain);
    const entries = byDomain.get(domain) ?? [];
    entries.push(operation);
    byDomain.set(domain, entries);
  }
  return [...byDomain]
    .toSorted(([left], [right]) => compareText(left, right))
    .map(([domain, entries]) =>
      Object.freeze({
        domain,
        fileName: domainFile(domain),
        operations: Object.freeze(
          entries.toSorted((left, right) => compareText(left.operationId, right.operationId)),
        ),
      }),
    );
}

function validateManifest(
  manifest: SerializableOperationManifest,
  provenance: ArtifactProvenance,
): void {
  // The leading underscore is part of the generated manifest's provenance contract.
  // oxlint-disable-next-line eslint/no-underscore-dangle
  const generatedProvenance = manifest?._generated;
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    manifest.schemaVersion !== 2 ||
    !Array.isArray(manifest.operations) ||
    generatedProvenance?.compatibilityDate !== provenance?.compatibilityDate ||
    generatedProvenance?.specificationSha256 !== provenance?.sha256
  ) {
    throw new Error('Invalid or mismatched serializable operation manifest');
  }
  const operationPaths = new Map<string, string>();
  for (const operation of manifest.operations) {
    if (
      operation === null ||
      typeof operation !== 'object' ||
      typeof operation.operationId !== 'string' ||
      typeof operation.facade?.domain !== 'string' ||
      typeof operation.facade?.method !== 'string'
    ) {
      throw new Error('Invalid serializable operation manifest entry');
    }
    const fileName = operationFileName(operation.operationId);
    const pathKey = fileName.toLowerCase();
    const priorId = operationPaths.get(pathKey);
    if (priorId !== undefined) {
      throw new Error(
        `Documentation operation path collision: ${priorId} and ${operation.operationId}`,
      );
    }
    operationPaths.set(pathKey, operation.operationId);
  }
}

function operationFileName(operationId: string): string {
  return safeFileSegment(operationId, 'operation ID');
}

function domainFile(domain: string): string {
  return safeFileSegment(domainFileName(domain), 'domain');
}

function safeFileSegment(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    !safeSegmentPattern.test(value) ||
    value === '.' ||
    value === '..'
  ) {
    throw new Error(`Unsafe documentation ${label} path segment: ${value}`);
  }
  return value;
}

function validateRelativeDocumentationPath(path: string): string {
  if (typeof path !== 'string' || posix.isAbsolute(path)) {
    throw new Error(`Invalid generated documentation path: ${path}`);
  }
  const normalized = posix.normalize(normalizeGeneratedPath(path));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Unsafe generated documentation path: ${path}`);
  }
  return normalized;
}

function markdownDocument(provenance: ArtifactProvenance, body: string): string {
  return `${createProvenanceHeader(provenance, 'markdown')}\n${body.trim()}\n`;
}

function markdownText(value: string): string {
  return value
    .replaceAll(/\s+/gu, ' ')
    .replaceAll('\\', '\\\\')
    .replaceAll('[', String.raw`\[`)
    .replaceAll(']', String.raw`\]`)
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .trim();
}

function tableText(value: string): string {
  return markdownText(value).replaceAll('|', String.raw`\|`);
}

function codeList(values: readonly string[]): string {
  return values.length === 0
    ? 'none'
    : values.map((value) => `\`${markdownText(value)}\``).join(', ');
}

function pluralizeOperations(count: number): string {
  return count === 1 ? 'operation' : 'operations';
}

function standaloneExampleTitle(fileName: string): string {
  return fileName
    .replace(/\.md$/u, '')
    .split('-')
    .map((word, index) =>
      index === 0 ? `${word.slice(0, 1).toUpperCase()}${word.slice(1)}` : word,
    )
    .join(' ');
}

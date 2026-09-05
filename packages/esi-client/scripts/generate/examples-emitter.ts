import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

import { createProvenanceHeader, type ArtifactProvenance } from './artifacts.ts';
import { domainFileName } from './domain-client.ts';
import { createSerializableOperationManifest } from './operation-registry.ts';
import type {
  SerializableOperationManifest,
  SerializableOperationManifestEntry,
  SerializableOperationParameter,
} from './operation-registry.ts';
import type { EmitterContext, GeneratedOutputEmitter } from './orchestrate.ts';
import { operationSchemaName } from './zod-schema.ts';

export interface OperationSnippets {
  readonly domainMethod: string;
  readonly standaloneDomainMethod: string;
  readonly genericExecution: string;
  readonly standaloneExamples: readonly string[];
}

export interface GeneratedExamplesComponent {
  readonly name: string;
  emit(context: EmitterContext, examplesDirectory: string): Promise<readonly string[]>;
}

interface FacadePathParameter {
  readonly identifier: string;
  readonly parameter: SerializableOperationParameter;
}

interface FacadeRequiredOption {
  readonly name: string;
  readonly parameter?: SerializableOperationParameter;
}

interface FacadeShape {
  readonly pathParameters: readonly FacadePathParameter[];
  readonly requiredOptions: readonly FacadeRequiredOption[];
}

interface StandaloneExampleDefinition {
  readonly fileName: string;
  readonly operationId: string;
  readonly title: string;
  readonly description: string;
  readonly source: string;
}

const examplesTarget = 'examples/generated';
const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const reservedIdentifiers = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

const standaloneExamples: readonly StandaloneExampleDefinition[] = Object.freeze([
  {
    fileName: 'public.ts',
    operationId: 'GetStatus',
    title: 'Public operation',
    description: 'Call a public typed domain method without credentials.',
    source: `import { EsiClient } from '@evespace/esi-client';

const client = new EsiClient();

export async function getPublicStatus() {
  return client.status.get();
}`,
  },
  {
    fileName: 'authenticated.ts',
    operationId: 'GetCharactersCharacterIdLocation',
    title: 'Authenticated operation',
    description: 'Read a token from the environment and call an authenticated typed method.',
    source: `import { EsiClient } from '@evespace/esi-client';

const characterId = 90000001;

export async function getAuthenticatedCharacterLocation() {
  const client = new EsiClient({ token: requiredAccessToken() });
  return client.location.get(characterId);
}

function requiredAccessToken(): string {
  const token = process.env.ESI_ACCESS_TOKEN;
  if (!token) throw new Error('Set ESI_ACCESS_TOKEN before making this authorized request.');
  return token;
}`,
  },
  {
    fileName: 'paginated.ts',
    operationId: 'GetUniverseGroups',
    title: 'Single-page pagination',
    description: 'Request one page explicitly and inspect metadata before choosing another page.',
    source: `import { EsiClient } from '@evespace/esi-client';

const client = new EsiClient();

export async function getUniverseGroupPage(page = 1) {
  const response = await client.universe.withMetadata().listItemGroups({ page });
  return {
    groupIds: response.data,
    page,
    pages: response.meta.pagination?.pages,
  };
}`,
  },
  {
    fileName: 'metadata.ts',
    operationId: 'GetMarketsPrices',
    title: 'Response metadata',
    description: 'Use a metadata-enabled domain view while preserving typed response data.',
    source: `import { EsiClient } from '@evespace/esi-client';

const client = new EsiClient();

export async function getMarketPricesWithMetadata() {
  const response = await client.market.withMetadata().listPrices();
  return {
    prices: response.data,
    status: response.meta.status,
    requestId: response.meta.requestId,
    cache: response.meta.cache,
    errorLimit: response.meta.errorLimit,
  };
}`,
  },
  {
    fileName: 'validation-error.ts',
    operationId: 'GetUniverseTypesTypeId',
    title: 'Validation-error handling',
    description: 'Handle structured validation failures for untrusted generic arguments.',
    source: `import { EsiClient, EsiRequestValidationError } from '@evespace/esi-client';
import type { CallOperationArguments } from '@evespace/esi-client/operations';

const client = new EsiClient();

export async function validateUntrustedOperationArguments(serializedArguments: string) {
  const untrusted: unknown = JSON.parse(serializedArguments);

  try {
    // Generic execution validates this externally supplied value before network activity.
    return await client.callOperation(
      'GetUniverseTypesTypeId',
      untrusted as CallOperationArguments<'GetUniverseTypesTypeId'>,
    );
  } catch (error: unknown) {
    if (error instanceof EsiRequestValidationError) return error.toJSON();
    throw error;
  }
}`,
  },
  {
    fileName: 'mutation-safety.ts',
    operationId: 'DeleteCharactersCharacterIdFittingsFittingId',
    title: 'Mutation safety',
    description:
      'Require authorization for a typed mutation and both safety gates for generic execution.',
    source: `import { EsiClient } from '@evespace/esi-client';

const characterId = 90000001;
const fittingId = 12345;

export async function deleteFittingWithTypedIntent(authorizationApproved: boolean) {
  assertAuthorized(authorizationApproved);
  const client = new EsiClient({ token: requiredAccessToken() });

  // Selecting this named typed mutation is explicit intent; generic gates do not apply.
  return client.fittings.deleteFitting(characterId, fittingId);
}

export async function deleteFittingGenerically(authorizationApproved: boolean) {
  assertAuthorized(authorizationApproved);
  const client = new EsiClient({
    token: requiredAccessToken(),
    allowGenericMutations: true,
  });

  // Generic mutation execution additionally requires explicit per-call confirmation.
  return client.callOperation(
    'DeleteCharactersCharacterIdFittingsFittingId',
    { path: { character_id: characterId, fitting_id: fittingId } },
    { confirmMutation: true },
  );
}

function assertAuthorized(authorizationApproved: boolean): asserts authorizationApproved {
  if (!authorizationApproved) throw new Error('Explicit authorization is required.');
}

function requiredAccessToken(): string {
  const token = process.env.ESI_ACCESS_TOKEN;
  if (!token) throw new Error('Set ESI_ACCESS_TOKEN before making this authorized request.');
  return token;
}`,
  },
]);

export function renderOperationSnippets(
  manifest: SerializableOperationManifest,
): ReadonlyMap<string, OperationSnippets> {
  if (!Array.isArray(manifest?.operations)) {
    throw new TypeError('Operation snippets require a serializable operation manifest');
  }
  const snippets = new Map<string, OperationSnippets>();
  for (const operation of [...manifest.operations].toSorted((left, right) =>
    compareText(left.operationId, right.operationId),
  )) {
    if (snippets.has(operation.operationId)) {
      throw new Error(`Duplicate operation snippet ID: ${operation.operationId}`);
    }
    const shape = createFacadeShape(operation);
    snippets.set(
      operation.operationId,
      Object.freeze({
        domainMethod: renderDomainMethodSnippet(operation, shape),
        standaloneDomainMethod: renderStandaloneDomainMethodSnippet(operation, shape),
        genericExecution: renderGenericExecutionSnippet(operation, shape),
        standaloneExamples: relatedStandaloneExamples(operation),
      }),
    );
  }
  return snippets;
}

export function renderStandaloneExamples(
  manifest: SerializableOperationManifest,
  provenance: ArtifactProvenance,
): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  for (const example of standaloneExamples) {
    files.set(
      example.fileName,
      `${createProvenanceHeader(provenance, 'typescript')}\n${example.source.trim()}\n`,
    );
  }
  const snippets = renderOperationSnippets(manifest);
  const firstOperationByDomain = new Map<string, SerializableOperationManifestEntry>();
  for (const operation of manifest.operations) {
    if (!firstOperationByDomain.has(operation.facade.domain)) {
      firstOperationByDomain.set(operation.facade.domain, operation);
    }
  }
  for (const [domain, operation] of [...firstOperationByDomain].toSorted(([left], [right]) =>
    compareText(left, right),
  )) {
    const snippet = snippets.get(operation.operationId)?.standaloneDomainMethod;
    if (snippet === undefined) {
      throw new Error(`Missing standalone domain example snippet: ${operation.operationId}`);
    }
    files.set(
      `domain-${domainFileName(domain)}.ts`,
      `${createProvenanceHeader(provenance, 'typescript')}\n${snippet.trim()}\n`,
    );
  }
  return files;
}

export function renderStandaloneExampleDocumentation(
  provenance: ArtifactProvenance,
): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  const links = standaloneExamples
    .map(
      (example) =>
        `- [${example.title}](./${example.fileName.replace(/\.ts$/u, '.md')}) - ${example.description}`,
    )
    .join('\n');
  files.set(
    'examples/index.md',
    markdownDocument(
      provenance,
      `# Standalone examples

These generated examples use fixed placeholder identifiers and read credentials only from \`process.env.ESI_ACCESS_TOKEN\`. They are never executed during documentation validation.

${links}`,
    ),
  );
  for (const example of standaloneExamples) {
    files.set(
      `examples/${example.fileName.replace(/\.ts$/u, '.md')}`,
      markdownDocument(
        provenance,
        `# ${example.title}

${example.description}

- Operation: [\`${example.operationId}\`](../operations/${example.operationId}.md)
- Repository source: \`examples/generated/${example.fileName}\`

\`\`\`ts
${example.source.trim()}
\`\`\``,
      ),
    );
  }
  return files;
}

export function createGeneratedExamplesEmitter(
  components: readonly GeneratedExamplesComponent[],
): GeneratedOutputEmitter {
  if (!Array.isArray(components) || components.length === 0) {
    throw new TypeError('Generated example components must be a non-empty array');
  }
  const exampleComponents = [...components];
  const names = new Set<string>();
  for (const component of exampleComponents) {
    if (
      component === null ||
      typeof component !== 'object' ||
      typeof component.name !== 'string' ||
      component.name.length === 0 ||
      typeof component.emit !== 'function'
    ) {
      throw new TypeError('Invalid generated example component');
    }
    if (names.has(component.name)) {
      throw new Error(`Duplicate generated example component name: ${component.name}`);
    }
    names.add(component.name);
  }

  return Object.freeze({
    name: 'generated-examples',
    async emit(context: EmitterContext) {
      const examplesDirectory = context.outputPath(examplesTarget);
      await mkdir(examplesDirectory, { recursive: true });
      const outputs = new Set<string>();
      for (const component of exampleComponents) {
        const componentOutputs = await component.emit(context, examplesDirectory);
        if (!Array.isArray(componentOutputs)) {
          throw new TypeError(
            `Generated example component ${component.name} did not return output paths`,
          );
        }
        for (const output of componentOutputs) {
          const relativePath = validateRelativeOutputPath(output, component.name);
          if (outputs.has(relativePath)) {
            throw new Error(`Duplicate generated example output: ${relativePath}`);
          }
          outputs.add(relativePath);
          const status = await lstat(join(examplesDirectory, relativePath));
          if (!status.isFile() || status.isSymbolicLink()) {
            throw new Error(`Generated example output must be a regular file: ${relativePath}`);
          }
        }
      }
      return [{ target: examplesTarget, kind: 'directory' as const }];
    },
  });
}

export async function emitStandaloneExamples(
  context: EmitterContext,
  examplesDirectory: string,
): Promise<readonly string[]> {
  const manifest = createSerializableOperationManifest(
    context.normalizedModel,
    context.operationMetadata,
    context.provenance,
  );
  const files = renderStandaloneExamples(manifest, context.provenance);
  await Promise.all(
    [...files].map(([relativePath, content]) =>
      writeFile(join(examplesDirectory, relativePath), content),
    ),
  );
  return [...files.keys()];
}

export const standaloneExamplesComponent: GeneratedExamplesComponent = Object.freeze({
  name: 'standalone-examples',
  emit: emitStandaloneExamples,
});

export const generatedExamplesEmitter: GeneratedOutputEmitter = createGeneratedExamplesEmitter([
  standaloneExamplesComponent,
]);

function renderDomainMethodSnippet(
  operation: SerializableOperationManifestEntry,
  shape: FacadeShape,
): string {
  const imports = ["import { EsiClient } from '@evespace/esi-client';"];
  const declarations = renderPathDeclarations(shape.pathParameters);
  let bodyName;
  if (operation.requestBody?.required === true) {
    const optionsName = `${operationSchemaName(operation.operationId)}Options`;
    imports.push(
      `import type { ${optionsName} } from '@evespace/esi-client/domains/${domainFileName(operation.facade.domain)}';`,
    );
    bodyName = 'requestBody';
    declarations.push(`declare const requestBody: NonNullable<${optionsName}['body']>;`);
  }
  const options = renderDomainRequiredOptions(shape.requiredOptions, bodyName);
  const callArguments = [
    ...shape.pathParameters.map(({ identifier }) => identifier),
    ...(options === null ? [] : [options]),
  ];
  const lines = [
    ...imports,
    '',
    ...renderClientSetup(operation),
    ...(declarations.length === 0 ? [] : ['', ...declarations]),
    '',
  ];
  if (operation.classification === 'mutation') {
    lines.push(
      '// This named typed mutation expresses explicit intent. Verify authorization before calling it.',
    );
  }
  lines.push(
    `const data = await client.${operation.facade.domain}.${operation.facade.method}(${callArguments.join(', ')});`,
  );
  return `${lines.join('\n')}\n`;
}

function renderStandaloneDomainMethodSnippet(
  operation: SerializableOperationManifestEntry,
  shape: FacadeShape,
): string {
  const factoryName = `create${capitalize(operation.facade.domain)}Client`;
  const domainSubpath = `@evespace/esi-client/domains/${domainFileName(operation.facade.domain)}`;
  const imports = [`import { ${factoryName} } from '${domainSubpath}';`];
  const declarations = renderPathDeclarations(shape.pathParameters);
  let bodyName;
  if (operation.requestBody?.required === true) {
    const optionsName = `${operationSchemaName(operation.operationId)}Options`;
    imports.push(`import type { ${optionsName} } from '${domainSubpath}';`);
    bodyName = 'requestBody';
    declarations.push(`declare const requestBody: NonNullable<${optionsName}['body']>;`);
  }
  const options = renderDomainRequiredOptions(shape.requiredOptions, bodyName);
  const callArguments = [
    ...shape.pathParameters.map(({ identifier }) => identifier),
    ...(options === null ? [] : [options]),
  ];
  const lines = [
    ...imports,
    '',
    ...renderStandaloneClientSetup(operation, factoryName),
    ...(declarations.length === 0 ? [] : ['', ...declarations]),
    '',
  ];
  if (operation.classification === 'mutation') {
    lines.push(
      '// This named typed mutation expresses explicit intent. Verify authorization before calling it.',
    );
  }
  lines.push(`const data = await client.${operation.facade.method}(${callArguments.join(', ')});`);
  return `${lines.join('\n')}\n`;
}

function renderGenericExecutionSnippet(
  operation: SerializableOperationManifestEntry,
  shape: FacadeShape,
): string {
  const lines = [
    "import { EsiClient } from '@evespace/esi-client';",
    "import type { CallOperationArguments } from '@evespace/esi-client/operations';",
    '',
    ...renderClientSetup(operation, operation.classification === 'mutation'),
  ];
  const declarations = renderPathDeclarations(shape.pathParameters);
  if (operation.requestBody?.required === true) {
    declarations.push(
      `declare const requestBody: NonNullable<CallOperationArguments<'${operation.operationId}'>['body']>;`,
    );
  }
  if (declarations.length > 0) lines.push('', ...declarations);
  const argumentsValue = renderGenericArguments(operation, shape);
  lines.push(
    '',
    `const arguments_: CallOperationArguments<'${operation.operationId}'> = ${argumentsValue};`,
    '',
  );
  if (operation.classification === 'mutation') {
    lines.push(
      '// Generic mutation execution requires authorization, client enablement, and confirmation.',
      `const response = await client.callOperation('${operation.operationId}', arguments_, {`,
      '  confirmMutation: true,',
      '});',
    );
  } else {
    lines.push(
      `const response = await client.callOperation('${operation.operationId}', arguments_);`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function renderClientSetup(
  operation: SerializableOperationManifestEntry,
  allowGenericMutations = false,
): string[] {
  if (!operation.authentication.required && !allowGenericMutations) {
    return ['const client = new EsiClient();'];
  }
  const lines: string[] = [];
  if (operation.authentication.required) {
    lines.push(
      'const accessToken = process.env.ESI_ACCESS_TOKEN;',
      "if (!accessToken) throw new Error('Set ESI_ACCESS_TOKEN before making this authorized request.');",
      '',
    );
  }
  const options: string[] = [];
  if (operation.authentication.required) options.push('token: accessToken');
  if (allowGenericMutations) options.push('allowGenericMutations: true');
  lines.push(`const client = new EsiClient({ ${options.join(', ')} });`);
  return lines;
}

function renderStandaloneClientSetup(
  operation: SerializableOperationManifestEntry,
  factoryName: string,
): string[] {
  if (!operation.authentication.required) return [`const client = ${factoryName}();`];
  return [
    'const accessToken = process.env.ESI_ACCESS_TOKEN;',
    "if (!accessToken) throw new Error('Set ESI_ACCESS_TOKEN before making this authorized request.');",
    '',
    `const client = ${factoryName}({ token: accessToken });`,
  ];
}

function createFacadeShape(operation: SerializableOperationManifestEntry): FacadeShape {
  const pathByName = new Map(
    operation.parameters
      .filter(({ placement }) => placement === 'path')
      .map((parameter) => [parameter.name, parameter]),
  );
  const pathParameters: FacadePathParameter[] = [];
  const usedIdentifiers = new Set(['options']);
  for (const match of operation.http.path.matchAll(/\{([^{}]+)\}/gu)) {
    const parameter = pathByName.get(match[1]);
    if (!parameter?.required) {
      throw new Error(`Missing required path parameter ${match[1]} for ${operation.operationId}`);
    }
    let identifier = facadeParameterName(parameter.name);
    if (reservedIdentifiers.has(identifier) || usedIdentifiers.has(identifier)) {
      identifier = `${identifier}Value`;
    }
    const base = identifier;
    let suffix = 2;
    while (usedIdentifiers.has(identifier)) {
      identifier = `${base}${suffix}`;
      suffix += 1;
    }
    usedIdentifiers.add(identifier);
    pathParameters.push({ identifier, parameter });
    pathByName.delete(parameter.name);
  }
  if (pathByName.size > 0) {
    throw new Error(
      `Unused path parameters for ${operation.operationId}: ${[...pathByName.keys()].join(', ')}`,
    );
  }

  const requiredOptions: FacadeRequiredOption[] = operation.parameters
    .filter(({ placement, required }) => placement !== 'path' && required)
    .map((parameter) => ({
      name: facadeParameterName(parameter.name),
      parameter,
    }));
  if (operation.requestBody?.required === true) requiredOptions.push({ name: 'body' });
  return { pathParameters, requiredOptions };
}

function renderPathDeclarations(pathParameters: readonly FacadePathParameter[]): string[] {
  return pathParameters.map(
    ({ identifier, parameter }) =>
      `const ${identifier} = ${renderParameterPlaceholder(parameter)};`,
  );
}

function renderDomainRequiredOptions(
  requiredOptions: readonly FacadeRequiredOption[],
  bodyName: string | undefined,
): string | null {
  if (requiredOptions.length === 0) return null;
  return `{ ${requiredOptions
    .map(({ name, parameter }) =>
      name === 'body' || parameter === undefined
        ? `body: ${bodyName}`
        : `${name}: ${renderParameterPlaceholder(parameter)}`,
    )
    .join(', ')} }`;
}

function renderGenericArguments(
  operation: SerializableOperationManifestEntry,
  shape: FacadeShape,
): string {
  const groups: string[] = [];
  if (shape.pathParameters.length > 0) {
    groups.push(
      `path: { ${shape.pathParameters
        .map(({ identifier, parameter }) => `${JSON.stringify(parameter.name)}: ${identifier}`)
        .join(', ')} }`,
    );
  }
  for (const placement of ['query', 'header'] as const) {
    const parameters = operation.parameters.filter(
      (parameter) => parameter.placement === placement && parameter.required,
    );
    if (parameters.length === 0) continue;
    groups.push(
      `${placement}: { ${parameters
        .map(
          (parameter) =>
            `${JSON.stringify(parameter.name)}: ${renderParameterPlaceholder(parameter)}`,
        )
        .join(', ')} }`,
    );
  }
  if (operation.requestBody?.required === true) groups.push('body: requestBody');
  return groups.length === 0 ? '{}' : `{ ${groups.join(', ')} }`;
}

function renderParameterPlaceholder(parameter: SerializableOperationParameter): string {
  return renderSchemaPlaceholder(parameter.schema, parameter.name);
}

function renderSchemaPlaceholder(schema: unknown, name: string): string {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return 'null';
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- typeof narrows to object, not an indexable record
  const record = schema as Record<string, unknown>;
  if (Array.isArray(record.enum) && record.enum.length > 0) return JSON.stringify(record.enum[0]);
  if (record.const !== undefined) return JSON.stringify(record.const);
  if (typeof record.$ref === 'string') return renderReferencePlaceholder(record.$ref, name);
  if (Array.isArray(record.type)) {
    const nonNull = (record.type as readonly string[]).find((entry) => entry !== 'null');
    return renderSchemaPlaceholder({ ...record, type: nonNull }, name);
  }
  switch (record.type) {
    case 'array':
      return `[${renderSchemaPlaceholder(record.items, singular(name))}]`;
    case 'boolean':
      return 'true';
    case 'integer':
    case 'number':
      return String(identifierNumber(name));
    case 'string':
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- format is optional and only meaningful for string schemas
      return renderStringPlaceholder(record.format as string | undefined, name);
    default:
      return 'null';
  }
}

function renderReferencePlaceholder(reference: string, name: string): string {
  const referenceName = reference.split('/').at(-1) ?? '';
  if (referenceName === 'UUID') return JSON.stringify('00000000-0000-4000-8000-000000000000');
  return String(identifierNumber(name, referenceName));
}

function renderStringPlaceholder(format: string | undefined, name: string): string {
  if (format === 'date') return JSON.stringify('2026-08-18');
  if (format === 'date-time') return JSON.stringify('2026-08-18T12:30:00Z');
  if (format === 'uuid') return JSON.stringify('00000000-0000-4000-8000-000000000000');
  if (/hash/iu.test(name)) return JSON.stringify('0000000000000000000000000000000000000000');
  return JSON.stringify(`example-${name.replaceAll('_', '-')}`);
}

function identifierNumber(name: string, referenceName = ''): number {
  const key = `${name} ${referenceName}`.toLowerCase();
  if (key.includes('character')) return 90000001;
  if (key.includes('corporation')) return 98000001;
  if (key.includes('alliance')) return 99000001;
  if (key.includes('solar') || key.includes('system')) return 30000142;
  if (key.includes('constellation')) return 20000020;
  if (key.includes('region')) return 10000002;
  if (key.includes('station')) return 60003760;
  if (key.includes('structure')) return 1020000000000;
  if (key.includes('item')) return 1000000000001;
  if (key.includes('type')) return 34;
  return 12345;
}

function relatedStandaloneExamples(operation: SerializableOperationManifestEntry): string[] {
  const fileNames = new Set([
    operation.authentication.required ? 'authenticated.md' : 'public.md',
    'metadata.md',
    'validation-error.md',
  ]);
  if (operation.pagination.kind !== 'none') fileNames.add('paginated.md');
  if (operation.classification === 'mutation') fileNames.add('mutation-safety.md');
  return [...fileNames].toSorted(compareText);
}

function facadeParameterName(value: string): string {
  const words = value
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replaceAll(/([A-Z])(?=[A-Z][a-z])/gu, '$1 ')
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean);
  if (words.length === 0) throw new Error(`Cannot derive facade parameter name from ${value}`);
  let identifier = `${words[0].toLowerCase()}${words
    .slice(1)
    .map((word) => capitalize(word.toLowerCase()))
    .join('')}`;
  if (!/^[A-Za-z_$]/u.test(identifier)) identifier = `value${capitalize(identifier)}`;
  if (!identifierPattern.test(identifier)) {
    throw new Error(`Invalid generated facade parameter identifier: ${identifier}`);
  }
  return identifier;
}

function validateRelativeOutputPath(path: string, componentName: string): string {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) {
    throw new Error(`Generated example component ${componentName} returned an invalid output path`);
  }
  const normalized = normalize(path).replaceAll('\\', '/');
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.') {
    throw new Error(`Generated example component ${componentName} returned an unsafe output path`);
  }
  return normalized;
}

function markdownDocument(provenance: ArtifactProvenance, body: string): string {
  return `${createProvenanceHeader(provenance, 'markdown')}\n${body.trim()}\n`;
}

function singular(value: string): string {
  return value.endsWith('s') ? value.slice(0, -1) : value;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

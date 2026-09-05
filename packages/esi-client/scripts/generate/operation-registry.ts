import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createJsonProvenanceHeader,
  createProvenanceHeader,
  renderGeneratedBarrel,
  type ArtifactProvenance,
} from './artifacts.ts';
import {
  domainFileName,
  operationDescriptorName,
  resolveOperationAuthentication,
} from './domain-client.ts';
import type {
  JsonObject,
  JsonValue,
  NormalizedOpenApiModel,
  NormalizedOperation,
} from './normalize.ts';
import type { ResolvedOperationMetadata } from './operation-metadata.ts';
import {
  isTransportManagedParameter,
  operationAllowsCompatibilityDateOverride,
} from './operation-parameters.ts';
import type { EmitterContext } from './orchestrate.ts';
import type { GeneratedSourceComponent } from './source-emitter.ts';
import { operationSchemaName, operationStatusResponseSchemaName } from './zod-schema.ts';

export interface RenderedOperationRegistryArtifacts {
  readonly indexSource: string;
  readonly manifestSource: string;
  readonly registrySource: string;
}

export interface SerializableOperationReference {
  readonly module: '@evespace/esi-client/schemas';
  readonly export: string;
}

export interface SerializableOperationParameter {
  readonly name: string;
  readonly placement: 'path' | 'query' | 'header' | 'cookie';
  readonly required: boolean;
  readonly deprecated: boolean;
  readonly description: string | null;
  readonly style: string | null;
  readonly explode: boolean | null;
  readonly allowReserved: boolean | null;
  readonly schema: JsonValue;
}

export interface SerializableOperationContent {
  readonly mediaType: string;
  readonly schema: JsonValue;
}

export interface SerializableOperationManifestEntry {
  readonly operationId: string;
  readonly facade: { readonly domain: string; readonly method: string };
  readonly summary: string | null;
  readonly description: string | null;
  readonly http: {
    readonly method: 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'PATCH' | 'POST' | 'PUT' | 'TRACE';
    readonly path: string;
  };
  readonly parameters: readonly SerializableOperationParameter[];
  readonly requestBody: {
    readonly required: boolean;
    readonly description: string | null;
    readonly content: readonly SerializableOperationContent[];
  } | null;
  readonly requestSchema: SerializableOperationReference;
  readonly responses: readonly {
    readonly status: string;
    readonly description: string;
    readonly body: 'json' | 'none';
    readonly content: readonly SerializableOperationContent[];
    readonly schema: SerializableOperationReference;
  }[];
  readonly authentication: { readonly required: boolean; readonly scopes: readonly string[] };
  readonly pagination: {
    readonly kind: 'none' | 'offset' | 'cursor' | 'offset-and-cursor';
    readonly requestParameters: readonly string[];
    readonly responseHeaders: readonly string[];
  };
  readonly cache: {
    readonly responseHeaders: readonly string[];
    readonly extensions: JsonObject;
  };
  readonly transport: { readonly compatibilityDateOverride: boolean };
  readonly classification: 'read' | 'mutation';
  readonly safety: {
    readonly readLike: boolean;
    readonly readLikeOverride: { readonly reviewed: true; readonly reason: string } | null;
    readonly typed: {
      readonly expressesMutationIntent: boolean;
      readonly genericMutationGatesApply: false;
    };
    readonly generic: {
      readonly requiresClientMutationEnablement: boolean;
      readonly requiresConfirmation: boolean;
    };
  };
}

export interface SerializableOperationManifest {
  readonly _generated: {
    readonly compatibilityDate: string;
    readonly notice: string;
    readonly specificationSha256: string;
  };
  readonly operations: readonly SerializableOperationManifestEntry[];
  readonly schemaVersion: 1;
}

interface OperationRegistryEntry {
  readonly metadata: ResolvedOperationMetadata;
  readonly operation: NormalizedOperation;
}

const schemaModule = '@evespace/esi-client/schemas';

export function renderOperationRegistryArtifacts(
  model: NormalizedOpenApiModel,
  operationMetadata: readonly ResolvedOperationMetadata[],
  provenance: ArtifactProvenance,
): RenderedOperationRegistryArtifacts {
  const entries = indexOperations(model, operationMetadata);
  const manifest = createSerializableOperationManifestFromEntries(entries, provenance);
  return Object.freeze({
    indexSource: renderGeneratedBarrel(['./manifest.js', './registry.js'], provenance),
    manifestSource: renderManifestModule(manifest, provenance),
    registrySource: renderRegistryModule(entries, provenance),
  });
}

export function createSerializableOperationManifest(
  model: NormalizedOpenApiModel,
  operationMetadata: readonly ResolvedOperationMetadata[],
  provenance: ArtifactProvenance,
): SerializableOperationManifest {
  return createSerializableOperationManifestFromEntries(
    indexOperations(model, operationMetadata),
    provenance,
  );
}

export async function emitOperationRegistrySource(
  context: EmitterContext,
  sourceDirectory: string,
): Promise<readonly ['operations/index.ts', 'operations/manifest.ts', 'operations/registry.ts']> {
  if (!isObject(context) || !isObject(context.normalizedModel)) {
    throw new TypeError('Operation registry source context must contain a normalized model');
  }
  if (typeof sourceDirectory !== 'string' || sourceDirectory.length === 0) {
    throw new TypeError('Operation registry source directory must be a non-empty string');
  }
  const artifacts = renderOperationRegistryArtifacts(
    context.normalizedModel,
    context.operationMetadata,
    context.provenance,
  );
  const directory = join(sourceDirectory, 'operations');
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'index.ts'), artifacts.indexSource),
    writeFile(join(directory, 'manifest.ts'), artifacts.manifestSource),
    writeFile(join(directory, 'registry.ts'), artifacts.registrySource),
  ]);
  return ['operations/index.ts', 'operations/manifest.ts', 'operations/registry.ts'];
}

export const operationRegistrySourceComponent: GeneratedSourceComponent = Object.freeze({
  name: 'operation-registry',
  emit: emitOperationRegistrySource,
});

function indexOperations(
  model: NormalizedOpenApiModel,
  operationMetadata: readonly ResolvedOperationMetadata[],
): OperationRegistryEntry[] {
  if (!isRecordLike(model) || !Array.isArray(model.operations)) {
    throw new TypeError('Normalized model must contain operations');
  }
  if (!Array.isArray(operationMetadata)) {
    throw new TypeError('Resolved operation metadata must be an array');
  }
  const metadataById = new Map<string, ResolvedOperationMetadata>();
  for (const metadata of operationMetadata as readonly unknown[]) {
    if (!isObject(metadata) || typeof metadata.operationId !== 'string') {
      throw new TypeError('Resolved operation metadata entry is invalid');
    }
    if (metadataById.has(metadata.operationId)) {
      throw new Error(`Duplicate resolved operation metadata: ${metadata.operationId}`);
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- operationId/domain are validated above; the rest is trusted like the prior untyped implementation
    metadataById.set(metadata.operationId, metadata as unknown as ResolvedOperationMetadata);
  }
  const seen = new Set<string>();
  const entries = model.operations.map((operation) => {
    if (!isRecordLike(operation) || typeof operation.operationId !== 'string') {
      throw new TypeError('Normalized operation must contain an operation ID');
    }
    if (seen.has(operation.operationId)) {
      throw new Error(`Duplicate normalized operation: ${operation.operationId}`);
    }
    seen.add(operation.operationId);
    const metadata = metadataById.get(operation.operationId);
    if (metadata === undefined) {
      throw new Error(`Missing resolved operation metadata: ${operation.operationId}`);
    }
    return { metadata, operation };
  });
  if (seen.size !== metadataById.size) {
    const stale = [...metadataById.keys()].filter((operationId) => !seen.has(operationId));
    throw new Error(`Stale resolved operation metadata: ${stale.toSorted(compareText).join(', ')}`);
  }
  return entries.toSorted((left, right) =>
    compareText(left.operation.operationId, right.operation.operationId),
  );
}

function renderRegistryModule(
  entries: readonly OperationRegistryEntry[],
  provenance: ArtifactProvenance,
): string {
  const descriptorImports = new Map<string, string[]>();
  const schemaImports: string[] = [];
  for (const { metadata, operation } of entries) {
    const descriptorFile = domainFileName(metadata.domain);
    const descriptors = descriptorImports.get(descriptorFile) ?? [];
    descriptors.push(operationDescriptorName(operation.operationId));
    descriptorImports.set(descriptorFile, descriptors);
    const name = operationSchemaName(operation.operationId);
    schemaImports.push(
      `${name}RequestSchema`,
      `${name}SuccessResponseSchema`,
      `${name}SuccessResponseSchemasByStatus`,
    );
  }
  const imports = [...descriptorImports]
    .toSorted(([left], [right]) => compareText(left, right))
    .map(
      ([file, names]) =>
        `import {\n${names
          .toSorted(compareText)
          .map((name) => `  ${name},`)
          .join('\n')}\n} from '../internal/descriptors/${file}.js';`,
    )
    .join('\n');
  const registryEntries = entries.map(({ metadata, operation }) => {
    const name = operationSchemaName(operation.operationId);
    return `  ${JSON.stringify(operation.operationId)}: Object.freeze({
    classification: ${JSON.stringify(metadata.classification)},
    transport: ${operationDescriptorName(operation.operationId)},
    requestSchema: ${name}RequestSchema,
    responseSchema: ${name}SuccessResponseSchema,
    responseSchemasByStatus: Object.freeze({ ...${name}SuccessResponseSchemasByStatus }),
  }),`;
  });
  return `${createProvenanceHeader(provenance, 'typescript')}
import type { OperationExecutionDescriptor } from '../../client/execute.js';
import type { z } from 'zod';
import {
${schemaImports
  .toSorted(compareText)
  .map((name) => `  ${name},`)
  .join('\n')}
} from '../schemas/operations.js';
${imports}

export interface ExecutableOperationRegistryEntry {
  readonly classification: 'read' | 'mutation';
  readonly transport: OperationExecutionDescriptor;
  readonly requestSchema: z.ZodType;
  readonly responseSchema: z.ZodType;
  readonly responseSchemasByStatus: Readonly<Record<string, z.ZodType>>;
}

export type ExecutableOperationRegistry = Readonly<
  Record<string, ExecutableOperationRegistryEntry>
>;

export const operationRegistry: ExecutableOperationRegistry = Object.freeze({
${registryEntries.join('\n')}
});
`;
}

function createSerializableOperationManifestFromEntries(
  entries: readonly OperationRegistryEntry[],
  provenance: ArtifactProvenance,
): SerializableOperationManifest {
  return deepFreeze({
    ...createJsonProvenanceHeader(provenance),
    operations: entries.map(createManifestEntry),
    schemaVersion: 1 as const,
  });
}

function renderManifestModule(
  manifest: SerializableOperationManifest,
  provenance: ArtifactProvenance,
): string {
  return `${createProvenanceHeader(provenance, 'json-compatible')}
import type {
  JsonValue,
  OperationHttpMethod,
  OperationParameterPlacement,
} from '../../client/request.js';

export interface OperationSchemaReference {
  readonly module: '@evespace/esi-client/schemas';
  readonly export: string;
}

export interface SerializableOperationParameter {
  readonly name: string;
  readonly placement: OperationParameterPlacement;
  readonly required: boolean;
  readonly deprecated: boolean;
  readonly description: string | null;
  readonly style: string | null;
  readonly explode: boolean | null;
  readonly allowReserved: boolean | null;
  readonly schema: JsonValue;
}

export interface SerializableOperationContent {
  readonly mediaType: string;
  readonly schema: JsonValue;
}

export interface SerializableOperationRequestBody {
  readonly required: boolean;
  readonly description: string | null;
  readonly content: readonly SerializableOperationContent[];
}

export interface SerializableOperationResponse {
  readonly status: string;
  readonly description: string;
  readonly body: 'json' | 'none';
  readonly content: readonly SerializableOperationContent[];
  readonly schema: OperationSchemaReference;
}

export interface SerializableOperationManifestEntry {
  readonly operationId: string;
  readonly facade: { readonly domain: string; readonly method: string };
  readonly summary: string | null;
  readonly description: string | null;
  readonly http: { readonly method: OperationHttpMethod; readonly path: string };
  readonly parameters: readonly SerializableOperationParameter[];
  readonly requestBody: SerializableOperationRequestBody | null;
  readonly requestSchema: OperationSchemaReference;
  readonly responses: readonly SerializableOperationResponse[];
  readonly authentication: { readonly required: boolean; readonly scopes: readonly string[] };
  readonly pagination: {
    readonly kind: 'none' | 'offset' | 'cursor' | 'offset-and-cursor';
    readonly requestParameters: readonly string[];
    readonly responseHeaders: readonly string[];
  };
  readonly cache: {
    readonly responseHeaders: readonly string[];
    readonly extensions: Readonly<Record<string, JsonValue>>;
  };
  readonly transport: { readonly compatibilityDateOverride: boolean };
  readonly classification: 'read' | 'mutation';
  readonly safety: {
    readonly readLike: boolean;
    readonly readLikeOverride: { readonly reviewed: true; readonly reason: string } | null;
    readonly typed: {
      readonly expressesMutationIntent: boolean;
      readonly genericMutationGatesApply: false;
    };
    readonly generic: {
      readonly requiresClientMutationEnablement: boolean;
      readonly requiresConfirmation: boolean;
    };
  };
}

export interface SerializableOperationManifest {
  readonly _generated: {
    readonly compatibilityDate: string;
    readonly notice: string;
    readonly specificationSha256: string;
  };
  readonly schemaVersion: 1;
  readonly operations: readonly SerializableOperationManifestEntry[];
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

export const operationManifest: SerializableOperationManifest = deepFreeze<SerializableOperationManifest>(${JSON.stringify(manifest, null, 2)});
`;
}

function createManifestEntry({
  metadata,
  operation,
}: OperationRegistryEntry): SerializableOperationManifestEntry {
  const authentication = resolveOperationAuthentication(operation);
  const classification = metadata.classification;
  const mutation = classification === 'mutation';
  return {
    authentication: {
      required: authentication !== null,
      scopes: authentication?.scopes ?? [],
    },
    cache: operation.cache,
    classification,
    description: operation.description,
    facade: { domain: metadata.domain, method: metadata.method },
    http: { method: operation.method, path: operation.path },
    operationId: operation.operationId,
    pagination: operation.pagination,
    parameters: operation.parameters
      .filter((parameter) => !isTransportManagedParameter(parameter))
      .map(({ extensions: _extensions, ...parameter }) => parameter),
    requestBody:
      operation.requestBody === null
        ? null
        : {
            content: operation.requestBody.content.map(
              ({ extensions: _extensions, ...content }) => content,
            ),
            description: operation.requestBody.description,
            required: operation.requestBody.required,
          },
    requestSchema: schemaReference(`${operationSchemaName(operation.operationId)}RequestSchema`),
    responses: operation.successResponses.map((response) => ({
      body: response.noContent ? ('none' as const) : ('json' as const),
      content: response.content.map(({ extensions: _extensions, ...content }) => content),
      description: response.description,
      schema: schemaReference(
        operationStatusResponseSchemaName(operation.operationId, response.status),
      ),
      status: response.status,
    })),
    safety: {
      generic: {
        requiresClientMutationEnablement: mutation,
        requiresConfirmation: mutation,
      },
      readLike: classification === 'read',
      readLikeOverride:
        metadata.safetyOverrideReason === null
          ? null
          : { reason: metadata.safetyOverrideReason, reviewed: true },
      typed: {
        expressesMutationIntent: mutation,
        genericMutationGatesApply: false,
      },
    },
    summary: operation.summary,
    transport: {
      compatibilityDateOverride: operationAllowsCompatibilityDateOverride(operation),
    },
  };
}

function schemaReference(exportName: string): SerializableOperationReference {
  return { export: exportName, module: schemaModule };
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Same runtime check as isObject, but without a type predicate: some call sites validate a
// value whose static type is already concrete, and a predicate there would incorrectly widen
// (rather than preserve) that type after narrowing.
function isRecordLike(value: unknown): boolean {
  return isObject(value);
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

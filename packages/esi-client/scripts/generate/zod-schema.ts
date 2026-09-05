import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createProvenanceHeader,
  renderGeneratedBarrel,
  type ArtifactProvenance,
} from './artifacts.ts';
import type { NormalizedModel, NormalizedOperation, NormalizedSchema } from './normalize.ts';
import { isTransportManagedParameter } from './operation-parameters.ts';
import type { ResolvedOperationMetadata } from './operation-metadata.ts';
import type { EmitterContext } from './orchestrate.ts';
import type { GeneratedSourceComponent } from './source-emitter.ts';

export interface SchemaDependencyModel {
  readonly models: readonly {
    readonly dependencies: readonly string[];
    readonly directDependencies: readonly string[];
    readonly fileName: string;
    readonly model: NormalizedModel;
  }[];
  readonly operations: readonly {
    readonly dependencies: readonly string[];
    readonly directDependencies: readonly string[];
    readonly domain: string | null;
    readonly operation: NormalizedOperation;
  }[];
  readonly domains: readonly {
    readonly dependencies: readonly string[];
    readonly domain: string;
    readonly fileName: string;
    readonly operations: readonly NormalizedOperation[];
  }[];
}

export interface EmitZodSchemaExpressionOptions {
  readonly path?: string;
  readonly references?: Readonly<Record<string, string>>;
}

interface ModelIndex {
  readonly modelsByName: Map<string, NormalizedModel>;
  readonly modelsByPointer: Map<string, NormalizedModel>;
}

interface ModelClosureState {
  readonly active: string[];
  readonly closures: Map<string, readonly string[]>;
  readonly directByName: Map<string, readonly string[]>;
  readonly modelsByName: Map<string, NormalizedModel>;
}

interface ReferenceEmitState {
  readonly helpers: Set<string>;
  readonly references: Map<string, string>;
}

interface TypeReference {
  readonly input: string;
  readonly output: string;
}

interface TypeEmitState {
  readonly references: Map<string, TypeReference>;
}

type SchemaDirection = 'input' | 'output';

interface CollectedReference {
  readonly path: string;
  readonly reference: string;
}

const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const annotationKeywords = new Set([
  'default',
  'deprecated',
  'description',
  'example',
  'examples',
  'readOnly',
  'title',
  'writeOnly',
]);
const supportedKeywords = new Set([
  '$ref',
  'additionalProperties',
  'allOf',
  'anyOf',
  'const',
  'enum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'items',
  'maximum',
  'maxItems',
  'maxLength',
  'minimum',
  'minItems',
  'minLength',
  'multipleOf',
  'nullable',
  'oneOf',
  'pattern',
  'properties',
  'required',
  'type',
  'uniqueItems',
  ...annotationKeywords,
]);
const numericKeywords = [
  'exclusiveMaximum',
  'exclusiveMinimum',
  'maximum',
  'minimum',
  'multipleOf',
];
const stringKeywords = ['maxLength', 'minLength', 'pattern'];
const arrayKeywords = ['items', 'maxItems', 'minItems', 'uniqueItems'];
const objectKeywords = ['additionalProperties', 'properties', 'required'];
const ignoredReferenceValueKeywords = new Set(['const', 'default', 'enum', 'example', 'examples']);

export class ZodSchemaEmissionError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${message} at ${path}`);
    this.name = 'ZodSchemaEmissionError';
    this.path = path;
  }
}

export function emitZodSchemaExpression(
  schema: NormalizedSchema,
  options: EmitZodSchemaExpressionOptions = {},
): string {
  if (!isObject(options)) throw new TypeError('Zod schema emission options must be an object');
  const path = options.path ?? '#';
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('Zod schema emission path must be a non-empty string');
  }
  const references = normalizeReferenceNames(options.references ?? {}, path);
  return emitSchema(schema, path, { helpers: new Set(), references });
}

export function renderZodSchemaModule(
  models: readonly NormalizedModel[],
  provenance: ArtifactProvenance,
): string {
  return renderZodModelSchemaModule(models, provenance);
}

export function createSchemaDependencyModel(
  models: readonly NormalizedModel[],
  operations: readonly NormalizedOperation[],
  operationMetadata: EmitterContext['operationMetadata'] = [],
): SchemaDependencyModel {
  if (!Array.isArray(models)) throw new TypeError('Normalized models must be an array');
  if (!Array.isArray(operations)) throw new TypeError('Normalized operations must be an array');
  if (!Array.isArray(operationMetadata)) {
    throw new TypeError('Resolved operation metadata must be an array');
  }

  const { modelsByName, modelsByPointer } = indexModels(models);
  const directByName = new Map<string, readonly string[]>();
  for (const model of modelsByName.values()) {
    directByName.set(
      model.name,
      resolveSchemaReferences(model.schema, model.pointer, modelsByPointer).map(
        ({ model: dependency }) => dependency.name,
      ),
    );
  }

  const closureState: ModelClosureState = {
    active: [],
    closures: new Map(),
    directByName,
    modelsByName,
  };

  const modelEntries = [...modelsByName.values()]
    .toSorted((left, right) => compareText(left.name, right.name))
    .map((model) => ({
      dependencies: Object.freeze(resolveModelClosure(model.name, closureState)),
      directDependencies: Object.freeze(
        [...(directByName.get(model.name) ?? [])].toSorted(compareText),
      ),
      fileName: schemaFileName(model.name),
      model,
    }));
  assertUniqueFileNames(modelEntries, 'model');

  const metadataById = indexOperationMetadata(operationMetadata);

  const operationNames = new Map<string, string>();
  const operationEntries = operations
    .map((operation, index) =>
      createOperationDependencyEntry(
        operation,
        index,
        modelsByPointer,
        closureState,
        operationNames,
        metadataById,
        operationMetadata.length > 0,
      ),
    )
    .toSorted((left, right) =>
      compareText(left.operation.operationId, right.operation.operationId),
    );
  if (operationMetadata.length > 0 && metadataById.size !== operationEntries.length) {
    const operationIds = new Set(operationEntries.map(({ operation }) => operation.operationId));
    const stale = [...metadataById.keys()].filter((operationId) => !operationIds.has(operationId));
    throw new Error(`Stale resolved operation metadata: ${stale.toSorted(compareText).join(', ')}`);
  }

  const domains = createDomainDependencyEntries(operationEntries);
  assertUniqueFileNames(domains, 'operation schema domain');

  return Object.freeze({
    domains: Object.freeze(domains),
    models: Object.freeze(modelEntries),
    operations: Object.freeze(operationEntries),
  });
}

function resolveModelClosure(name: string, state: ModelClosureState): readonly string[] {
  const existing = state.closures.get(name);
  if (existing !== undefined) return existing;
  const cycleStart = state.active.indexOf(name);
  if (cycleStart >= 0) {
    throw new ZodSchemaEmissionError(
      `Recursive component references are unsupported: ${[...state.active.slice(cycleStart), name].join(' -> ')}`,
      state.modelsByName.get(name)?.pointer ?? '#/components/schemas',
    );
  }
  state.active.push(name);
  const closure = new Set<string>();
  for (const dependency of state.directByName.get(name) ?? []) {
    closure.add(dependency);
    for (const transitive of resolveModelClosure(dependency, state)) closure.add(transitive);
  }
  state.active.pop();
  const result = [...closure].toSorted(compareText);
  state.closures.set(name, result);
  return result;
}

function indexOperationMetadata(
  operationMetadata: readonly unknown[],
): Map<string, ResolvedOperationMetadata> {
  const metadataById = new Map<string, ResolvedOperationMetadata>();
  for (const metadata of operationMetadata) {
    if (
      !isObject(metadata) ||
      typeof metadata.operationId !== 'string' ||
      typeof metadata.domain !== 'string'
    ) {
      throw new TypeError('Resolved operation metadata entry is invalid');
    }
    if (metadataById.has(metadata.operationId)) {
      throw new Error(`Duplicate resolved operation metadata: ${metadata.operationId}`);
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- operationId/domain are validated above; the rest is trusted like the prior untyped implementation
    metadataById.set(metadata.operationId, metadata as unknown as ResolvedOperationMetadata);
  }
  return metadataById;
}

function createOperationDependencyEntry(
  operation: NormalizedOperation,
  index: number,
  modelsByPointer: Map<string, NormalizedModel>,
  closureState: ModelClosureState,
  operationNames: Map<string, string>,
  metadataById: Map<string, ResolvedOperationMetadata>,
  requiresMetadata: boolean,
): {
  dependencies: readonly string[];
  directDependencies: readonly string[];
  domain: string | null;
  operation: NormalizedOperation;
} {
  if (!isObject(operation) || typeof operation.operationId !== 'string') {
    throw new ZodSchemaEmissionError(
      'Operation must contain an operation ID',
      `operations/${index}`,
    );
  }
  const schemaName = operationSchemaName(operation.operationId);
  const previous = operationNames.get(schemaName);
  if (previous !== undefined) {
    throw new ZodSchemaEmissionError(
      `Operation schema name collision ${schemaName}: ${previous} and ${operation.operationId}`,
      `operations/${index}`,
    );
  }
  operationNames.set(schemaName, operation.operationId);
  const direct = resolveOperationReferences(operation, modelsByPointer);
  const dependencies = new Set<string>();
  for (const dependency of direct) {
    dependencies.add(dependency.name);
    for (const transitive of resolveModelClosure(dependency.name, closureState))
      dependencies.add(transitive);
  }
  const metadata = metadataById.get(operation.operationId);
  if (requiresMetadata && metadata === undefined) {
    throw new Error(`Missing resolved operation metadata: ${operation.operationId}`);
  }
  return {
    dependencies: Object.freeze([...dependencies].toSorted(compareText)),
    directDependencies: Object.freeze(direct.map(({ name }) => name).toSorted(compareText)),
    domain: metadata?.domain ?? null,
    operation,
  };
}

function createDomainDependencyEntries(
  operationEntries: readonly {
    readonly dependencies: readonly string[];
    readonly domain: string | null;
    readonly operation: NormalizedOperation;
  }[],
): {
  readonly dependencies: readonly string[];
  readonly domain: string;
  readonly fileName: string;
  readonly operations: readonly NormalizedOperation[];
}[] {
  const domainsByName = new Map<
    string,
    { dependencies: Set<string>; operations: NormalizedOperation[] }
  >();
  for (const entry of operationEntries) {
    if (entry.domain === null) continue;
    const domain = domainsByName.get(entry.domain) ?? { dependencies: new Set(), operations: [] };
    domain.operations.push(entry.operation);
    for (const dependency of entry.dependencies) domain.dependencies.add(dependency);
    domainsByName.set(entry.domain, domain);
  }
  return [...domainsByName]
    .toSorted(([left], [right]) => compareText(left, right))
    .map(([domain, entry]) => ({
      dependencies: Object.freeze([...entry.dependencies].toSorted(compareText)),
      domain,
      fileName: schemaFileName(domain),
      operations: Object.freeze(
        entry.operations.toSorted((left, right) =>
          compareText(left.operationId, right.operationId),
        ),
      ),
    }));
}

export function renderZodModelSchemaModule(
  models: readonly NormalizedModel[],
  provenance: ArtifactProvenance,
): string {
  if (!Array.isArray(models)) throw new TypeError('Normalized models must be an array');

  const { modelsByName, modelsByPointer } = indexModels(models);

  const references = Object.fromEntries(
    [...modelsByPointer]
      .toSorted(([left], [right]) => compareText(left, right))
      .map(([pointer, model]) => [pointer, `${model.name}Schema`]),
  );
  const typeReferences = Object.fromEntries(
    [...modelsByPointer]
      .toSorted(([left], [right]) => compareText(left, right))
      .map(([pointer, model]) => [pointer, { input: `${model.name}Input`, output: model.name }]),
  );
  const dependencies = new Map<string, readonly { name: string; path: string }[]>();
  for (const model of modelsByName.values()) {
    const found: CollectedReference[] = [];
    collectReferences(model.schema, model.pointer, found);
    const resolved = found.map(({ path, reference }) => {
      const target = modelsByPointer.get(reference);
      if (target === undefined) {
        throw new ZodSchemaEmissionError(
          `Unresolved local component reference ${JSON.stringify(reference)}`,
          path,
        );
      }
      return { name: target.name, path };
    });
    dependencies.set(
      model.name,
      resolved.toSorted((left, right) => compareText(left.name, right.name)),
    );
  }

  const orderedModels = topologicallyOrderModels(modelsByName, dependencies);
  const state: ReferenceEmitState = {
    helpers: new Set(),
    references: normalizeReferenceNames(references, '#'),
  };
  const typeState: TypeEmitState = { references: normalizeTypeReferenceNames(typeReferences, '#') };
  const declarations = orderedModels.map((model) => {
    const expression = emitSchema(model.schema, model.pointer, state);
    const input = emitSchemaType(model.schema, model.pointer, typeState, 'input');
    const output = emitSchemaType(model.schema, model.pointer, typeState, 'output');
    return `type ${model.name}SchemaInput = ${input};
type ${model.name}SchemaOutput = ${output};

export const ${model.name}Schema: z.ZodType<${model.name}SchemaOutput, ${model.name}SchemaInput> = ${expression};
export type ${model.name}Input = z.input<typeof ${model.name}Schema>;
export type ${model.name} = z.output<typeof ${model.name}Schema>;

type ${model.name}InputAssertion = Assert<IsExact<${model.name}Input, ${model.name}SchemaInput>>;
type ${model.name}OutputAssertion = Assert<IsExact<${model.name}, ${model.name}SchemaOutput>>;`;
  });
  const helperSource = state.helpers.has('unique-array') ? renderUniqueArrayHelper() : '';
  const body = [
    "import { z } from 'zod';",
    renderTypeAssertionHelpers(),
    helperSource,
    ...declarations,
  ]
    .filter((section) => section.length > 0)
    .join('\n\n');
  return `${createProvenanceHeader(provenance, 'typescript')}\n${body}\n`;
}

export function renderZodModelDependencyModule(
  model: NormalizedModel,
  models: readonly NormalizedModel[],
  provenance: ArtifactProvenance,
): string {
  if (!isObject(model)) throw new TypeError('Normalized model must be an object');
  const dependencyModel = createSchemaDependencyModel(models, [], []);
  const entry = dependencyModel.models.find(
    (candidate) => candidate.model.pointer === model.pointer,
  );
  if (entry === undefined) throw new Error(`Unknown normalized model: ${model.name}`);
  const { modelsByPointer } = indexModels(models);
  const references = Object.fromEntries(
    [...modelsByPointer].map(([pointer, candidate]) => [pointer, `${candidate.name}Schema`]),
  );
  const typeReferences = Object.fromEntries(
    [...modelsByPointer].map(([pointer, candidate]) => [
      pointer,
      { input: `${candidate.name}Input`, output: candidate.name },
    ]),
  );
  const state: ReferenceEmitState = {
    helpers: new Set(),
    references: normalizeReferenceNames(references, '#'),
  };
  const typeState: TypeEmitState = { references: normalizeTypeReferenceNames(typeReferences, '#') };
  const expression = emitSchema(model.schema, model.pointer, state);
  const input = emitSchemaType(model.schema, model.pointer, typeState, 'input');
  const output = emitSchemaType(model.schema, model.pointer, typeState, 'output');
  const imports = entry.directDependencies.map((name) => {
    const dependency = dependencyModel.models.find((candidate) => candidate.model.name === name);
    if (dependency === undefined) throw new Error(`Unresolved model dependency: ${name}`);
    return `import {\n  ${name}Schema,\n  type ${name},\n  type ${name}Input,\n} from './${dependency.fileName}.js';`;
  });
  const helperSource = state.helpers.has('unique-array') ? renderUniqueArrayHelper() : '';
  const body = [
    "import { z } from 'zod';",
    ...imports,
    renderTypeAssertionHelpers(),
    helperSource,
    `type ${model.name}SchemaInput = ${input};
type ${model.name}SchemaOutput = ${output};

export const ${model.name}Schema: z.ZodType<${model.name}SchemaOutput, ${model.name}SchemaInput> = ${expression};
export type ${model.name}Input = z.input<typeof ${model.name}Schema>;
export type ${model.name} = z.output<typeof ${model.name}Schema>;

type ${model.name}InputAssertion = Assert<IsExact<${model.name}Input, ${model.name}SchemaInput>>;
type ${model.name}OutputAssertion = Assert<IsExact<${model.name}, ${model.name}SchemaOutput>>;`,
  ]
    .filter((section) => section.length > 0)
    .join('\n\n');
  return `${createProvenanceHeader(provenance, 'typescript')}\n${body}\n`;
}

export function renderZodOperationSchemaModule(
  operations: readonly NormalizedOperation[],
  models: readonly NormalizedModel[],
  provenance: ArtifactProvenance,
  modelModulePrefix = './models',
): string {
  if (!Array.isArray(operations)) throw new TypeError('Normalized operations must be an array');
  if (!Array.isArray(models)) throw new TypeError('Normalized models must be an array');

  const { modelsByPointer } = indexModels(models);
  const usedModels = resolveOperationsModelClosure(operations, models);
  const usedPointers = new Set(usedModels.map(({ pointer }) => pointer));
  const references = Object.fromEntries(
    [...modelsByPointer]
      .filter(([pointer]) => usedPointers.has(pointer))
      .toSorted(([left], [right]) => compareText(left, right))
      .map(([pointer, model]) => [pointer, `${model.name}Schema`]),
  );
  const typeReferences = Object.fromEntries(
    [...modelsByPointer]
      .filter(([pointer]) => usedPointers.has(pointer))
      .toSorted(([left], [right]) => compareText(left, right))
      .map(([pointer, model]) => [pointer, { input: `${model.name}Input`, output: model.name }]),
  );
  const operationNames = new Map<string, string>();
  const operationsById = new Map<string, NormalizedOperation>();
  for (const [index, operation] of operations.entries()) {
    const path = `operations/${index}`;
    if (!isRecordLike(operation))
      throw new ZodSchemaEmissionError('Operation must be an object', path);
    if (
      typeof operation.operationId !== 'string' ||
      operation.operationId.length === 0 ||
      operation.operationId.trim() !== operation.operationId
    ) {
      throw new ZodSchemaEmissionError('Operation ID must be a non-empty trimmed string', path);
    }
    if (operationsById.has(operation.operationId)) {
      throw new ZodSchemaEmissionError(`Duplicate operation ID ${operation.operationId}`, path);
    }
    const schemaName = operationSchemaName(operation.operationId);
    const collidingOperation = operationNames.get(schemaName);
    if (collidingOperation !== undefined) {
      throw new ZodSchemaEmissionError(
        `Operation schema name collision ${schemaName}: ${collidingOperation} and ${operation.operationId}`,
        path,
      );
    }
    operationNames.set(schemaName, operation.operationId);
    operationsById.set(operation.operationId, operation);
  }

  const state: ReferenceEmitState = {
    helpers: new Set(),
    references: normalizeReferenceNames(references, '#'),
  };
  const typeState: TypeEmitState = { references: normalizeTypeReferenceNames(typeReferences, '#') };
  const declarations: string[] = [];
  for (const operation of [...operationsById.values()].toSorted((left, right) =>
    compareText(left.operationId, right.operationId),
  )) {
    const name = operationSchemaName(operation.operationId);
    const path = `operations/${escapePointerSegment(operation.operationId)}`;
    const requestExpression = emitOperationRequestSchema(operation, path, state);
    const requestInput = emitOperationRequestType(operation, path, typeState, 'input');
    const requestOutput = emitOperationRequestType(operation, path, typeState, 'output');
    declarations.push(
      `type ${name}RequestSchemaInput = ${requestInput};
type ${name}RequestSchemaOutput = ${requestOutput};

export const ${name}RequestSchema: z.ZodType<${name}RequestSchemaOutput, ${name}RequestSchemaInput> = ${requestExpression};`,
      ...emitOperationResponseSchemas(operation, name, path, state, typeState),
      `export type ${name}Input = z.input<typeof ${name}RequestSchema>;
export type ${name}Output = z.output<typeof ${name}SuccessResponseSchema>;

type ${name}InputAssertion = Assert<IsExact<${name}Input, ${name}RequestSchemaInput>>;
type ${name}OutputAssertion = Assert<IsExact<${name}Output, ${name}SuccessResponseSchemaOutput>>;`,
    );
  }

  const imports = usedModels.map(({ name }) => `${name}Schema`).toSorted(compareText);
  const modelImport = renderOperationModelImport(imports, modelModulePrefix);
  const helperSource = state.helpers.has('unique-array') ? renderUniqueArrayHelper() : '';
  const body = [
    "import { z } from 'zod';",
    modelImport,
    renderTypeAssertionHelpers(),
    helperSource,
    ...declarations,
  ]
    .filter((section) => section.length > 0)
    .join('\n\n');
  return `${createProvenanceHeader(provenance, 'typescript')}\n${body}\n`;
}

function renderOperationModelImport(imports: readonly string[], modelModulePrefix: string): string {
  if (imports.length === 0) return '';
  if (modelModulePrefix.endsWith('/')) {
    return imports
      .map((name) => {
        const typeName = name.slice(0, -'Schema'.length);
        return `import {\n  ${name},\n  type ${typeName},\n  type ${typeName}Input,\n} from '${modelModulePrefix}${schemaFileName(typeName)}.js';`;
      })
      .join('\n');
  }
  const specifiers = imports.flatMap((name) => [
    `  ${name},`,
    `  type ${name.slice(0, -'Schema'.length)},`,
    `  type ${name.slice(0, -'Schema'.length)}Input,`,
  ]);
  return `import {\n${specifiers.join('\n')}\n} from '${modelModulePrefix}.js';`;
}

export function renderZodSchemaContractsModule(
  operations: readonly NormalizedOperation[],
  operationMetadata: EmitterContext['operationMetadata'],
  provenance: ArtifactProvenance,
): string {
  if (!Array.isArray(operations)) throw new TypeError('Normalized operations must be an array');
  if (!Array.isArray(operationMetadata)) {
    throw new TypeError('Resolved operation metadata must be an array');
  }

  const operationsById = new Map(operations.map((operation) => [operation.operationId, operation]));
  const metadataById = new Map<string, ResolvedOperationMetadata>();
  for (const metadata of operationMetadata as readonly unknown[]) {
    if (!isObject(metadata) || typeof metadata.operationId !== 'string') {
      throw new TypeError('Resolved operation metadata entry must contain an operation ID');
    }
    if (metadataById.has(metadata.operationId)) {
      throw new Error(`Duplicate resolved operation metadata: ${metadata.operationId}`);
    }
    if (!operationsById.has(metadata.operationId)) {
      throw new Error(`Stale resolved operation metadata: ${metadata.operationId}`);
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- operationId/domain are validated above; the rest is trusted like the prior untyped implementation
    metadataById.set(metadata.operationId, metadata as unknown as ResolvedOperationMetadata);
  }
  if (metadataById.size !== operationsById.size) {
    throw new Error('Resolved operation metadata does not cover every operation schema');
  }

  const orderedMetadata = [...metadataById.values()].toSorted((left, right) =>
    compareText(left.operationId, right.operationId),
  );
  const importedTypes = orderedMetadata.flatMap(({ operationId }) => {
    const name = operationSchemaName(operationId);
    return [`${name}Input`, `${name}Output`];
  });
  const operationLines = orderedMetadata.map(({ operationId }) => {
    const name = operationSchemaName(operationId);
    return `  readonly ${JSON.stringify(operationId)}: OperationTypeContract<${name}Input, ${name}Output>;`;
  });
  const domains = new Map<string, ResolvedOperationMetadata[]>();
  for (const metadata of orderedMetadata) {
    const methods = domains.get(metadata.domain) ?? [];
    methods.push(metadata);
    domains.set(metadata.domain, methods);
  }
  const domainLines = [...domains]
    .toSorted(([left], [right]) => compareText(left, right))
    .map(
      ([domain, entries]) => `  readonly ${JSON.stringify(domain)}: {
${entries
  .toSorted((left, right) => compareText(left.method, right.method))
  .map(
    ({ method, operationId }) =>
      `    readonly ${JSON.stringify(method)}: GeneratedOperationSignatures[${JSON.stringify(operationId)}];`,
  )
  .join('\n')}
  };`,
    );
  const typeImport =
    importedTypes.length === 0
      ? ''
      : `import type {\n  ${importedTypes.toSorted(compareText).join(',\n  ')},\n} from './operations.js';`;
  const body = [
    typeImport,
    `export interface OperationTypeContract<Input, Output> {
  readonly input: Input;
  readonly output: Output;
}`,
    `export interface GeneratedOperationSignatures {
${operationLines.join('\n')}
}`,
    `export interface GeneratedDomainSignatures {
${domainLines.join('\n')}
}`,
    `export type AssertGeneratedOperationSignatures<
  Actual extends GeneratedOperationSignatures,
> = Actual;

export type AssertGeneratedOperationSignature<
  OperationId extends keyof GeneratedOperationSignatures,
  Actual extends GeneratedOperationSignatures[OperationId],
> = Actual;

export type AssertGeneratedDomainSignatures<Actual extends GeneratedDomainSignatures> = Actual;

export type AssertGeneratedDomainSignature<
  Domain extends keyof GeneratedDomainSignatures,
  Method extends keyof GeneratedDomainSignatures[Domain],
  Actual extends GeneratedDomainSignatures[Domain][Method],
> = Actual;`,
  ]
    .filter((section) => section.length > 0)
    .join('\n\n');
  return `${createProvenanceHeader(provenance, 'typescript')}\n${body}\n`;
}

export async function emitZodSchemaSource(
  context: EmitterContext,
  sourceDirectory: string,
): Promise<readonly string[]> {
  if (!isObject(context) || !isObject(context.normalizedModel)) {
    throw new TypeError('Zod schema source context must contain a normalized model');
  }
  if (typeof sourceDirectory !== 'string' || sourceDirectory.length === 0) {
    throw new TypeError('Zod schema source directory must be a non-empty string');
  }
  const schemaDirectory = join(sourceDirectory, 'schemas');
  const modelDirectory = join(schemaDirectory, 'models');
  const operationDirectory = join(schemaDirectory, 'operations');
  await Promise.all([
    mkdir(modelDirectory, { recursive: true }),
    mkdir(operationDirectory, { recursive: true }),
  ]);
  const dependencyModel = createSchemaDependencyModel(
    context.normalizedModel.models,
    context.normalizedModel.operations,
    context.operationMetadata,
  );
  const writes = [
    writeFile(
      join(schemaDirectory, 'models.ts'),
      renderGeneratedBarrel(
        dependencyModel.models.map(({ fileName }) => `./models/${fileName}.js`),
        context.provenance,
      ),
    ),
    writeFile(
      join(schemaDirectory, 'operations.ts'),
      renderGeneratedBarrel(
        dependencyModel.domains.map(({ fileName }) => `./operations/${fileName}.js`),
        context.provenance,
      ),
    ),
    writeFile(
      join(schemaDirectory, 'contracts.ts'),
      renderZodSchemaContractsModule(
        context.normalizedModel.operations,
        context.operationMetadata,
        context.provenance,
      ),
    ),
    writeFile(
      join(schemaDirectory, 'index.ts'),
      renderGeneratedBarrel(
        ['./contracts.js', './models.js', './operations.js'],
        context.provenance,
      ),
    ),
  ];
  const outputs = [
    'schemas/contracts.ts',
    'schemas/index.ts',
    'schemas/models.ts',
    'schemas/operations.ts',
  ];
  for (const entry of dependencyModel.models) {
    const path = `schemas/models/${entry.fileName}.ts`;
    outputs.push(path);
    writes.push(
      writeFile(
        join(sourceDirectory, path),
        renderZodModelDependencyModule(
          entry.model,
          context.normalizedModel.models,
          context.provenance,
        ),
      ),
    );
  }
  for (const entry of dependencyModel.domains) {
    const path = `schemas/operations/${entry.fileName}.ts`;
    outputs.push(path);
    writes.push(
      writeFile(
        join(sourceDirectory, path),
        renderZodOperationSchemaModule(
          entry.operations,
          context.normalizedModel.models,
          context.provenance,
          '../models/',
        ),
      ),
    );
  }
  validateGranularSchemaExports(dependencyModel);
  await Promise.all(writes);
  return outputs.toSorted(compareText);
}

export const zodSchemaSourceComponent: GeneratedSourceComponent = Object.freeze({
  name: 'zod-schemas',
  emit: emitZodSchemaSource,
});

function emitOperationRequestSchema(
  operation: NormalizedOperation,
  path: string,
  state: ReferenceEmitState,
): string {
  if (!Array.isArray(operation.parameters)) {
    throw new ZodSchemaEmissionError(
      'Operation parameters must be an array',
      joinPointer(path, 'parameters'),
    );
  }
  const properties: string[] = [];
  for (const placement of ['path', 'query', 'header', 'cookie'] as const) {
    const parameters = operation.parameters.filter(
      (parameter) => parameter.placement === placement && !isTransportManagedParameter(parameter),
    );
    if (parameters.length === 0) continue;
    const seen = new Set<string>();
    const fields = parameters
      .toSorted((left, right) => compareText(left.name, right.name))
      .map((parameter) =>
        emitOperationParameterSchemaField(parameter, placement, seen, path, state),
      );
    let group = `z.strictObject({\n${fields.join('\n')}\n  })`;
    if (!parameters.some(({ required }) => required === true)) group += '.optional()';
    properties.push(`  ${JSON.stringify(placement)}: ${group},`);
  }

  if (operation.requestBody !== null && operation.requestBody !== undefined) {
    if (!isObject(operation.requestBody)) {
      throw new ZodSchemaEmissionError(
        'Request body must be an object or null',
        joinPointer(path, 'requestBody'),
      );
    }
    const content = selectJsonContent(
      operation.requestBody.content,
      joinPointer(joinPointer(path, 'requestBody'), 'content'),
    );
    let body = emitSchema(
      content.schema,
      joinPointer(joinPointer(joinPointer(path, 'requestBody'), 'content'), content.mediaType),
      state,
    );
    if (!operation.requestBody.required) body += '.optional()';
    properties.push(`  "body": ${body},`);
  }

  const propertyBlock = properties.length === 0 ? '' : `\n${properties.join('\n')}\n`;
  return `z.strictObject({${propertyBlock}})`;
}

function emitOperationParameterSchemaField(
  parameter: NormalizedOperation['parameters'][number],
  placement: NormalizedOperation['parameters'][number]['placement'],
  seen: Set<string>,
  path: string,
  state: ReferenceEmitState,
): string {
  if (!isObject(parameter) || typeof parameter.name !== 'string' || parameter.name.length === 0) {
    throw new ZodSchemaEmissionError(
      'Operation parameter must have a non-empty name',
      joinPointer(path, 'parameters'),
    );
  }
  if (seen.has(parameter.name)) {
    throw new ZodSchemaEmissionError(
      `Duplicate ${placement} parameter ${parameter.name}`,
      joinPointer(path, 'parameters'),
    );
  }
  seen.add(parameter.name);
  let expression = emitSchema(
    parameter.schema,
    joinPointer(joinPointer(path, 'parameters'), `${placement}:${parameter.name}`),
    state,
  );
  if (!Object.is(parameter.required, true)) expression += '.optional()';
  return `    ${JSON.stringify(parameter.name)}: ${expression},`;
}

function emitOperationRequestType(
  operation: NormalizedOperation,
  path: string,
  state: TypeEmitState,
  direction: SchemaDirection,
): string {
  const properties: string[] = [];
  for (const placement of ['path', 'query', 'header', 'cookie'] as const) {
    const property = emitOperationRequestTypeGroup(
      operation.parameters,
      placement,
      path,
      state,
      direction,
    );
    if (property !== null) properties.push(property);
  }
  if (operation.requestBody !== null && operation.requestBody !== undefined) {
    const content = selectJsonContent(
      operation.requestBody.content,
      joinPointer(joinPointer(path, 'requestBody'), 'content'),
    );
    const type = emitSchemaType(
      content.schema,
      joinPointer(joinPointer(joinPointer(path, 'requestBody'), 'content'), content.mediaType),
      state,
      direction,
    );
    const optional = operation.requestBody.required ? '' : '?';
    properties.push(`  "body"${optional}: ${type}${optional ? ' | undefined' : ''};`);
  }
  const propertyBlock = properties.length === 0 ? '' : `\n${properties.join('\n')}\n`;
  return `{${propertyBlock}}`;
}

function emitOperationRequestTypeGroup(
  operationParameters: NormalizedOperation['parameters'],
  placement: NormalizedOperation['parameters'][number]['placement'],
  path: string,
  state: TypeEmitState,
  direction: SchemaDirection,
): string | null {
  const parameters = operationParameters.filter(
    (parameter) => parameter.placement === placement && !isTransportManagedParameter(parameter),
  );
  if (parameters.length === 0) return null;
  const fields = parameters
    .toSorted((left, right) => compareText(left.name, right.name))
    .map((parameter) => {
      const type = emitSchemaType(
        parameter.schema,
        joinPointer(joinPointer(path, 'parameters'), `${placement}:${parameter.name}`),
        state,
        direction,
      );
      return `    ${JSON.stringify(parameter.name)}${parameter.required ? '' : '?'}: ${type}${parameter.required ? '' : ' | undefined'};`;
    });
  const optional = parameters.some(({ required }) => required) ? '' : '?';
  return `  ${JSON.stringify(placement)}${optional}: {\n${fields.join('\n')}\n  }${optional ? ' | undefined' : ''};`;
}

interface EmittedResponse {
  readonly declarationName: string;
  readonly expression: string;
  readonly inputType: string;
  readonly outputType: string;
  readonly response: NormalizedOperation['successResponses'][number];
  readonly signature: string;
}

function emitOperationResponseSchemas(
  operation: NormalizedOperation,
  name: string,
  path: string,
  state: ReferenceEmitState,
  typeState: TypeEmitState,
): string[] {
  if (!Array.isArray(operation.successResponses) || operation.successResponses.length === 0) {
    throw new ZodSchemaEmissionError(
      'Operation must have at least one success response',
      joinPointer(path, 'successResponses'),
    );
  }

  const responses = operation.successResponses.toSorted((left, right) =>
    compareStatusCodes(left.status, right.status),
  );
  const seenStatuses = new Set<string>();
  const emitted = responses.map((response, index) =>
    emitOperationResponseSchema(response, index, name, path, state, typeState, seenStatuses),
  );

  const declarations = emitted.map(
    ({ declarationName, expression, inputType, outputType }) =>
      `export const ${declarationName}: z.ZodType<${outputType}, ${inputType}> = ${expression};`,
  );
  declarations.push(
    `export const ${name}SuccessResponseSchemasByStatus: Readonly<{\n${emitted
      .map(
        ({ declarationName, response }) =>
          `  ${JSON.stringify(response.status)}: typeof ${declarationName};`,
      )
      .join('\n')}\n}> = {\n${emitted
      .map(
        ({ declarationName, response }) =>
          `  ${JSON.stringify(response.status)}: ${declarationName},`,
      )
      .join('\n')}\n};`,
  );
  const uniqueSignatures = new Set(emitted.map(({ signature }) => signature));
  const aggregateInput = [...new Set(emitted.map(({ inputType }) => inputType))].join(' | ');
  const aggregateOutput = [...new Set(emitted.map(({ outputType }) => outputType))].join(' | ');
  const aggregate =
    uniqueSignatures.size === 1
      ? emitted[0].declarationName
      : `z.union([${emitted.map(({ declarationName }) => declarationName).join(', ')}])`;
  declarations.push(`type ${name}SuccessResponseSchemaInput = ${aggregateInput};
type ${name}SuccessResponseSchemaOutput = ${aggregateOutput};

export const ${name}SuccessResponseSchema: z.ZodType<${name}SuccessResponseSchemaOutput, ${name}SuccessResponseSchemaInput> = ${aggregate};`);
  return declarations;
}

function emitOperationResponseSchema(
  response: NormalizedOperation['successResponses'][number],
  index: number,
  name: string,
  path: string,
  state: ReferenceEmitState,
  typeState: TypeEmitState,
  seenStatuses: Set<string>,
): EmittedResponse {
  const responsePath = joinPointer(joinPointer(path, 'successResponses'), String(index));
  if (
    !isRecordLike(response) ||
    typeof response.status !== 'string' ||
    !/^2(?:\d{2}|XX)$/u.test(response.status)
  ) {
    throw new ZodSchemaEmissionError('Invalid success response status', responsePath);
  }
  if (seenStatuses.has(response.status)) {
    throw new ZodSchemaEmissionError(
      `Duplicate success response status ${response.status}`,
      responsePath,
    );
  }
  seenStatuses.add(response.status);
  if (response.status !== '2XX' && seenStatuses.has('2XX')) {
    throw new ZodSchemaEmissionError(
      `Success response status ${response.status} overlaps 2XX`,
      responsePath,
    );
  }
  if (response.status === '2XX' && seenStatuses.size > 1) {
    throw new ZodSchemaEmissionError(
      'Success response status 2XX overlaps an exact status',
      responsePath,
    );
  }

  let expression: string;
  let signature: string;
  let inputType: string;
  let outputType: string;
  if (Object.is(response.noContent, true)) {
    if (!Array.isArray(response.content) || response.content.length !== 0) {
      throw new ZodSchemaEmissionError(
        'No-content success response must not declare content',
        joinPointer(responsePath, 'content'),
      );
    }
    expression = 'z.undefined()';
    signature = 'undefined';
    inputType = 'undefined';
    outputType = 'undefined';
  } else {
    const content = selectJsonContent(response.content, joinPointer(responsePath, 'content'));
    expression = emitSchema(
      content.schema,
      joinPointer(joinPointer(responsePath, 'content'), content.mediaType),
      state,
    );
    signature = canonicalSchemaJson(content.schema);
    inputType = emitSchemaType(
      content.schema,
      joinPointer(joinPointer(responsePath, 'content'), content.mediaType),
      typeState,
      'input',
    );
    outputType = emitSchemaType(
      content.schema,
      joinPointer(joinPointer(responsePath, 'content'), content.mediaType),
      typeState,
      'output',
    );
  }
  const declarationName = `${name}Status${statusIdentifier(response.status)}SuccessResponseSchema`;
  return { declarationName, expression, inputType, outputType, response, signature };
}

function selectJsonContent(
  content: unknown,
  path: string,
): { readonly mediaType: string; readonly schema: NormalizedSchema } {
  if (!Array.isArray(content) || content.length === 0) {
    throw new ZodSchemaEmissionError('Content must contain a JSON representation', path);
  }
  const jsonContent = content
    .filter(
      (entry) =>
        isObject(entry) &&
        typeof entry.mediaType === 'string' &&
        /^application\/(?:[A-Z0-9!#$&^_.+-]+\+)?json(?:\s*;.*)?$/iu.test(entry.mediaType),
    )
    .toSorted((left, right) => {
      const leftExact = left.mediaType.toLowerCase() === 'application/json' ? 0 : 1;
      const rightExact = right.mediaType.toLowerCase() === 'application/json' ? 0 : 1;
      return leftExact - rightExact || compareText(left.mediaType, right.mediaType);
    });
  if (jsonContent.length === 0) {
    throw new ZodSchemaEmissionError('Content has no JSON representation', path);
  }
  const signatures = new Set(jsonContent.map(({ schema }) => canonicalSchemaJson(schema)));
  if (signatures.size !== 1) {
    throw new ZodSchemaEmissionError(
      `JSON representations have incompatible schemas: ${jsonContent
        .map(({ mediaType }) => mediaType)
        .join(', ')}`,
      path,
    );
  }
  return jsonContent[0];
}

export function operationSchemaName(operationId: string): string {
  const words = operationId
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean);
  let identifier = words
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join('');
  if (identifier === '') identifier = 'Operation';
  if (!/^[A-Za-z_$]/u.test(identifier)) identifier = `Operation${identifier}`;
  return identifier;
}

export function operationStatusResponseSchemaName(operationId: string, status: string): string {
  return `${operationSchemaName(operationId)}Status${statusIdentifier(status)}SuccessResponseSchema`;
}

function statusIdentifier(status: string): string {
  return status === '2XX' ? '2xx' : status;
}

function compareStatusCodes(left: string, right: string): number {
  const leftNumber = /^\d{3}$/u.test(left) ? Number(left) : Number.POSITIVE_INFINITY;
  const rightNumber = /^\d{3}$/u.test(right) ? Number(right) : Number.POSITIVE_INFINITY;
  return leftNumber - rightNumber || compareText(left, right);
}

function canonicalSchemaJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSchemaJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .toSorted(compareText)
      .map((key) => `${JSON.stringify(key)}:${canonicalSchemaJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function indexModels(models: readonly NormalizedModel[]): ModelIndex {
  const modelsByName = new Map<string, NormalizedModel>();
  const modelsByPointer = new Map<string, NormalizedModel>();
  for (const [index, model] of models.entries()) {
    const path = `models/${index}`;
    if (!isObject(model)) throw new ZodSchemaEmissionError('Model must be an object', path);
    if (typeof model.name !== 'string' || !identifierPattern.test(model.name)) {
      throw new ZodSchemaEmissionError(`Invalid model name ${JSON.stringify(model.name)}`, path);
    }
    if (typeof model.pointer !== 'string' || !model.pointer.startsWith('#/components/schemas/')) {
      throw new ZodSchemaEmissionError(
        `Invalid local component pointer ${JSON.stringify(model.pointer)}`,
        joinPointer(path, 'pointer'),
      );
    }
    if (modelsByName.has(model.name)) {
      throw new ZodSchemaEmissionError(`Duplicate model name ${model.name}`, path);
    }
    if (modelsByPointer.has(model.pointer)) {
      throw new ZodSchemaEmissionError(`Duplicate model pointer ${model.pointer}`, path);
    }
    modelsByName.set(model.name, model);
    modelsByPointer.set(model.pointer, model);
  }
  return { modelsByName, modelsByPointer };
}

function emitSchema(schema: unknown, path: string, state: ReferenceEmitState): string {
  if (typeof schema === 'boolean') {
    throw new ZodSchemaEmissionError(
      `Boolean schema ${schema} is unsupported because it cannot be emitted without a catch-all`,
      path,
    );
  }
  if (!isObject(schema)) throw new ZodSchemaEmissionError('Schema must be an object', path);
  validateKeywords(schema, path);

  const parsedType = parseSchemaType(schema.type, joinPointer(path, 'type'));
  validateKeywordTypes(schema, parsedType.type, path);
  const nullable = parseNullable(schema.nullable, joinPointer(path, 'nullable'));
  validateNullableCombination(nullable, parsedType, path);

  const clauses: string[] = [];
  appendReferenceClause(schema, path, state, clauses);
  if (parsedType.type !== null) clauses.push(emitType(schema, parsedType.type, path, state));
  if (schema.const !== undefined) clauses.push(emitConst(schema.const, joinPointer(path, 'const')));
  if (schema.enum !== undefined) clauses.push(emitEnum(schema.enum, joinPointer(path, 'enum')));
  appendCompositionClauses(schema, path, state, clauses);

  if (clauses.length === 0) {
    return 'z.json()';
  }
  let expression = clauses
    .slice(1)
    .reduce((left, right) => `z.intersection(${left}, ${right})`, clauses[0]);
  if (nullable || parsedType.nullable) expression = `${expression}.nullable()`;
  return expression;
}

interface ParsedSchemaType {
  readonly nullable: boolean;
  readonly type: string | null;
}

function validateNullableCombination(
  nullable: boolean,
  parsedType: ParsedSchemaType,
  path: string,
): void {
  if (nullable && (parsedType.nullable || parsedType.type === 'null')) {
    throw new ZodSchemaEmissionError(
      'nullable cannot be combined with an already nullable type',
      joinPointer(path, 'nullable'),
    );
  }
}

function appendReferenceClause(
  schema: Record<string, unknown>,
  path: string,
  state: ReferenceEmitState,
  clauses: string[],
): void {
  if (schema.$ref === undefined) return;
  if (typeof schema.$ref !== 'string') {
    throw new ZodSchemaEmissionError('$ref must be a string', joinPointer(path, '$ref'));
  }
  const referenceName = state.references.get(schema.$ref);
  if (referenceName === undefined) {
    throw new ZodSchemaEmissionError(
      `Unresolved local component reference ${JSON.stringify(schema.$ref)}`,
      joinPointer(path, '$ref'),
    );
  }
  clauses.push(referenceName);
}

function appendCompositionClauses(
  schema: Record<string, unknown>,
  path: string,
  state: ReferenceEmitState,
  clauses: string[],
): void {
  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    if (schema[keyword] === undefined) continue;
    clauses.push(emitComposition(keyword, schema[keyword], joinPointer(path, keyword), state));
  }
}

function emitSchemaType(
  schema: unknown,
  path: string,
  state: TypeEmitState,
  direction: SchemaDirection,
): string {
  if (typeof schema === 'boolean' || !isObject(schema)) {
    throw new ZodSchemaEmissionError('Schema must be an object', path);
  }
  const parsedType = parseSchemaType(schema.type, joinPointer(path, 'type'));
  const nullable = parseNullable(schema.nullable, joinPointer(path, 'nullable'));
  const clauses: string[] = [];
  appendTypeReferenceClause(schema, path, state, direction, clauses);
  if (parsedType.type !== null) {
    clauses.push(emitTypeScriptType(schema, parsedType.type, path, state, direction));
  }
  if (schema.const !== undefined) clauses.push(serializeLiteral(schema.const));
  appendTypeEnumClause(schema, path, clauses);
  appendTypeCompositionClauses(schema, path, state, direction, clauses);

  let type = clauses.length === 0 ? 'z.output<ReturnType<typeof z.json>>' : clauses.join(' & ');
  if (nullable || parsedType.nullable) type = `${parenthesizeType(type)} | null`;
  return type;
}

function appendTypeReferenceClause(
  schema: Record<string, unknown>,
  path: string,
  state: TypeEmitState,
  direction: SchemaDirection,
  clauses: string[],
): void {
  if (schema.$ref === undefined) return;
  if (typeof schema.$ref !== 'string') {
    throw new ZodSchemaEmissionError('$ref must be a string', joinPointer(path, '$ref'));
  }
  const reference = state.references.get(schema.$ref);
  if (reference === undefined) {
    throw new ZodSchemaEmissionError(
      `Unresolved local component reference ${JSON.stringify(schema.$ref)}`,
      joinPointer(path, '$ref'),
    );
  }
  clauses.push(reference[direction]);
}

function appendTypeEnumClause(
  schema: Record<string, unknown>,
  path: string,
  clauses: string[],
): void {
  if (schema.enum === undefined) return;
  if (!Array.isArray(schema.enum)) {
    throw new ZodSchemaEmissionError('enum must be an array', joinPointer(path, 'enum'));
  }
  clauses.push(schema.enum.map(serializeLiteral).join(' | '));
}

function appendTypeCompositionClauses(
  schema: Record<string, unknown>,
  path: string,
  state: TypeEmitState,
  direction: SchemaDirection,
  clauses: string[],
): void {
  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    const branches = schema[keyword];
    if (branches === undefined) continue;
    if (!Array.isArray(branches)) {
      throw new ZodSchemaEmissionError(`${keyword} must be an array`, joinPointer(path, keyword));
    }
    const separator = keyword === 'allOf' ? ' & ' : ' | ';
    clauses.push(
      branches
        .map((branch, index) =>
          parenthesizeType(
            emitSchemaType(
              branch,
              joinPointer(joinPointer(path, keyword), String(index)),
              state,
              direction,
            ),
          ),
        )
        .join(separator),
    );
  }
}

function emitTypeScriptType(
  schema: Record<string, unknown>,
  type: string,
  path: string,
  state: TypeEmitState,
  direction: SchemaDirection,
): string {
  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return `Array<${emitSchemaType(schema.items, joinPointer(path, 'items'), state, direction)}>`;
    case 'object':
      return emitObjectType(schema, path, state, direction);
    default:
      throw new ZodSchemaEmissionError(
        `Unsupported schema type ${JSON.stringify(type)}`,
        joinPointer(path, 'type'),
      );
  }
}

function emitObjectType(
  schema: Record<string, unknown>,
  path: string,
  state: TypeEmitState,
  direction: SchemaDirection,
): string {
  const properties = isObject(schema.properties) ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const propertyLines = Object.keys(properties)
    .toSorted(compareText)
    .map((name) => {
      const optional = required.has(name) ? '' : '?';
      const type = emitSchemaType(
        properties[name],
        joinPointer(joinPointer(path, 'properties'), name),
        state,
        direction,
      );
      return `  ${JSON.stringify(name)}${optional}: ${type}${optional ? ' | undefined' : ''};`;
    });
  const propertyBlock = propertyLines.length === 0 ? '' : `\n${propertyLines.join('\n')}\n`;
  const object = `{${propertyBlock}}`;
  const additionalType =
    schema.additionalProperties === undefined || schema.additionalProperties === true
      ? 'unknown'
      : emitSchemaType(
          schema.additionalProperties,
          joinPointer(path, 'additionalProperties'),
          state,
          direction,
        );
  return `${parenthesizeType(object)} & Record<string, ${additionalType}>`;
}

function emitType(
  schema: Record<string, unknown>,
  type: string,
  path: string,
  state: ReferenceEmitState,
): string {
  switch (type) {
    case 'string':
      return emitString(schema, path);
    case 'number':
      return emitNumber(schema, path, false);
    case 'integer':
      return emitNumber(schema, path, true);
    case 'boolean':
      return 'z.boolean()';
    case 'null':
      return 'z.null()';
    case 'array':
      return emitArray(schema, path, state);
    case 'object':
      return emitObject(schema, path, state);
    default:
      throw new ZodSchemaEmissionError(
        `Unsupported schema type ${JSON.stringify(type)}`,
        joinPointer(path, 'type'),
      );
  }
}

function emitString(schema: Record<string, unknown>, path: string): string {
  let expression: string;
  switch (schema.format) {
    case undefined:
      expression = 'z.string()';
      break;
    case 'date':
      expression = 'z.iso.date()';
      break;
    case 'date-time':
      expression = 'z.iso.datetime({ offset: true })';
      break;
    case 'uuid':
      expression = 'z.uuid()';
      break;
    default:
      throw new ZodSchemaEmissionError(
        `Unsupported string format ${JSON.stringify(schema.format)}`,
        joinPointer(path, 'format'),
      );
  }
  if (schema.minLength !== undefined) {
    expression += `.min(${nonnegativeInteger(schema.minLength, joinPointer(path, 'minLength'))})`;
  }
  if (schema.maxLength !== undefined) {
    expression += `.max(${nonnegativeInteger(schema.maxLength, joinPointer(path, 'maxLength'))})`;
  }
  if (
    schema.minLength !== undefined &&
    schema.maxLength !== undefined &&
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- nonnegativeInteger above already validated both as numbers
    (schema.minLength as number) > (schema.maxLength as number)
  ) {
    throw new ZodSchemaEmissionError(
      'minLength must not exceed maxLength',
      joinPointer(path, 'minLength'),
    );
  }
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') {
      throw new ZodSchemaEmissionError('pattern must be a string', joinPointer(path, 'pattern'));
    }
    let compiledPattern: RegExp;
    try {
      compiledPattern = new RegExp(schema.pattern, 'u');
    } catch (error) {
      throw new ZodSchemaEmissionError(
        `Invalid ECMAScript Unicode pattern ${JSON.stringify(schema.pattern)}: ${error instanceof Error ? error.message : String(error)}`,
        joinPointer(path, 'pattern'),
      );
    }
    expression += `.regex(new RegExp(${JSON.stringify(schema.pattern)}, '${compiledPattern.flags}'))`;
  }
  return expression;
}

function emitNumber(schema: Record<string, unknown>, path: string, integer: boolean): string {
  let expression: string;
  if (integer) {
    if (schema.format === undefined || schema.format === 'int64') expression = 'z.int()';
    else if (schema.format === 'int32') expression = 'z.int32()';
    else {
      throw new ZodSchemaEmissionError(
        `Unsupported integer format ${JSON.stringify(schema.format)}`,
        joinPointer(path, 'format'),
      );
    }
  } else if (schema.format === undefined || schema.format === 'double') expression = 'z.number()';
  else if (schema.format === 'float') expression = 'z.float32()';
  else {
    throw new ZodSchemaEmissionError(
      `Unsupported number format ${JSON.stringify(schema.format)}`,
      joinPointer(path, 'format'),
    );
  }

  const checks: readonly [string, string][] = [
    ['minimum', 'min'],
    ['maximum', 'max'],
    ['exclusiveMinimum', 'gt'],
    ['exclusiveMaximum', 'lt'],
    ['multipleOf', 'multipleOf'],
  ];
  for (const [keyword, method] of checks) {
    if (schema[keyword] === undefined) continue;
    const value = finiteNumber(schema[keyword], joinPointer(path, keyword));
    if (keyword === 'multipleOf' && value <= 0) {
      throw new ZodSchemaEmissionError(
        'multipleOf must be greater than zero',
        joinPointer(path, keyword),
      );
    }
    expression += `.${method}(${serializeNumber(value)})`;
  }
  return expression;
}

function emitArray(
  schema: Record<string, unknown>,
  path: string,
  state: ReferenceEmitState,
): string {
  if (schema.items === undefined) {
    throw new ZodSchemaEmissionError(
      'Array items are required because unconstrained values are unsupported',
      joinPointer(path, 'items'),
    );
  }
  let expression = `z.array(${emitSchema(schema.items, joinPointer(path, 'items'), state)})`;
  if (schema.minItems !== undefined) {
    expression += `.min(${nonnegativeInteger(schema.minItems, joinPointer(path, 'minItems'))})`;
  }
  if (schema.maxItems !== undefined) {
    expression += `.max(${nonnegativeInteger(schema.maxItems, joinPointer(path, 'maxItems'))})`;
  }
  if (
    schema.minItems !== undefined &&
    schema.maxItems !== undefined &&
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- nonnegativeInteger above already validated both as numbers
    (schema.minItems as number) > (schema.maxItems as number)
  ) {
    throw new ZodSchemaEmissionError(
      'minItems must not exceed maxItems',
      joinPointer(path, 'minItems'),
    );
  }
  if (schema.uniqueItems !== undefined) {
    if (typeof schema.uniqueItems !== 'boolean') {
      throw new ZodSchemaEmissionError(
        'uniqueItems must be a boolean',
        joinPointer(path, 'uniqueItems'),
      );
    }
    if (schema.uniqueItems) {
      state.helpers.add('unique-array');
      expression += ".refine(isJsonArrayUnique, { message: 'Array items must be unique' })";
    }
  }
  return expression;
}

function emitObject(
  schema: Record<string, unknown>,
  path: string,
  state: ReferenceEmitState,
): string {
  const properties = schema.properties ?? {};
  if (!isObject(properties)) {
    throw new ZodSchemaEmissionError(
      'properties must be an object',
      joinPointer(path, 'properties'),
    );
  }
  const required = schema.required ?? [];
  if (!Array.isArray(required) || required.some((name) => typeof name !== 'string')) {
    throw new ZodSchemaEmissionError(
      'required must be an array of property names',
      joinPointer(path, 'required'),
    );
  }
  if (new Set(required).size !== required.length) {
    throw new ZodSchemaEmissionError(
      'required must not contain duplicate property names',
      joinPointer(path, 'required'),
    );
  }
  for (const name of required) {
    if (!Object.hasOwn(properties, name)) {
      throw new ZodSchemaEmissionError(
        `Required property ${JSON.stringify(name)} has no declared schema`,
        joinPointer(path, 'required'),
      );
    }
  }

  const requiredNames = new Set(required);
  const propertyLines = Object.keys(properties)
    .toSorted(compareText)
    .map((name) => {
      let expression = emitSchema(
        properties[name],
        joinPointer(joinPointer(path, 'properties'), name),
        state,
      );
      if (!requiredNames.has(name)) expression += '.optional()';
      return `  ${JSON.stringify(name)}: ${expression},`;
    });
  const propertyBlock = propertyLines.length === 0 ? '' : `\n${propertyLines.join('\n')}\n`;
  let expression = `z.looseObject({${propertyBlock}})`;

  if (schema.additionalProperties !== undefined) {
    if (schema.additionalProperties === false) {
      throw new ZodSchemaEmissionError(
        'additionalProperties: false conflicts with forward-compatible loose objects',
        joinPointer(path, 'additionalProperties'),
      );
    }
    if (schema.additionalProperties !== true) {
      expression += `.catchall(${emitSchema(
        schema.additionalProperties,
        joinPointer(path, 'additionalProperties'),
        state,
      )})`;
    }
  }
  return expression;
}

function emitConst(value: unknown, path: string): string {
  assertLiteral(value, path);
  return `z.literal(${serializeLiteral(value)})`;
}

function emitEnum(value: unknown, path: string): string {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ZodSchemaEmissionError('enum must be a non-empty array', path);
  }
  const serialized = value.map((entry, index) => {
    assertLiteral(entry, joinPointer(path, String(index)));
    return serializeLiteral(entry);
  });
  if (new Set(serialized).size !== serialized.length) {
    throw new ZodSchemaEmissionError('enum must not contain duplicate values', path);
  }
  return serialized.length === 1
    ? `z.literal(${serialized[0]})`
    : `z.literal([${serialized.join(', ')}])`;
}

function emitComposition(
  keyword: string,
  value: unknown,
  path: string,
  state: ReferenceEmitState,
): string {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ZodSchemaEmissionError(`${keyword} must be a non-empty array`, path);
  }
  const branches = value.map((branch, index) =>
    emitSchema(branch, joinPointer(path, String(index)), state),
  );
  if (branches.length === 1) return branches[0];
  if (keyword === 'allOf') {
    return branches
      .slice(1)
      .reduce((left, right) => `z.intersection(${left}, ${right})`, branches[0]);
  }
  const constructor = keyword === 'oneOf' ? 'z.xor' : 'z.union';
  return `${constructor}([${branches.join(', ')}])`;
}

function parseSchemaType(value: unknown, path: string): ParsedSchemaType {
  if (value === undefined) return { nullable: false, type: null };
  if (typeof value === 'string') return { nullable: false, type: value };
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ZodSchemaEmissionError('type must be a string or string array', path);
  }
  if (new Set(value).size !== value.length) {
    throw new ZodSchemaEmissionError('type array must not contain duplicates', path);
  }
  if (value.length !== 2 || !value.includes('null')) {
    throw new ZodSchemaEmissionError(
      'Type arrays are supported only for one value type plus null',
      path,
    );
  }
  return { nullable: true, type: value.find((entry) => entry !== 'null') ?? null };
}

function parseNullable(value: unknown, path: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') {
    throw new ZodSchemaEmissionError('nullable must be a boolean', path);
  }
  return value;
}

function validateKeywords(schema: Record<string, unknown>, path: string): void {
  for (const keyword of Object.keys(schema)) {
    if (supportedKeywords.has(keyword) || keyword.startsWith('x-')) continue;
    throw new ZodSchemaEmissionError(
      `Unsupported schema keyword ${JSON.stringify(keyword)}`,
      joinPointer(path, keyword),
    );
  }
}

function validateKeywordTypes(
  schema: Record<string, unknown>,
  type: string | null,
  path: string,
): void {
  const groups: readonly [readonly string[], ReadonlySet<string>][] = [
    [numericKeywords, new Set(['integer', 'number'])],
    [stringKeywords, new Set(['string'])],
    [arrayKeywords, new Set(['array'])],
    [objectKeywords, new Set(['object'])],
  ];
  for (const [keywords, allowedTypes] of groups) {
    for (const keyword of keywords) {
      if (schema[keyword] !== undefined && !(type !== null && allowedTypes.has(type))) {
        throw new ZodSchemaEmissionError(
          `${keyword} requires type ${[...allowedTypes].join(' or ')}`,
          joinPointer(path, keyword),
        );
      }
    }
  }
  if (
    schema.format !== undefined &&
    !(type !== null && new Set(['integer', 'number', 'string']).has(type))
  ) {
    throw new ZodSchemaEmissionError(
      'format requires type string, number, or integer',
      joinPointer(path, 'format'),
    );
  }
}

function normalizeReferenceNames(references: unknown, path: string): Map<string, string> {
  if (!isObject(references)) {
    throw new ZodSchemaEmissionError('references must be an object', path);
  }
  const normalized = new Map<string, string>();
  for (const [reference, identifier] of Object.entries(references).toSorted(([left], [right]) =>
    compareText(left, right),
  )) {
    if (!reference.startsWith('#/components/schemas/')) {
      throw new ZodSchemaEmissionError(
        `External or unsupported schema reference ${JSON.stringify(reference)}`,
        path,
      );
    }
    if (typeof identifier !== 'string' || !identifierPattern.test(identifier)) {
      throw new ZodSchemaEmissionError(
        `Invalid schema reference identifier ${JSON.stringify(identifier)}`,
        path,
      );
    }
    normalized.set(reference, identifier);
  }
  return normalized;
}

function normalizeTypeReferenceNames(
  references: unknown,
  path: string,
): Map<string, TypeReference> {
  if (!isObject(references)) {
    throw new ZodSchemaEmissionError('type references must be an object', path);
  }
  const normalized = new Map<string, TypeReference>();
  for (const [reference, names] of Object.entries(references).toSorted(([left], [right]) =>
    compareText(left, right),
  )) {
    if (
      !reference.startsWith('#/components/schemas/') ||
      !isObject(names) ||
      typeof names.input !== 'string' ||
      !identifierPattern.test(names.input) ||
      typeof names.output !== 'string' ||
      !identifierPattern.test(names.output)
    ) {
      throw new ZodSchemaEmissionError(
        `Invalid schema type reference ${JSON.stringify(reference)}`,
        path,
      );
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- input/output were validated as identifiers above
    normalized.set(reference, names as unknown as TypeReference);
  }
  return normalized;
}

function collectReferences(schema: unknown, path: string, output: CollectedReference[]): void {
  if (!isObject(schema)) return;
  if (typeof schema.$ref === 'string') {
    output.push({ path: joinPointer(path, '$ref'), reference: schema.$ref });
  }
  for (const [keyword, value] of Object.entries(schema)) {
    if (
      keyword === '$ref' ||
      ignoredReferenceValueKeywords.has(keyword) ||
      keyword.startsWith('x-')
    ) {
      continue;
    }
    if (keyword === 'properties' && isObject(value)) {
      for (const [name, property] of Object.entries(value)) {
        collectReferences(property, joinPointer(joinPointer(path, keyword), name), output);
      }
    } else if (['allOf', 'anyOf', 'oneOf'].includes(keyword) && Array.isArray(value)) {
      value.forEach((branch, index) =>
        collectReferences(branch, joinPointer(joinPointer(path, keyword), String(index)), output),
      );
    } else if (['additionalProperties', 'items'].includes(keyword)) {
      collectReferences(value, joinPointer(path, keyword), output);
    }
  }
}

function resolveSchemaReferences(
  schema: unknown,
  path: string,
  modelsByPointer: Map<string, NormalizedModel>,
): { readonly model: NormalizedModel; readonly path: string }[] {
  const references: CollectedReference[] = [];
  collectReferences(schema, path, references);
  const resolved = new Map<string, { model: NormalizedModel; path: string }>();
  for (const reference of references) {
    const model = modelsByPointer.get(reference.reference);
    if (model === undefined) {
      throw new ZodSchemaEmissionError(
        `Unresolved local component reference ${JSON.stringify(reference.reference)}`,
        reference.path,
      );
    }
    resolved.set(model.name, { model, path: reference.path });
  }
  return [...resolved.values()].toSorted((left, right) =>
    compareText(left.model.name, right.model.name),
  );
}

function resolveOperationReferences(
  operation: NormalizedOperation,
  modelsByPointer: Map<string, NormalizedModel>,
): NormalizedModel[] {
  const schemas = [
    ...operation.parameters.map(({ schema }) => schema),
    ...(operation.requestBody?.content.map(({ schema }) => schema) ?? []),
    ...operation.successResponses.flatMap(({ content }) => content.map(({ schema }) => schema)),
  ];
  const resolved = new Map<string, NormalizedModel>();
  for (const [index, schema] of schemas.entries()) {
    for (const entry of resolveSchemaReferences(
      schema,
      `operations/${escapePointerSegment(operation.operationId)}/schemas/${index}`,
      modelsByPointer,
    )) {
      resolved.set(entry.model.name, entry.model);
    }
  }
  return [...resolved.values()].toSorted((left, right) => compareText(left.name, right.name));
}

function resolveOperationsModelClosure(
  operations: readonly NormalizedOperation[],
  models: readonly NormalizedModel[],
): NormalizedModel[] {
  const dependencyModel = createSchemaDependencyModel(models, operations, []);
  const names = new Set(dependencyModel.operations.flatMap(({ dependencies }) => dependencies));
  return dependencyModel.models
    .filter(({ model }) => names.has(model.name))
    .map(({ model }) => model);
}

function validateGranularSchemaExports(dependencyModel: SchemaDependencyModel): void {
  const modelExports = new Map<string, string>();
  for (const { model } of dependencyModel.models) {
    for (const name of [`${model.name}Schema`, `${model.name}Input`, model.name]) {
      const previous = modelExports.get(name);
      if (previous !== undefined) throw new Error(`Duplicate granular model export ${name}`);
      modelExports.set(name, model.name);
    }
  }
  const operationExports = new Map<string, string>();
  for (const { operation } of dependencyModel.operations) {
    const base = operationSchemaName(operation.operationId);
    const names = [
      `${base}RequestSchema`,
      `${base}SuccessResponseSchema`,
      `${base}SuccessResponseSchemasByStatus`,
      `${base}Input`,
      `${base}Output`,
      ...operation.successResponses.map(({ status }) =>
        operationStatusResponseSchemaName(operation.operationId, status),
      ),
    ];
    for (const name of names) {
      const previous = operationExports.get(name);
      const model = modelExports.get(name);
      if (model !== undefined) {
        throw new Error(
          `Duplicate granular schema export ${name}: model ${model} and operation ${operation.operationId}`,
        );
      }
      if (previous !== undefined) {
        throw new Error(
          `Duplicate granular operation export ${name}: ${previous} and ${operation.operationId}`,
        );
      }
      operationExports.set(name, operation.operationId);
    }
  }
}

function assertUniqueFileNames(
  entries: readonly {
    readonly fileName: string;
    readonly model?: NormalizedModel;
    readonly domain?: string;
  }[],
  label: string,
): void {
  const names = new Map<string, string | undefined>();
  for (const entry of entries) {
    const key = entry.fileName.toLowerCase();
    const previous = names.get(key);
    const name = entry.model?.name ?? entry.domain;
    if (previous !== undefined) {
      throw new Error(`Duplicate ${label} module file ${entry.fileName}: ${previous} and ${name}`);
    }
    names.set(key, name);
  }
}

export function schemaFileName(value: string): string {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replaceAll(/([A-Z])(?=[A-Z][a-z])/gu, '$1-')
    .replaceAll(/[^A-Za-z0-9]+/gu, '-')
    .replaceAll(/^-|-$/gu, '')
    .toLowerCase();
}

function topologicallyOrderModels(
  modelsByName: Map<string, NormalizedModel>,
  dependencies: Map<string, readonly { readonly name: string; readonly path: string }[]>,
): NormalizedModel[] {
  const ordered: NormalizedModel[] = [];
  const active: string[] = [];
  const states = new Map<string, 'active' | 'done'>();

  function visit(name: string): void {
    const state = states.get(name);
    if (state === 'done') return;
    states.set(name, 'active');
    active.push(name);
    for (const dependency of dependencies.get(name) ?? []) {
      if (states.get(dependency.name) === 'active') {
        const cycleStart = active.indexOf(dependency.name);
        const cycle = [...active.slice(cycleStart), dependency.name];
        throw new ZodSchemaEmissionError(
          `Recursive component references are unsupported: ${cycle.join(' -> ')}`,
          dependency.path,
        );
      }
      visit(dependency.name);
    }
    active.pop();
    states.set(name, 'done');
    const model = modelsByName.get(name);
    if (model !== undefined) ordered.push(model);
  }

  for (const name of [...modelsByName.keys()].toSorted(compareText)) visit(name);
  return ordered;
}

function renderUniqueArrayHelper(): string {
  return `function canonicalJson(value: unknown): string {
  return (
    JSON.stringify(value, (_key: string, current: unknown): unknown => {
      if (current === null || typeof current !== 'object' || Array.isArray(current)) return current;
      return Object.fromEntries(
        Object.entries(current).sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        ),
      );
    }) ?? 'undefined'
  );
}

function isJsonArrayUnique(values: readonly unknown[]): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    const key = canonicalJson(value);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}`;
}

function renderTypeAssertionHelpers(): string {
  return `type IsExact<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;

type Assert<Value extends true> = Value;`;
}

function parenthesizeType(type: string): string {
  return /[&|]/u.test(type) ? `(${type})` : type;
}

function assertLiteral(value: unknown, path: string): void {
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'boolean' &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new ZodSchemaEmissionError(
      'Only finite JSON primitive const and enum values are supported',
      path,
    );
  }
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ZodSchemaEmissionError('Constraint must be a finite number', path);
  }
  return value;
}

function nonnegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ZodSchemaEmissionError('Constraint must be a non-negative integer', path);
  }
  return value;
}

function serializeLiteral(value: unknown): string {
  if (typeof value === 'number') return serializeNumber(value);
  return JSON.stringify(value);
}

function serializeNumber(value: number): string {
  return Object.is(value, -0) ? '-0' : String(value);
}

function joinPointer(path: string, segment: string): string {
  return `${path}/${segment.replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

function escapePointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
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

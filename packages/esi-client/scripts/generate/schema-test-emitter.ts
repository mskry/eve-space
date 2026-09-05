import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createProvenanceHeader, type ArtifactProvenance } from './artifacts.ts';
import type { NormalizedModel, NormalizedOperation, NormalizedSchema } from './normalize.ts';
import { isTransportManagedParameter } from './operation-parameters.ts';
import type { EmitterContext } from './orchestrate.ts';
import type { GeneratedTestComponent } from './test-emitter.ts';
import { operationSchemaName, operationStatusResponseSchemaName } from './zod-schema.ts';

export interface SchemaContractFixtureOptions {
  readonly nonEmptyStrings?: boolean;
  readonly populate?: boolean;
  readonly preferNonNull?: boolean;
}

interface ModelIndex {
  readonly modelsByName: Map<string, NormalizedModel>;
  readonly modelsByPointer: Map<string, NormalizedModel>;
}

type AvailableResult<T> =
  | { readonly available: true; readonly value: T }
  | { readonly available: false };

interface TestCase {
  readonly category:
    | 'valid'
    | 'invalid'
    | 'unknown'
    | 'collection'
    | 'date-time'
    | 'nullable'
    | 'composition'
    | 'no-content';
  readonly description: string;
  readonly schemaName: string;
  readonly fixture?: unknown;
  readonly expected?: unknown;
  readonly path?: readonly (number | string)[];
}

const unavailable = Symbol('unavailable fixture');
const unavailableResult: AvailableResult<never> = Object.freeze({ available: false });
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

export function renderGeneratedSchemaContractTests(
  models: readonly NormalizedModel[],
  operations: readonly NormalizedOperation[],
  provenance: ArtifactProvenance,
): string {
  if (!Array.isArray(models)) throw new TypeError('Normalized models must be an array');
  if (!Array.isArray(operations)) throw new TypeError('Normalized operations must be an array');

  const state = indexModels(models);
  const modelContracts = collectModelContractCases(state);
  const operationContracts = collectOperationContractCases(operations, state);
  const cases = [...modelContracts.cases, ...operationContracts.cases];

  if (cases.length === 0) {
    throw new Error('No mechanically reliable schema contract fixtures could be generated');
  }

  const imports = [
    "import { describe, expect, it } from 'vitest';",
    renderImport(modelContracts.imports, '../../src/generated/schemas/models.js'),
    renderImport(operationContracts.imports, '../../src/generated/schemas/operations.js'),
  ].filter(Boolean);
  const needsReadPath = cases.some(({ category }) => category === 'date-time');
  const tests = cases.map(renderCase).join('\n\n');
  const readPathHelper = needsReadPath ? `${renderReadPathHelper()}\n\n` : '';
  const body = `${imports.join('\n')}\n\n// Fixtures are emitted only when their validity follows mechanically from the normalized schema.\n${readPathHelper}describe('generated schema contracts', () => {\n${indent(tests, 2)}\n});\n`;
  return `${createProvenanceHeader(provenance, 'typescript')}\n${body}`;
}

function collectModelContractCases(state: ModelIndex): { cases: TestCase[]; imports: Set<string> } {
  const cases: TestCase[] = [];
  const imports = new Set<string>();

  for (const model of [...state.modelsByName.values()].toSorted((left, right) =>
    compareText(left.name, right.name),
  )) {
    const schemaName = `${model.name}Schema`;
    const modelCases = [
      createMinimalModelCase(model, state, schemaName),
      createInvalidModelCase(model, state, schemaName),
      createUnknownModelCase(model, state, schemaName),
      createCollectionModelCase(model, state, schemaName),
      createDateTimeModelCase(model, state, schemaName),
      createNullableModelCase(model, schemaName),
      createCompositionModelCase(model, state, schemaName),
    ];

    for (const testCase of modelCases) {
      if (testCase === null) continue;
      imports.add(schemaName);
      cases.push(testCase);
    }
  }

  return { cases, imports };
}

function createMinimalModelCase(
  model: NormalizedModel,
  state: ModelIndex,
  schemaName: string,
): TestCase | null {
  const fixture = deriveSchemaFixture(model.schema, state, { populate: false });
  if (fixture === unavailable) return null;
  return {
    category: 'valid',
    description: `${model.name} accepts minimal valid data`,
    schemaName,
    fixture,
  };
}

function createInvalidModelCase(
  model: NormalizedModel,
  state: ModelIndex,
  schemaName: string,
): TestCase | null {
  const fixture = deriveInvalidKnownFieldFixture(model.schema, state);
  if (fixture === unavailable) return null;
  return {
    category: 'invalid',
    description: `${model.name} rejects an invalid known field`,
    schemaName,
    fixture,
  };
}

function createUnknownModelCase(
  model: NormalizedModel,
  state: ModelIndex,
  schemaName: string,
): TestCase | null {
  const unknownResult = deriveUnknownFieldFixture(model.schema, state);
  if (!unknownResult.available) return null;
  return {
    category: 'unknown',
    description: `${model.name} preserves an unknown field`,
    schemaName,
    fixture: unknownResult.value.fixture,
    expected: unknownResult.value.expected,
  };
}

function createCollectionModelCase(
  model: NormalizedModel,
  state: ModelIndex,
  schemaName: string,
): TestCase | null {
  if (!containsArray(model.schema, state)) return null;
  const fixture = deriveSchemaFixture(model.schema, state, { populate: true });
  if (fixture === unavailable || !containsPopulatedArray(fixture)) return null;
  return {
    category: 'collection',
    description: `${model.name} validates nested collection data`,
    schemaName,
    fixture,
  };
}

function createDateTimeModelCase(
  model: NormalizedModel,
  state: ModelIndex,
  schemaName: string,
): TestCase | null {
  const path = findDateTimePath(model.schema, state);
  if (path === null) return null;
  const fixture = deriveSchemaFixture(model.schema, state, {
    populate: true,
    preferNonNull: true,
  });
  if (fixture === unavailable || typeof readPath(fixture, path) !== 'string') return null;
  return {
    category: 'date-time',
    description: `${model.name} keeps date-time values as strings`,
    schemaName,
    fixture,
    path,
  };
}

function createNullableModelCase(model: NormalizedModel, schemaName: string): TestCase | null {
  if (!isNullableSchema(model.schema)) return null;
  return {
    category: 'nullable',
    description: `${model.name} accepts null`,
    schemaName,
    fixture: null,
  };
}

function createCompositionModelCase(
  model: NormalizedModel,
  state: ModelIndex,
  schemaName: string,
): TestCase | null {
  const composition = compositionKeyword(model.schema);
  if (composition === null) return null;
  const fixture = deriveSchemaFixture(model.schema, state, {
    populate: true,
    preferNonNull: true,
  });
  if (fixture === unavailable) return null;
  return {
    category: 'composition',
    description: `${model.name} validates ${composition} composition`,
    schemaName,
    fixture,
  };
}

function collectOperationContractCases(
  operations: readonly NormalizedOperation[],
  state: ModelIndex,
): { cases: TestCase[]; imports: Set<string> } {
  const cases: TestCase[] = [];
  const imports = new Set<string>();
  const operationSymbols = new Map<string, string>();

  for (const operation of [...operations].toSorted((left, right) =>
    compareText(left.operationId, right.operationId),
  )) {
    assertOperation(operation, operationSymbols);
    const requestCase = createOperationRequestCase(operation, state);
    if (requestCase !== null) {
      imports.add(requestCase.schemaName);
      cases.push(requestCase);
    }

    for (const response of [...operation.successResponses].toSorted((left, right) =>
      compareText(left.status, right.status),
    )) {
      const responseCase = createOperationResponseCase(operation, response, state);
      if (responseCase === null) continue;
      imports.add(responseCase.schemaName);
      cases.push(responseCase);
    }
  }

  return { cases, imports };
}

function createOperationRequestCase(
  operation: NormalizedOperation,
  state: ModelIndex,
): TestCase | null {
  const result = deriveRequestFixture(operation, state);
  const schemaName = `${operationSchemaName(operation.operationId)}RequestSchema`;
  if (!result.available) return null;
  return {
    category: 'valid',
    description: `${operation.operationId} accepts minimal valid request data`,
    schemaName,
    fixture: result.value,
  };
}

function createOperationResponseCase(
  operation: NormalizedOperation,
  response: NormalizedOperation['successResponses'][number],
  state: ModelIndex,
): TestCase | null {
  const schemaName = operationStatusResponseSchemaName(operation.operationId, response.status);
  if (response.noContent) {
    return {
      category: 'no-content',
      description: `${operation.operationId} ${response.status} accepts only no content`,
      schemaName,
    };
  }
  const content = selectJsonContent(response.content);
  if (content === null) return null;
  const fixture = deriveSchemaFixture(content.schema, state, {
    populate: containsArray(content.schema, state),
  });
  if (fixture === unavailable) return null;
  return {
    category: containsArray(content.schema, state) ? 'collection' : 'valid',
    description: `${operation.operationId} ${response.status} validates success data`,
    schemaName,
    fixture,
  };
}

export function createSchemaContractFixture(
  schema: NormalizedSchema,
  models: readonly NormalizedModel[],
  options: SchemaContractFixtureOptions = {},
): unknown {
  if (!Array.isArray(models)) throw new TypeError('Normalized models must be an array');
  if (!isObject(options)) throw new TypeError('Schema fixture options must be an object');
  const fixture = deriveSchemaFixture(schema, indexModels(models), {
    nonEmptyStrings: options.nonEmptyStrings === true,
    populate: options.populate === true,
    preferNonNull: options.preferNonNull === true,
  });
  if (fixture === unavailable) {
    throw new Error('Schema does not have a mechanically derivable fixture');
  }
  return fixture;
}

export async function emitGeneratedSchemaTests(
  context: EmitterContext,
  testsDirectory: string,
): Promise<readonly ['schema-contracts.test.ts']> {
  if (!isObject(context) || !isObject(context.normalizedModel)) {
    throw new TypeError('Generated schema test context must contain a normalized model');
  }
  if (typeof testsDirectory !== 'string' || testsDirectory.length === 0) {
    throw new TypeError('Generated schema test directory must be a non-empty string');
  }
  await writeFile(
    join(testsDirectory, 'schema-contracts.test.ts'),
    renderGeneratedSchemaContractTests(
      context.normalizedModel.models,
      context.normalizedModel.operations,
      context.provenance,
    ),
  );
  return ['schema-contracts.test.ts'];
}

export const generatedSchemaTestsComponent: GeneratedTestComponent = Object.freeze({
  name: 'schema-contracts',
  emit: emitGeneratedSchemaTests,
});

function renderCase(testCase: TestCase): string {
  const description = JSON.stringify(testCase.description);
  const fixture = stableJson(testCase.fixture);
  switch (testCase.category) {
    case 'invalid':
      return `it(${description}, () => {\n  expect(${testCase.schemaName}.safeParse(${fixture}).success).toBe(false);\n});`;
    case 'unknown':
      return `it(${description}, () => {\n  const parsed = ${testCase.schemaName}.parse(${fixture});\n  expect(parsed).toHaveProperty('__generated_unknown__', ${stableJson(testCase.expected)});\n});`;
    case 'date-time':
      return `it(${description}, () => {\n  const parsed = ${testCase.schemaName}.parse(${fixture});\n  expect(typeof readFixturePath(parsed, ${stableJson(testCase.path)})).toBe('string');\n});`;
    case 'no-content':
      return `it(${description}, () => {\n  expect(${testCase.schemaName}.parse(undefined)).toBeUndefined();\n  expect(${testCase.schemaName}.safeParse(null).success).toBe(false);\n});`;
    default:
      return `it(${description}, () => {\n  expect(${testCase.schemaName}.parse(${fixture})).toEqual(${fixture});\n});`;
  }
}

function renderImport(names: Set<string>, specifier: string): string {
  if (names.size === 0) return '';
  return `import {\n${[...names]
    .toSorted(compareText)
    .map((name) => `  ${name},`)
    .join('\n')}\n} from '${specifier}';`;
}

function renderReadPathHelper(): string {
  return `function readFixturePath(value: unknown, path: readonly (number | string)[]): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = Reflect.get(current, segment);
  }
  return current;
}`;
}

function deriveRequestFixture(
  operation: NormalizedOperation,
  state: ModelIndex,
): AvailableResult<Record<string, unknown>> {
  if (!Array.isArray(operation.parameters)) return unavailableResult;
  const fixture: Record<string, unknown> = {};
  for (const placement of ['path', 'query', 'header', 'cookie'] as const) {
    const required = operation.parameters
      .filter(
        (parameter) =>
          parameter.placement === placement &&
          parameter.required === true &&
          !isTransportManagedParameter(parameter),
      )
      .toSorted((left, right) => compareText(left.name, right.name));
    if (required.length === 0) continue;
    const group: Record<string, unknown> = {};
    for (const parameter of required) {
      const value = deriveSchemaFixture(parameter.schema, state, { populate: false });
      if (value === unavailable) return unavailableResult;
      group[parameter.name] = value;
    }
    fixture[placement] = group;
  }
  if (operation.requestBody?.required === true) {
    const content = selectJsonContent(operation.requestBody.content);
    if (content === null) return unavailableResult;
    const body = deriveSchemaFixture(content.schema, state, { populate: false });
    if (body === unavailable) return unavailableResult;
    fixture.body = body;
  }
  return availableResult(fixture);
}

function deriveInvalidKnownFieldFixture(schema: NormalizedSchema, state: ModelIndex): unknown {
  const resolved = resolveDirectSchema(schema, state);
  if (
    resolved === unavailable ||
    schemaType(resolved) !== 'object' ||
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resolveDirectSchema returns unknown; schemaType above confirms it is an object schema
    !isObject((resolved as Record<string, unknown>).properties)
  ) {
    return unavailable;
  }
  const fixture = deriveSchemaFixture(schema, state, { populate: false, preferNonNull: true });
  if (!isObject(fixture)) return unavailable;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- schemaType check above confirms resolved is an object schema with object properties
  const properties = (resolved as Record<string, unknown>).properties as Record<string, unknown>;
  for (const name of Object.keys(properties).toSorted(compareText)) {
    const invalid = incompatibleValue(properties[name], state);
    if (!invalid.available) continue;
    return { ...fixture, [name]: invalid.value };
  }
  return unavailable;
}

function deriveUnknownFieldFixture(
  schema: NormalizedSchema,
  state: ModelIndex,
): AvailableResult<{ readonly expected: unknown; readonly fixture: Record<string, unknown> }> {
  const resolved = resolveDirectSchema(schema, state);
  if (resolved === unavailable || schemaType(resolved) !== 'object') return unavailableResult;
  const fixture = deriveSchemaFixture(schema, state, { populate: false, preferNonNull: true });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- schemaType check above confirms resolved is an object schema
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- schemaType check above confirms resolved is an object schema
  const additionalProperties = (resolved as Record<string, unknown>).additionalProperties;
  if (!isObject(fixture) || additionalProperties === false) return unavailableResult;
  const expected =
    additionalProperties === undefined || additionalProperties === true
      ? { preserved: true }
      : deriveSchemaFixture(additionalProperties, state, { populate: false });
  if (expected === unavailable) return unavailableResult;
  return availableResult({ expected, fixture: { ...fixture, __generated_unknown__: expected } });
}

function deriveSchemaFixture(
  schema: unknown,
  state: ModelIndex,
  options: SchemaContractFixtureOptions,
  active: Set<string> = new Set(),
): unknown {
  if (!isObject(schema)) return unavailable;
  if (isNullableSchema(schema) && options.preferNonNull !== true) return null;

  const meaningfulKeys = Object.keys(schema).filter(
    (key) => !annotationKeywords.has(key) && !key.startsWith('x-') && key !== 'nullable',
  );
  if (schema.$ref !== undefined) {
    return deriveReferencedFixture(schema, state, options, active, meaningfulKeys);
  }

  const composition = compositionKeyword(schema);
  if (composition !== null) {
    return deriveComposedSchemaFixture(schema, state, options, active, meaningfulKeys, composition);
  }

  const type = schemaType(schema);
  const candidates = schema.const !== undefined ? [schema.const] : schema.enum;
  if (candidates !== undefined) return deriveCandidateFixture(candidates, schema, type);
  switch (type) {
    case null:
      return meaningfulKeys.length === 0 ? null : unavailable;
    case 'null':
      return null;
    case 'boolean':
      return true;
    case 'string': {
      const result = deriveStringFixture(schema, options);
      return result.available ? result.value : unavailable;
    }
    case 'number':
    case 'integer':
      return deriveNumberFixture(schema, type === 'integer');
    case 'array':
      return deriveArrayFixture(schema, state, options, active);
    case 'object':
      return deriveObjectFixture(schema, state, options, active);
    default:
      return unavailable;
  }
}

function deriveReferencedFixture(
  schema: Record<string, unknown>,
  state: ModelIndex,
  options: SchemaContractFixtureOptions,
  active: Set<string>,
  meaningfulKeys: readonly string[],
): unknown {
  if (meaningfulKeys.some((key) => key !== '$ref')) return unavailable;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- non-string $ref values simply miss every model pointer
  const target = state.modelsByPointer.get(schema.$ref as string);
  if (target === undefined || active.has(target.pointer)) return unavailable;
  const nextActive = new Set(active);
  nextActive.add(target.pointer);
  return deriveSchemaFixture(target.schema, state, options, nextActive);
}

function deriveComposedSchemaFixture(
  schema: Record<string, unknown>,
  state: ModelIndex,
  options: SchemaContractFixtureOptions,
  active: Set<string>,
  meaningfulKeys: readonly string[],
  composition: string,
): unknown {
  if (meaningfulKeys.some((key) => key !== composition)) return unavailable;
  return deriveCompositionFixture(composition, schema[composition], state, options, active);
}

function deriveCandidateFixture(
  candidates: unknown,
  schema: Record<string, unknown>,
  type: string | null,
): unknown {
  if (!Array.isArray(candidates)) return unavailable;
  const candidate = candidates.find((value) => valueSatisfiesSimpleSchema(value, schema, type));
  return candidate === undefined ? unavailable : candidate;
}

function deriveArrayFixture(
  schema: Record<string, unknown>,
  state: ModelIndex,
  options: SchemaContractFixtureOptions,
  active: Set<string>,
): unknown {
  if (!isObject(schema.items)) return unavailable;
  const minimum = integerConstraint(schema.minItems, 0);
  const maximum = integerConstraint(schema.maxItems, Number.POSITIVE_INFINITY);
  if (minimum === unavailable || maximum === unavailable || minimum > maximum) return unavailable;
  const count = options.populate === true && maximum > 0 ? Math.max(1, minimum) : minimum;
  if (count > maximum || (schema.uniqueItems === true && count > 1)) return unavailable;
  const item = deriveSchemaFixture(schema.items, state, options, active);
  if (item === unavailable) return unavailable;
  return Array.from({ length: count }, () => item);
}

function deriveObjectFixture(
  schema: Record<string, unknown>,
  state: ModelIndex,
  options: SchemaContractFixtureOptions,
  active: Set<string>,
): unknown {
  const properties = schema.properties ?? {};
  if (!isObject(properties) || !Array.isArray(schema.required ?? [])) return unavailable;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Array.isArray above confirms array-ness; elements follow the OpenAPI required-array convention
  const required = new Set((schema.required ?? []) as readonly string[]);
  const fixture: Record<string, unknown> = {};
  for (const name of Object.keys(properties).toSorted(compareText)) {
    if (!required.has(name) && options.populate !== true) continue;
    const value = deriveSchemaFixture(properties[name], state, options, active);
    if (value === unavailable) {
      if (required.has(name)) return unavailable;
      continue;
    }
    fixture[name] = value;
  }
  return fixture;
}

function deriveCompositionFixture(
  keyword: string,
  branches: unknown,
  state: ModelIndex,
  options: SchemaContractFixtureOptions,
  active: Set<string>,
): unknown {
  if (!Array.isArray(branches) || branches.length === 0) return unavailable;
  if (keyword === 'allOf') return deriveAllOfFixture(branches, state, options, active);
  if (keyword === 'anyOf') return deriveAnyOfFixture(branches, state, options, active);
  return deriveOneOfFixture(branches, state, options, active);
}

function deriveAllOfFixture(
  branches: readonly unknown[],
  state: ModelIndex,
  options: SchemaContractFixtureOptions,
  active: Set<string>,
): unknown {
  const merged: Record<string, unknown> = {};
  for (const branch of branches) {
    const resolved = resolveDirectSchema(branch, state);
    const additionalProperties =
      resolved !== unavailable
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- schemaType check above confirms resolved is an object schema
          (resolved as Record<string, unknown>).additionalProperties
        : undefined;
    if (
      resolved === unavailable ||
      schemaType(resolved) !== 'object' ||
      (additionalProperties !== undefined && additionalProperties !== true)
    ) {
      return unavailable;
    }
    const fixture = deriveSchemaFixture(branch, state, options, active);
    if (!isObject(fixture)) return unavailable;
    for (const [key, value] of Object.entries(fixture)) {
      if (Object.hasOwn(merged, key) && stableJson(merged[key]) !== stableJson(value)) {
        return unavailable;
      }
      merged[key] = value;
    }
  }
  return merged;
}

function deriveAnyOfFixture(
  branches: readonly unknown[],
  state: ModelIndex,
  options: SchemaContractFixtureOptions,
  active: Set<string>,
): unknown {
  for (const branch of branches) {
    const fixture = deriveSchemaFixture(branch, state, options, active);
    if (fixture !== unavailable) return fixture;
  }
  return unavailable;
}

function deriveOneOfFixture(
  branches: readonly unknown[],
  state: ModelIndex,
  options: SchemaContractFixtureOptions,
  active: Set<string>,
): unknown {
  const kinds = branches.map((branch) => disjointJsonKind(branch, state));
  for (const [index, branch] of branches.entries()) {
    const kind = kinds[index];
    if (kind === null || kinds.filter((entry) => entry === kind).length !== 1) continue;
    const fixture = deriveSchemaFixture(branch, state, options, active);
    if (fixture !== unavailable) return fixture;
  }
  return unavailable;
}

function deriveStringFixture(
  schema: Record<string, unknown>,
  options: SchemaContractFixtureOptions,
): AvailableResult<string> {
  const declaredMinimum = integerConstraint(schema.minLength, 0);
  if (declaredMinimum === unavailable) return unavailableResult;
  const minimum = options.nonEmptyStrings === true ? Math.max(1, declaredMinimum) : declaredMinimum;
  const maximum = integerConstraint(schema.maxLength, Number.POSITIVE_INFINITY);
  if (maximum === unavailable || minimum > maximum) {
    return unavailableResult;
  }
  let formatted = null;
  if (schema.format === 'date-time') formatted = '2026-08-18T12:30:00Z';
  else if (schema.format === 'date') formatted = '2026-08-18';
  else if (schema.format === 'uuid') formatted = '123e4567-e89b-42d3-a456-426614174000';
  else if (schema.format !== undefined) return unavailableResult;
  const candidates =
    formatted === null
      ? ['x'.repeat(minimum), 'a'.repeat(minimum), '0'.repeat(minimum)]
      : [formatted];
  const fixture = candidates.find((value) => valueSatisfiesSimpleSchema(value, schema, 'string'));
  return fixture === undefined ? unavailableResult : availableResult(fixture);
}

function deriveNumberFixture(schema: Record<string, unknown>, integer: boolean): unknown {
  const multiple =
    typeof schema.multipleOf === 'number' && schema.multipleOf > 0 ? schema.multipleOf : 1;
  const candidates = [0, multiple, -multiple];
  for (const bound of [
    schema.minimum,
    schema.maximum,
    schema.exclusiveMinimum,
    schema.exclusiveMaximum,
  ]) {
    if (typeof bound === 'number' && Number.isFinite(bound)) {
      candidates.push(bound, bound + multiple, bound - multiple);
    }
  }
  return (
    candidates.find((value) =>
      valueSatisfiesSimpleSchema(value, schema, integer ? 'integer' : 'number'),
    ) ?? unavailable
  );
}

function valueSatisfiesSimpleSchema(
  value: unknown,
  schema: Record<string, unknown>,
  type: string | null,
): boolean {
  switch (type) {
    case 'string':
      return stringSatisfiesSimpleSchema(value, schema);
    case 'integer':
    case 'number':
      return numberSatisfiesSimpleSchema(value, schema, type);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    default:
      return false;
  }
}

function stringSatisfiesSimpleSchema(value: unknown, schema: Record<string, unknown>): boolean {
  if (typeof value !== 'string') return false;
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
  if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value))
    return false;
  if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  if (
    schema.format === 'date-time' &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  )
    return false;
  if (
    schema.format === 'uuid' &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  )
    return false;
  return (
    schema.format === undefined ||
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- format is only meaningful when it is a string; a non-string value fails this membership check anyway
    ['date', 'date-time', 'uuid'].includes(schema.format as string)
  );
}

function numberSatisfiesSimpleSchema(
  value: unknown,
  schema: Record<string, unknown>,
  type: string,
): boolean {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (type === 'integer' && !Number.isInteger(value))
  )
    return false;
  if (schema.format === 'int32' && (value < -2_147_483_648 || value > 2_147_483_647)) return false;
  return numberSatisfiesBounds(value, schema);
}

function numberSatisfiesBounds(value: number, schema: Record<string, unknown>): boolean {
  if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
  if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return false;
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) return false;
  if (typeof schema.multipleOf === 'number' && !Number.isInteger(value / schema.multipleOf))
    return false;
  return true;
}

function incompatibleValue(schema: unknown, state: ModelIndex): AvailableResult<false | string> {
  const resolved = resolveDirectSchema(schema, state);
  if (resolved === unavailable) return unavailableResult;
  switch (schemaType(resolved)) {
    case 'string':
    case 'number':
    case 'integer':
    case 'array':
    case 'object':
    case 'null':
      return availableResult(false);
    case 'boolean':
      return availableResult('invalid');
    default:
      return unavailableResult;
  }
}

function containsArray(
  schema: unknown,
  state: ModelIndex,
  active: Set<string> = new Set(),
): boolean {
  if (!isObject(schema)) return false;
  if (schema.$ref !== undefined) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- non-string $ref values simply miss every model pointer
    const target = state.modelsByPointer.get(schema.$ref as string);
    if (target === undefined || active.has(target.pointer)) return false;
    const next = new Set(active);
    next.add(target.pointer);
    return containsArray(target.schema, state, next);
  }
  if (schemaType(schema) === 'array') return true;
  if (
    isObject(schema.properties) &&
    Object.values(schema.properties).some((entry) => containsArray(entry, state, active))
  )
    return true;
  return ['allOf', 'anyOf', 'oneOf'].some(
    (keyword) =>
      Array.isArray(schema[keyword]) &&
      (schema[keyword] as readonly unknown[]).some((entry) => containsArray(entry, state, active)),
  );
}

function containsPopulatedArray(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0 || value.some(containsPopulatedArray);
  return isObject(value) && Object.values(value).some(containsPopulatedArray);
}

function findDateTimePath(
  schema: unknown,
  state: ModelIndex,
  path: readonly (number | string)[] = [],
  active: Set<string> = new Set(),
): readonly (number | string)[] | null {
  if (!isObject(schema)) return null;
  if (schema.$ref !== undefined) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- non-string $ref values simply miss every model pointer
    const target = state.modelsByPointer.get(schema.$ref as string);
    if (target === undefined || active.has(target.pointer)) return null;
    const next = new Set(active);
    next.add(target.pointer);
    return findDateTimePath(target.schema, state, path, next);
  }
  if (schemaType(schema) === 'string' && schema.format === 'date-time') return path;
  if (schemaType(schema) === 'array' && isObject(schema.items)) {
    return findDateTimePath(schema.items, state, [...path, 0], active);
  }
  if (isObject(schema.properties)) {
    for (const name of Object.keys(schema.properties).toSorted(compareText)) {
      const found = findDateTimePath(schema.properties[name], state, [...path, name], active);
      if (found !== null) return found;
    }
  }
  return null;
}

function resolveDirectSchema(
  schema: unknown,
  state: ModelIndex,
  active: Set<string> = new Set(),
): unknown {
  if (!isObject(schema)) return unavailable;
  if (schema.$ref === undefined) return schema;
  const meaningful = Object.keys(schema).filter(
    (key) => !annotationKeywords.has(key) && !key.startsWith('x-') && key !== 'nullable',
  );
  if (meaningful.some((key) => key !== '$ref')) return unavailable;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- non-string $ref values simply miss every model pointer
  const target = state.modelsByPointer.get(schema.$ref as string);
  if (target === undefined || active.has(target.pointer)) return unavailable;
  const next = new Set(active);
  next.add(target.pointer);
  return resolveDirectSchema(target.schema, state, next);
}

function disjointJsonKind(schema: unknown, state: ModelIndex): string | null {
  const resolved = resolveDirectSchema(schema, state);
  if (resolved === unavailable || compositionKeyword(resolved) !== null) return null;
  const type = schemaType(resolved);
  return type === 'integer' ? 'number' : type;
}

function schemaType(schema: unknown): string | null {
  if (!isObject(schema)) return null;
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type) && schema.type.length === 2 && schema.type.includes('null')) {
    return (schema.type as readonly string[]).find((entry) => entry !== 'null') ?? null;
  }
  return null;
}

function isNullableSchema(schema: unknown): boolean {
  return (
    isObject(schema) &&
    (schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes('null')))
  );
}

function compositionKeyword(schema: unknown): string | null {
  if (!isObject(schema)) return null;
  const found = ['allOf', 'oneOf', 'anyOf'].filter((keyword) => schema[keyword] !== undefined);
  return found.length === 1 ? found[0] : null;
}

function selectJsonContent(
  content: readonly { readonly mediaType: string; readonly schema: NormalizedSchema }[],
): { readonly mediaType: string; readonly schema: NormalizedSchema } | null {
  if (!Array.isArray(content)) return null;
  return (
    content
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
      })[0] ?? null
  );
}

function assertOperation(operation: NormalizedOperation, symbols: Map<string, string>): void {
  if (
    !isObject(operation) ||
    typeof operation.operationId !== 'string' ||
    !Array.isArray(operation.successResponses)
  ) {
    throw new TypeError('Normalized operation must contain an operation ID and success responses');
  }
  const symbol = operationSchemaName(operation.operationId);
  const previous = symbols.get(symbol);
  if (previous !== undefined) {
    throw new Error(
      `Operation schema name collision ${symbol}: ${previous} and ${operation.operationId}`,
    );
  }
  symbols.set(symbol, operation.operationId);
}

function indexModels(models: readonly NormalizedModel[]): ModelIndex {
  const modelsByName = new Map<string, NormalizedModel>();
  const modelsByPointer = new Map<string, NormalizedModel>();
  for (const model of models) {
    if (!isObject(model) || typeof model.name !== 'string' || typeof model.pointer !== 'string') {
      throw new TypeError('Normalized model must contain a name and pointer');
    }
    if (modelsByName.has(model.name) || modelsByPointer.has(model.pointer)) {
      throw new Error(`Duplicate normalized model: ${model.name}`);
    }
    modelsByName.set(model.name, model);
    modelsByPointer.set(model.pointer, model);
  }
  return { modelsByName, modelsByPointer };
}

function integerConstraint(value: unknown, fallback: number): number | typeof unavailable {
  if (value === undefined) return fallback;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : unavailable;
}

function readPath(value: unknown, path: readonly (number | string)[]): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- current was already confirmed to be a non-null object
    current = (current as Record<number | string, unknown>)[segment];
  }
  return current;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function availableResult<T>(value: T): AvailableResult<T> {
  return { available: true, value };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

import type { NormalizedModel, NormalizedSchema } from './normalize.ts';
import { isObject } from './internal/guards.ts';
import { sortJsonValue } from './internal/json.ts';
import { compareText } from './internal/text.ts';

export interface SchemaContractFixtureOptions {
  readonly nonEmptyStrings?: boolean;
  readonly populate?: boolean;
  readonly preferNonNull?: boolean;
}

interface ModelIndex {
  readonly modelsByPointer: Map<string, NormalizedModel>;
}

type AvailableResult<T> =
  | { readonly available: true; readonly value: T }
  | { readonly available: false };

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
    return deriveReferencedSchemaFixture(schema, meaningfulKeys, state, options, active);
  }

  const composition = compositionKeyword(schema);
  if (composition !== null) {
    return deriveComposedSchemaFixture(schema, composition, meaningfulKeys, state, options, active);
  }

  const type = schemaType(schema);
  const candidates = schema.const !== undefined ? [schema.const] : schema.enum;
  if (candidates !== undefined) {
    return deriveCandidateFixture(candidates, schema, type);
  }
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

function deriveReferencedSchemaFixture(
  schema: Record<string, unknown>,
  meaningfulKeys: readonly string[],
  state: ModelIndex,
  options: SchemaContractFixtureOptions,
  active: Set<string>,
): unknown {
  if (meaningfulKeys.some((key) => key !== '$ref') || typeof schema.$ref !== 'string') {
    return unavailable;
  }
  const target = state.modelsByPointer.get(schema.$ref);
  if (target === undefined || active.has(target.pointer)) return unavailable;
  return deriveSchemaFixture(target.schema, state, options, new Set([...active, target.pointer]));
}

function deriveComposedSchemaFixture(
  schema: Record<string, unknown>,
  composition: string,
  meaningfulKeys: readonly string[],
  state: ModelIndex,
  options: SchemaContractFixtureOptions,
  active: Set<string>,
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Array.isArray confirms array-ness; normalized required entries are strings
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

  switch (keyword) {
    case 'allOf':
      return deriveAllOfFixture(branches, state, options, active);
    case 'anyOf':
      return deriveAnyOfFixture(branches, state, options, active);
    default:
      return deriveOneOfFixture(branches, state, options, active);
  }
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

function deriveAllOfFixture(
  branches: readonly unknown[],
  state: ModelIndex,
  options: SchemaContractFixtureOptions,
  active: Set<string>,
): unknown {
  const merged: Record<string, unknown> = {};
  for (const branch of branches) {
    if (!mergeAllOfBranch(branch, merged, state, options, active)) return unavailable;
  }
  return merged;
}

function mergeAllOfBranch(
  branch: unknown,
  merged: Record<string, unknown>,
  state: ModelIndex,
  options: SchemaContractFixtureOptions,
  active: Set<string>,
): boolean {
  const resolved = resolveDirectSchema(branch, state);
  if (!isObject(resolved) || schemaType(resolved) !== 'object') return false;
  const additionalProperties = resolved.additionalProperties;
  if (additionalProperties !== undefined && additionalProperties !== true) return false;
  const fixture = deriveSchemaFixture(branch, state, options, active);
  if (!isObject(fixture)) return false;
  for (const [key, value] of Object.entries(fixture)) {
    if (Object.hasOwn(merged, key) && stableJson(merged[key]) !== stableJson(value)) return false;
    merged[key] = value;
  }
  return true;
}

function deriveStringFixture(
  schema: Record<string, unknown>,
  options: SchemaContractFixtureOptions,
): AvailableResult<string> {
  const declaredMinimum = integerConstraint(schema.minLength, 0);
  const maximum = integerConstraint(schema.maxLength, Number.POSITIVE_INFINITY);
  if (declaredMinimum === unavailable || maximum === unavailable) return unavailableResult;
  const minimum = options.nonEmptyStrings === true ? Math.max(1, declaredMinimum) : declaredMinimum;
  if (minimum > maximum) return unavailableResult;
  let formatted: string | null = null;
  if (schema.format === 'date-time') formatted = '2026-08-18T12:30:00Z';
  else if (schema.format === 'date') formatted = '2026-08-18';
  else if (schema.format === 'uuid') formatted = '123e4567-e89b-42d3-a456-426614174000';
  else if (schema.format !== undefined) return unavailableResult;
  const candidates =
    formatted === null
      ? ['x'.repeat(minimum), 'a'.repeat(minimum), '0'.repeat(minimum)]
      : [formatted];
  const fixture = candidates.find((value) => valueSatisfiesSimpleSchema(value, schema, 'string'));
  return fixture === undefined ? unavailableResult : { available: true, value: fixture };
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
      return valueSatisfiesStringSchema(value, schema);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    case 'number':
    case 'integer':
      return valueSatisfiesNumberSchema(value, schema, type);
    default:
      return false;
  }
}

function valueSatisfiesStringSchema(value: unknown, schema: Record<string, unknown>): boolean {
  if (typeof value !== 'string') return false;
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false;
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false;
  if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
    return false;
  }

  switch (schema.format) {
    case undefined:
      return true;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/u.test(value);
    case 'date-time':
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value);
    case 'uuid':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        value,
      );
    default:
      return false;
  }
}

function valueSatisfiesNumberSchema(
  value: unknown,
  schema: Record<string, unknown>,
  type: 'number' | 'integer',
): boolean {
  if (typeof value !== 'number') return false;
  if (!Number.isFinite(value)) return false;
  if (type === 'integer' && !Number.isInteger(value)) return false;
  if (schema.format === 'int32' && (value < -2_147_483_648 || value > 2_147_483_647)) {
    return false;
  }
  if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
  if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return false;
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) return false;
  return typeof schema.multipleOf !== 'number' || Number.isInteger(value / schema.multipleOf);
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
  if (meaningful.some((key) => key !== '$ref') || typeof schema.$ref !== 'string') {
    return unavailable;
  }
  const target = state.modelsByPointer.get(schema.$ref);
  if (target === undefined || active.has(target.pointer)) return unavailable;
  return resolveDirectSchema(target.schema, state, new Set([...active, target.pointer]));
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
    return (
      schema.type.find((entry): entry is string => typeof entry === 'string' && entry !== 'null') ??
      null
    );
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

function indexModels(models: readonly NormalizedModel[]): ModelIndex {
  const modelsByPointer = new Map<string, NormalizedModel>();
  for (const model of models) {
    if (!isObject(model) || typeof model.name !== 'string' || typeof model.pointer !== 'string') {
      throw new TypeError('Normalized model must contain a name and pointer');
    }
    if (modelsByPointer.has(model.pointer))
      throw new Error(`Duplicate normalized model: ${model.name}`);
    modelsByPointer.set(model.pointer, model);
  }
  return { modelsByPointer };
}

function integerConstraint(value: unknown, fallback: number): number | typeof unavailable {
  if (value === undefined) return fallback;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : unavailable;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

import {
  argumentNames,
  argumentPlacements,
  assertDataProperties,
  hasControlCharacter,
  hasPlacement,
  hasUnpairedSurrogate,
  isPlainRecord,
  requestError,
} from './guards.js';
import { validateHeaderValue } from './serialization.js';
import type {
  OperationParameterPlacement,
  ScalarParameterSchema,
  ValidatedDescriptor,
  ValidatedParameter,
} from './types.js';

export function validateArgumentsObject(
  descriptor: ValidatedDescriptor,
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    throw requestError(
      descriptor.operationId,
      [],
      'Operation arguments must be a plain object',
      'invalid_type',
    );
  }
  assertDataProperties(descriptor.operationId, value, []);
  for (const name of Object.keys(value)) {
    if (!argumentNames.has(name)) {
      throw requestError(
        descriptor.operationId,
        [name],
        `Undeclared operation argument: ${name}`,
        'unrecognized_key',
      );
    }
    if (name === 'body' ? descriptor.requestBody === null : !hasPlacement(descriptor, name)) {
      throw requestError(
        descriptor.operationId,
        [name],
        `Undeclared operation argument group: ${name}`,
        'unrecognized_key',
      );
    }
  }
  return value;
}

export function collectParameterValues(
  descriptor: ValidatedDescriptor,
  arguments_: Readonly<Record<string, unknown>>,
): Readonly<Record<OperationParameterPlacement, ReadonlyMap<string, unknown>>> {
  const result: Record<OperationParameterPlacement, Map<string, unknown>> = {
    path: new Map(),
    query: new Map(),
    header: new Map(),
  };
  for (const placement of argumentPlacements) {
    collectPlacementValues(descriptor, arguments_, placement, result[placement]);
  }
  return result;
}

function collectPlacementValues(
  descriptor: ValidatedDescriptor,
  arguments_: Readonly<Record<string, unknown>>,
  placement: OperationParameterPlacement,
  result: Map<string, unknown>,
): void {
  const parameters = descriptor.parameters.filter((parameter) => parameter.placement === placement);
  if (parameters.length === 0) return;
  const group = validateParameterGroup(
    descriptor.operationId,
    arguments_[placement],
    placement,
    parameters,
  );
  for (const parameter of parameters) {
    const parameterValue = group?.[parameter.name];
    if (parameterValue === undefined) {
      if (parameter.required) {
        throw requestError(
          descriptor.operationId,
          [placement, parameter.name],
          `Required ${placement} parameter is missing: ${parameter.name}`,
          'required',
        );
      }
      continue;
    }
    validateParameterValue(descriptor.operationId, parameter, parameterValue);
    result.set(parameter.name, parameterValue);
  }
}

function validateParameterGroup(
  operationId: string,
  value: unknown,
  placement: OperationParameterPlacement,
  parameters: readonly ValidatedParameter[],
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    throw requestError(
      operationId,
      [placement],
      `${placement} arguments must be a plain object`,
      'invalid_type',
    );
  }
  assertDataProperties(operationId, value, [placement]);
  for (const name of Object.keys(value)) {
    if (!parameters.some((parameter) => parameter.name === name)) {
      throw requestError(
        operationId,
        [placement, name],
        `Undeclared ${placement} parameter: ${name}`,
        'unrecognized_key',
      );
    }
  }
  return value;
}

function validateParameterValue(
  operationId: string,
  parameter: ValidatedParameter,
  value: unknown,
): void {
  const path: readonly (string | number)[] = [parameter.placement, parameter.name];
  if (parameter.schema.type !== 'array') {
    validateScalar(operationId, parameter.schema, value, path, parameter.placement);
    return;
  }
  if (!Array.isArray(value)) {
    throw requestError(
      operationId,
      path,
      `Parameter ${parameter.name} must be an array`,
      'invalid_type',
    );
  }
  if (parameter.placement === 'path' && value.length === 0) {
    throw requestError(
      operationId,
      path,
      'Path parameter arrays must not be empty',
      'invalid_value',
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw requestError(
        operationId,
        [...path, index],
        'Parameter arrays must not be sparse',
        'invalid_type',
      );
    }
    validateScalar(
      operationId,
      parameter.schema.items,
      value[index],
      [...path, index],
      parameter.placement,
    );
  }
}

function validateScalar(
  operationId: string,
  schema: ScalarParameterSchema,
  value: unknown,
  path: readonly (string | number)[],
  placement: OperationParameterPlacement,
): void {
  let valid = false;
  if (schema.type === 'string') valid = typeof value === 'string';
  if (schema.type === 'boolean') valid = typeof value === 'boolean';
  if (schema.type === 'number') valid = typeof value === 'number' && Number.isFinite(value);
  if (schema.type === 'integer') {
    valid = typeof value === 'number' && Number.isSafeInteger(value);
  }
  if (!valid) {
    throw requestError(operationId, path, `Parameter must be a ${schema.type}`, 'invalid_type');
  }
  if (placement === 'path' && typeof value === 'string') {
    if (
      value.length === 0 ||
      value === '.' ||
      value === '..' ||
      hasControlCharacter(value) ||
      hasUnpairedSurrogate(value)
    ) {
      throw requestError(
        operationId,
        path,
        'Path parameter contains an unsafe value',
        'invalid_value',
      );
    }
  }
  if (placement === 'query' && typeof value === 'string' && hasUnpairedSurrogate(value)) {
    throw requestError(
      operationId,
      path,
      'Query parameter contains invalid Unicode',
      'invalid_value',
    );
  }
  if (placement === 'header') validateHeaderValue(operationId, path, String(value));
}

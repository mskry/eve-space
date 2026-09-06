import {
  describeValue,
  hasControlCharacter,
  hasUnpairedSurrogate,
  headerNamePattern,
  isParameterPlacement,
  isRecord,
  isScalarSchemaType,
} from './guards.js';
import type { OperationParameterSchema, ValidatedParameter } from './types.js';

export function validateParameter(
  value: unknown,
  operationId: string,
  index: number,
): ValidatedParameter {
  if (!isRecord(value)) {
    throw new TypeError(`Operation descriptor ${operationId} parameter ${index} must be an object`);
  }
  const name = value.name;
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    hasControlCharacter(name) ||
    hasUnpairedSurrogate(name)
  ) {
    throw new TypeError(
      `Operation descriptor ${operationId} parameter ${index} has an invalid name`,
    );
  }
  const placement = value.placement;
  if (!isParameterPlacement(placement)) {
    throw new TypeError(
      `Unsupported parameter placement ${String(placement)} in operation descriptor ${operationId}`,
    );
  }
  if (typeof value.required !== 'boolean') {
    throw new TypeError(
      `Operation descriptor ${operationId} parameter ${name} required must be boolean`,
    );
  }
  const style = value.style;
  const expectedStyle = placement === 'query' ? 'form' : 'simple';
  if (style !== undefined && style !== null && style !== expectedStyle) {
    throw new TypeError(
      `Unsupported ${placement} parameter style ${describeValue(style)} for ${operationId}:${name}`,
    );
  }
  if (value.explode !== undefined && value.explode !== null && typeof value.explode !== 'boolean') {
    throw new TypeError(
      `Operation descriptor ${operationId} parameter ${name} explode must be boolean`,
    );
  }
  switch (placement) {
    case 'path':
      validatePathParameterDescriptor(value, operationId, name);
      break;
    case 'query':
      validateQueryParameterDescriptor(value, operationId, name);
      break;
    case 'header':
      validateHeaderParameterDescriptor(value, operationId, name);
      break;
  }
  const schema = validateParameterSchema(value.schema, operationId, name);
  return {
    name,
    placement,
    required: value.required,
    schema,
    explode: value.explode ?? placement === 'query',
  };
}

function validatePathParameterDescriptor(
  value: Readonly<Record<string, unknown>>,
  operationId: string,
  name: string,
): void {
  rejectAllowReserved(value, 'path', operationId, name);
}

function validateQueryParameterDescriptor(
  value: Readonly<Record<string, unknown>>,
  operationId: string,
  name: string,
): void {
  if (
    value.allowReserved !== undefined &&
    value.allowReserved !== null &&
    value.allowReserved !== false
  ) {
    throw new TypeError(`Reserved query expansion is not supported for ${operationId}:${name}`);
  }
}

function validateHeaderParameterDescriptor(
  value: Readonly<Record<string, unknown>>,
  operationId: string,
  name: string,
): void {
  rejectAllowReserved(value, 'header', operationId, name);
  if (!headerNamePattern.test(name)) {
    throw new TypeError(`Unsafe header name in operation descriptor ${operationId}: ${name}`);
  }
}

function rejectAllowReserved(
  value: Readonly<Record<string, unknown>>,
  placement: 'path' | 'header',
  operationId: string,
  name: string,
): void {
  if (value.allowReserved !== undefined) {
    throw new TypeError(
      `allowReserved is not supported for ${placement} parameter ${operationId}:${name}`,
    );
  }
}

export function validateParameterSchema(
  value: unknown,
  operationId: string,
  parameterName: string,
): OperationParameterSchema {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new TypeError(`Invalid parameter schema for ${operationId}:${parameterName}`);
  }
  if (isScalarSchemaType(value.type)) return { type: value.type };
  if (value.type === 'array') {
    if (!isRecord(value.items) || !isScalarSchemaType(value.items.type)) {
      throw new TypeError(`Unsupported array item schema for ${operationId}:${parameterName}`);
    }
    return { type: 'array', items: { type: value.items.type } };
  }
  throw new TypeError(
    `Unsupported parameter schema type ${value.type} for ${operationId}:${parameterName}`,
  );
}

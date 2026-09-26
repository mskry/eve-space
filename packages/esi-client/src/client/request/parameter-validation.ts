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

interface UnvalidatedReservedParameter {
  readonly allowReserved?: unknown;
}

const validateParameterName = (
  value: Parameters<typeof Object.keys>[0],
  operationId: string,
  index: number,
) => {
  const name = 'name' in value ? value.name : undefined;
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
  return name;
};

const validateParameterOptions = (
  value: Parameters<typeof Object.keys>[0],
  placement: ValidatedParameter['placement'],
  operationId: string,
  name: string,
) => {
  const style = 'style' in value ? value.style : undefined;
  const expectedStyle = placement === 'query' ? 'form' : 'simple';
  if (style !== undefined && style !== null && style !== expectedStyle) {
    throw new TypeError(
      `Unsupported ${placement} parameter style ${describeValue(style)} for ${operationId}:${name}`,
    );
  }
  const explode = 'explode' in value ? value.explode : undefined;
  if (explode !== undefined && explode !== null && typeof explode !== 'boolean') {
    throw new TypeError(
      `Operation descriptor ${operationId} parameter ${name} explode must be boolean`,
    );
  }
  return explode;
};

export function validateParameter(
  value: unknown,
  operationId: string,
  index: number,
): ValidatedParameter {
  if (!isRecord(value)) {
    throw new TypeError(`Operation descriptor ${operationId} parameter ${index} must be an object`);
  }
  const name = validateParameterName(value, operationId, index);
  const placement = 'placement' in value ? value.placement : undefined;
  if (!isParameterPlacement(placement)) {
    throw new TypeError(
      `Unsupported parameter placement ${String(placement)} in operation descriptor ${operationId}`,
    );
  }
  const required = 'required' in value ? value.required : undefined;
  if (typeof required !== 'boolean') {
    throw new TypeError(
      `Operation descriptor ${operationId} parameter ${name} required must be boolean`,
    );
  }
  const explode = validateParameterOptions(value, placement, operationId, name);
  const reserved = { allowReserved: 'allowReserved' in value ? value.allowReserved : undefined };
  switch (placement) {
    case 'path':
      validatePathParameterDescriptor(reserved, operationId, name);
      break;
    case 'query':
      validateQueryParameterDescriptor(reserved, operationId, name);
      break;
    case 'header':
      validateHeaderParameterDescriptor(reserved, operationId, name);
      break;
  }
  const schema = validateParameterSchema(
    'schema' in value ? value.schema : undefined,
    operationId,
    name,
  );
  return {
    explode: explode ?? placement === 'query',
    name,
    placement,
    required,
    schema,
  };
}

function validatePathParameterDescriptor(
  value: UnvalidatedReservedParameter,
  operationId: string,
  name: string,
): void {
  rejectAllowReserved(value, 'path', operationId, name);
}

function validateQueryParameterDescriptor(
  value: UnvalidatedReservedParameter,
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
  value: UnvalidatedReservedParameter,
  operationId: string,
  name: string,
): void {
  rejectAllowReserved(value, 'header', operationId, name);
  if (!headerNamePattern.test(name)) {
    throw new TypeError(`Unsafe header name in operation descriptor ${operationId}: ${name}`);
  }
}

function rejectAllowReserved(
  value: UnvalidatedReservedParameter,
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
  if (!isRecord(value) || !('type' in value) || typeof value.type !== 'string') {
    throw new TypeError(`Invalid parameter schema for ${operationId}:${parameterName}`);
  }
  if (isScalarSchemaType(value.type)) {
    return { type: value.type };
  }
  if (value.type === 'array') {
    if (
      !('items' in value) ||
      !isRecord(value.items) ||
      !('type' in value.items) ||
      !isScalarSchemaType(value.items.type)
    ) {
      throw new TypeError(`Unsupported array item schema for ${operationId}:${parameterName}`);
    }
    return { items: { type: value.items.type }, type: 'array' };
  }
  throw new TypeError(
    `Unsupported parameter schema type ${value.type} for ${operationId}:${parameterName}`,
  );
}

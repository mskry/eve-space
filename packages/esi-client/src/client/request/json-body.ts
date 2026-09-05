import { assertDataProperties, isPlainRecord, requestError } from './guards.js';
import type { ValidatedDescriptor } from './types.js';

export function serializeBody(
  descriptor: ValidatedDescriptor,
  arguments_: Readonly<Record<string, unknown>>,
  headers: Record<string, string>,
): string | undefined {
  const bodyDescriptor = descriptor.requestBody;
  if (bodyDescriptor === null) return undefined;
  const body = arguments_.body;
  if (body === undefined) {
    if (bodyDescriptor.required) {
      throw requestError(
        descriptor.operationId,
        ['body'],
        'Required request body is missing',
        'required',
      );
    }
    return undefined;
  }
  validateJsonValue(descriptor.operationId, body, ['body'], new WeakSet());
  Object.defineProperty(headers, 'content-type', {
    value: bodyDescriptor.mediaType,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return JSON.stringify(body);
}

function validateJsonValue(
  operationId: string,
  value: unknown,
  path: readonly (string | number)[],
  ancestors: WeakSet<object>,
): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw requestError(operationId, path, 'JSON numbers must be finite', 'invalid_json');
  }
  if (typeof value !== 'object') {
    throw requestError(
      operationId,
      path,
      'Request body must contain only JSON-native values',
      'invalid_json',
    );
  }
  if (ancestors.has(value)) {
    throw requestError(operationId, path, 'Request body must not contain cycles', 'invalid_json');
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    validateJsonArray(operationId, value, path, ancestors);
  } else {
    validateJsonObject(operationId, value, path, ancestors);
  }
  ancestors.delete(value);
}

function validateJsonArray(
  operationId: string,
  value: readonly unknown[],
  path: readonly (string | number)[],
  ancestors: WeakSet<object>,
): void {
  assertJsonArrayProperties(operationId, value, path);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw requestError(
        operationId,
        [...path, index],
        'JSON arrays must not be sparse',
        'invalid_json',
      );
    }
    validateJsonValue(operationId, value[index], [...path, index], ancestors);
  }
}

function validateJsonObject(
  operationId: string,
  value: object,
  path: readonly (string | number)[],
  ancestors: WeakSet<object>,
): void {
  if (!isPlainRecord(value)) {
    throw requestError(
      operationId,
      path,
      'Request body objects must be plain objects',
      'invalid_json',
    );
  }
  assertDataProperties(operationId, value, path);
  for (const key of Object.keys(value)) {
    validateJsonValue(operationId, value[key], [...path, key], ancestors);
  }
}

function assertJsonArrayProperties(
  operationId: string,
  value: readonly unknown[],
  path: readonly (string | number)[],
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key === 'symbol' || !/^(?:0|[1-9]\d*)$/u.test(key)) {
      throw requestError(
        operationId,
        path,
        'JSON arrays must not contain custom properties',
        'invalid_json',
      );
    }
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (property === undefined || !property.enumerable || !('value' in property)) {
      throw requestError(
        operationId,
        [...path, Number(key)],
        'JSON arrays must contain only enumerable data properties',
        'invalid_json',
      );
    }
  }
}

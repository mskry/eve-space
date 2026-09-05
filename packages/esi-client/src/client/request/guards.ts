import { EsiRequestValidationError } from '../errors.js';
import type {
  OperationHttpMethod,
  OperationParameterPlacement,
  ScalarParameterSchema,
  ValidatedDescriptor,
} from './types.js';

const httpMethods: ReadonlySet<string> = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
  'TRACE',
]);
export const argumentPlacements: readonly OperationParameterPlacement[] = [
  'path',
  'query',
  'header',
];
export const argumentNames: ReadonlySet<string> = new Set([...argumentPlacements, 'body']);
export const headerNamePattern: RegExp = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
export const placeholderPattern: RegExp = /\{([^{}]+)\}/gu;

export function requestError(
  operationId: string,
  path: readonly (string | number)[],
  message: string,
  code: string,
): EsiRequestValidationError {
  return new EsiRequestValidationError({
    operationId,
    issues: [{ path, message, code }],
  });
}

export function hasPlacement(descriptor: ValidatedDescriptor, value: string): boolean {
  return descriptor.parameters.some(({ placement }) => placement === value);
}

export function isScalarSchemaType(value: unknown): value is ScalarParameterSchema['type'] {
  return value === 'string' || value === 'boolean' || value === 'integer' || value === 'number';
}

export function isHttpMethod(value: unknown): value is OperationHttpMethod {
  return typeof value === 'string' && httpMethods.has(value);
}

export function isParameterPlacement(value: unknown): value is OperationParameterPlacement {
  return value === 'path' || value === 'query' || value === 'header';
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function validatedArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Expected a previously validated parameter array');
  return value;
}

export function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  return typeof value;
}

export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint === 0x7f) return true;
  }
  return false;
}

export function hasUnpairedSurrogate(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return true;
  }
  return false;
}

export function assertDataProperties(
  operationId: string,
  value: Readonly<Record<string, unknown>>,
  path: readonly (string | number)[],
): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') {
      throw requestError(operationId, path, 'Symbol properties are not supported', 'invalid_type');
    }
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (property === undefined || !property.enumerable || !('value' in property)) {
      throw requestError(
        operationId,
        [...path, key],
        'Arguments must contain only enumerable data properties',
        'invalid_type',
      );
    }
  }
}

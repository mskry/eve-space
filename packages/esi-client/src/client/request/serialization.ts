import { placeholderPattern, requestError, validatedArray } from './guards.js';
import type { ValidatedDescriptor, ValidatedParameter } from './types.js';

export function substitutePath(
  descriptor: ValidatedDescriptor,
  values: ReadonlyMap<string, unknown>,
): string {
  return descriptor.path.replace(placeholderPattern, (_placeholder, name: string) => {
    const parameter = descriptor.parameters.find(
      (candidate) => candidate.placement === 'path' && candidate.name === name,
    );
    if (parameter === undefined) {
      throw new TypeError(`Undeclared path placeholder ${name} in ${descriptor.operationId}`);
    }
    return serializePathValue(parameter, values.get(name));
  });
}

function serializePathValue(parameter: ValidatedParameter, value: unknown): string {
  if (parameter.schema.type === 'array') {
    return validatedArray(value)
      .map((item) => encodePathComponent(String(item)))
      .join(',');
  }
  return encodePathComponent(String(value));
}

export function serializeQuery(
  descriptor: ValidatedDescriptor,
  values: ReadonlyMap<string, unknown>,
): string {
  const pairs: string[] = [];
  for (const parameter of descriptor.parameters) {
    if (parameter.placement !== 'query' || !values.has(parameter.name)) continue;
    const encodedName = encodeRfc3986(parameter.name);
    const value = values.get(parameter.name);
    if (parameter.schema.type !== 'array') {
      pairs.push(`${encodedName}=${encodeRfc3986(String(value))}`);
      continue;
    }
    const items = validatedArray(value);
    if (parameter.explode) {
      if (items.length === 0) pairs.push(`${encodedName}=`);
      for (const item of items) {
        pairs.push(`${encodedName}=${encodeRfc3986(String(item))}`);
      }
      continue;
    }
    pairs.push(`${encodedName}=${items.map((item) => encodeRfc3986(String(item))).join(',')}`);
  }
  return pairs.join('&');
}

export function createHeaderRecord(
  descriptor: ValidatedDescriptor,
  values: ReadonlyMap<string, unknown>,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const parameter of descriptor.parameters) {
    if (parameter.placement !== 'header' || !values.has(parameter.name)) continue;
    const value = values.get(parameter.name);
    const serialized =
      parameter.schema.type === 'array'
        ? validatedArray(value).map(String).join(',')
        : String(value);
    validateHeaderValue(descriptor.operationId, ['headers', parameter.name], serialized);
    Object.defineProperty(headers, parameter.name.toLowerCase(), {
      value: serialized,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return headers;
}

export function validateHeaderValue(
  operationId: string,
  path: readonly (string | number)[],
  value: string,
): void {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x20 || codePoint > 0x7e) {
      throw requestError(
        operationId,
        path,
        'Header parameter contains an unsafe value',
        'invalid_header',
      );
    }
  }
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.codePointAt(0)?.toString(16).toUpperCase()}`,
  );
}

function encodePathComponent(value: string): string {
  return encodeRfc3986(value).replaceAll('.', '%2E');
}

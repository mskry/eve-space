import { compareText } from './text.ts';

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Same runtime check as isObject, but without a type predicate: some call sites validate a
// value whose static type is already concrete, and a predicate there would incorrectly widen
// (rather than preserve) that type after narrowing.
export function isRecordLike(value: unknown): boolean {
  return isObject(value);
}

export function assertRecord(
  value: unknown,
  context: string,
): asserts value is Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${context} must be an object`);
}

export function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  context: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${context} field: ${unknown.toSorted(compareText).join(', ')}`);
  }
}

export function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return 'unknown';
}

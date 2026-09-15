export function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, keys)
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

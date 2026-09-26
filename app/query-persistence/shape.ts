export const isRecord = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const hasExactKeys = <Value extends object>(value: Value, keys: readonly string[]) => {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

export const isExactRecord = (value: unknown, keys: readonly string[]): value is object =>
  isRecord(value) && hasExactKeys(value, keys)

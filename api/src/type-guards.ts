export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function getStringProperty(value: unknown, property: string) {
  if (!isRecord(value)) return undefined
  const result = value[property]
  return typeof result === 'string' ? result : undefined
}

export function getNumericProperty(value: unknown, property: string, fallback = 0) {
  if (!isRecord(value) || !(property in value)) return fallback
  return Number(value[property])
}

export function normalizePositiveSafeIntegerIds(ids: readonly unknown[], label: string) {
  const normalized = [...new Set(ids.map(Number))]
  if (normalized.some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw new Error(`${label} contains an invalid ID`)
  return normalized.toSorted((left, right) => left - right)
}

import { resolveUniverseNames } from '../universe/names.js'

// Upwell structures start here. PostUniverseNames cannot resolve them without the structure
// scope this capability deliberately does not request, and a 4xx costs five rate-budget tokens,
// so they are never submitted.
const upwellStructureIdFloor = 1_000_000_000_000

export async function loadFinanceLocationNames(locationIds: readonly number[]) {
  const resolvableIds = [...new Set(locationIds)].filter(
    (id) => Number.isSafeInteger(id) && id > 0 && id < upwellStructureIdFloor,
  )
  if (resolvableIds.length === 0) return new Map<number, string>()

  // A location label is presentational enrichment for a record the caller already loaded.
  // Resolution runs inside the resilience load callback, where throwing would classify as a
  // non-retryable failure and deny the envelope its stale fallback, so failure degrades to
  // unnamed locations instead.
  try {
    const resolved = await resolveUniverseNames(resolvableIds)
    return new Map([...resolved].map(([id, entry]) => [id, entry.name]))
  } catch {
    return new Map<number, string>()
  }
}

export function financeLocationName(
  locationId: number,
  namesByLocation: ReadonlyMap<number, string>,
) {
  return namesByLocation.get(locationId) ?? null
}

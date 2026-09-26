import type { PrivateQueryInvalidationScope } from './envelope'

const MAX_CHARACTER_WATERMARKS = 128

export interface ScopeWatermarks {
  readonly version: 2
  readonly invalidationGeneration: number
  readonly historyFromGeneration: number
  readonly fullGeneration: number
  readonly organizationGeneration: number
  readonly charactersGeneration: number
  readonly characterGenerations: Readonly<Record<string, number>>
}

export const initialScopeWatermarks = (generation = 0): ScopeWatermarks => ({
  version: 2,
  invalidationGeneration: generation,
  historyFromGeneration: generation,
  fullGeneration: 0,
  organizationGeneration: 0,
  charactersGeneration: 0,
  characterGenerations: {},
})

export const advanceScopeWatermarks = (
  previous: ScopeWatermarks,
  scope: PrivateQueryInvalidationScope,
): ScopeWatermarks => {
  const invalidationGeneration = previous.invalidationGeneration + 1
  const next: ScopeWatermarks = {
    ...previous,
    invalidationGeneration,
    fullGeneration: scope.kind === 'all' ? invalidationGeneration : previous.fullGeneration,
    organizationGeneration:
      scope.kind === 'organization' ? invalidationGeneration : previous.organizationGeneration,
    charactersGeneration:
      scope.kind === 'character' && scope.characterId === undefined
        ? invalidationGeneration
        : previous.charactersGeneration,
    characterGenerations:
      scope.kind === 'character' && scope.characterId !== undefined
        ? { ...previous.characterGenerations, [scope.characterId]: invalidationGeneration }
        : previous.characterGenerations,
  }
  const entries = Object.entries(next.characterGenerations)
  if (entries.length <= MAX_CHARACTER_WATERMARKS) {
    return next
  }
  entries.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  const dropped = entries.slice(MAX_CHARACTER_WATERMARKS)
  return {
    ...next,
    historyFromGeneration: Math.max(
      previous.historyFromGeneration,
      ...dropped.map(([, generation]) => generation),
    ),
    characterGenerations: Object.fromEntries(entries.slice(0, MAX_CHARACTER_WATERMARKS)),
  }
}

export const scopesSinceGeneration = (
  control: ScopeWatermarks | undefined,
  previousGeneration: number,
): PrivateQueryInvalidationScope[] => {
  if (
    !control ||
    previousGeneration < control.historyFromGeneration ||
    previousGeneration > control.invalidationGeneration ||
    control.fullGeneration > previousGeneration
  ) {
    return [{ kind: 'all' }]
  }
  const scopes: PrivateQueryInvalidationScope[] = []
  if (control.organizationGeneration > previousGeneration) {
    scopes.push({ kind: 'organization' })
  }
  if (control.charactersGeneration > previousGeneration) {
    scopes.push({ kind: 'character' })
  } else {
    for (const [id, generation] of Object.entries(control.characterGenerations)) {
      if (generation > previousGeneration) {
        scopes.push({ characterId: Number(id), kind: 'character' })
      }
    }
  }
  return scopes.length || previousGeneration === control.invalidationGeneration
    ? scopes
    : [{ kind: 'all' }]
}

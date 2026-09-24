import { getCharacterEsiScope } from '../../src/esi-gateway/catalog-interface.js'

interface CallableDefinition {
  readonly operation: string
}

export function createFeatureExecutionMock(
  execute: (definition: CallableDefinition, input: unknown, options?: unknown) => Promise<unknown>,
  executeMutation = execute,
) {
  return {
    combineEsiReadResultMetadata: combineMetadata,
    combineEsiResultMetadata: combineMetadata,
    createCharacterEsiMutation: (definition: CallableDefinition) =>
      callable(definition, executeMutation, getCharacterEsiScope(definition.operation as never)),
    createCharacterEsiRead: (definition: CallableDefinition) =>
      callable(definition, execute, getCharacterEsiScope(definition.operation as never)),
    createPublicEsiRead: (definition: CallableDefinition) => callable(definition, execute, null),
    toEsiReadResultMetadata: metadataFrom,
  }
}

function callable(
  definition: CallableDefinition,
  execute: (definition: CallableDefinition, input: unknown, options?: unknown) => Promise<unknown>,
  requiredScope: string | null,
) {
  return {
    execute: (input: unknown) => execute(definition, input, executionOptions(requiredScope, input)),
    operation: definition.operation,
    requiredScope,
  }
}

function executionOptions(requiredScope: string | null, input: unknown) {
  if (requiredScope !== null) {
    return {
      subjectLifecycleId: (input as { readonly subjectLifecycleId: string }).subjectLifecycleId,
    }
  }
  if (typeof input !== 'object' || input === null || !('signal' in input)) {
    return undefined
  }
  return { signal: (input as { readonly signal?: AbortSignal }).signal }
}

function metadataFrom(result: {
  readonly cachedUntil: string
  readonly validatedAt: string
  readonly stale: boolean
  readonly retryAt?: string
  readonly refreshFailureClass?: string
}) {
  return {
    cachedUntil: result.cachedUntil,
    stale: result.stale,
    validatedAt: result.validatedAt,
    ...(result.retryAt ? { retryAt: result.retryAt } : {}),
    ...(result.refreshFailureClass ? { refreshFailureClass: result.refreshFailureClass } : {}),
  }
}

function combineMetadata(results: readonly ReturnType<typeof metadataFrom>[]) {
  if (results.length === 0) {
    throw new Error('At least one ESI result is required')
  }
  const oldest = results.reduce((current, result) =>
    result.validatedAt < current.validatedAt ? result : current,
  )
  const oldestStale = results
    .filter((result) => result.stale)
    .reduce<(typeof results)[number] | undefined>(
      (current, result) =>
        !current || result.validatedAt < current.validatedAt ? result : current,
      undefined,
    )
  const retryAt = results
    .filter(
      (result) => result.stale && result.retryAt && Number.isFinite(Date.parse(result.retryAt)),
    )
    .map((result) => result.retryAt!)
    .toSorted((left, right) => Date.parse(right) - Date.parse(left))[0]
  return {
    cachedUntil: results.reduce(
      (current, result) => (result.cachedUntil < current ? result.cachedUntil : current),
      results[0]?.cachedUntil ?? '',
    ),
    stale: oldestStale !== undefined,
    validatedAt: oldest.validatedAt,
    ...(oldestStale?.refreshFailureClass
      ? { refreshFailureClass: oldestStale.refreshFailureClass }
      : {}),
    ...(retryAt ? { retryAt } : {}),
  }
}

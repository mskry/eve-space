import type { CharacterAssetsResponse } from '../queries/character-assets'
import type { AssetCollection, AssetResourceState } from '../types/assets'
import { ApiQueryError } from './query-error'

// ESI reports an unnamed item as the literal "None", and returns non-breaking space as a raw
// entity. Neither is a name.
function normalizeCustomName(value: string | null) {
  const name = value
    ?.replaceAll(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replaceAll(/\s/g, ' ')
    .trim()
  return !name || name === 'None' ? null : name
}

export function mapCharacterAssets(response: CharacterAssetsResponse): AssetCollection {
  return {
    assets: response.assets.map((asset) => ({
      itemId: asset.itemId,
      typeId: asset.typeId,
      typeName: asset.typeName,
      groupId: asset.groupId,
      groupName: asset.groupName,
      categoryId: asset.categoryId,
      categoryName: asset.categoryName,
      unitVolume: asset.unitVolume,
      totalVolume: asset.totalVolume,
      quantity: asset.quantity,
      isSingleton: asset.isSingleton,
      isBlueprintCopy: asset.isBlueprintCopy,
      customName: normalizeCustomName(asset.customName),
      locationId: asset.locationId,
      locationType: asset.locationType,
      locationName: asset.locationName,
      locationFlag: asset.locationFlag,
      parentItemId: asset.parentItemId,
    })),
    enrichment: {
      types: response.enrichment.types,
      names: response.enrichment.names,
      locations: response.enrichment.locations,
    },
    stale: response.stale,
    validatedAt: response.validatedAt,
    refreshFailureClass: response.refreshFailureClass ?? null,
    retryAt: response.retryAt ?? null,
  }
}

export function mapCharacterAssetsResourceState({
  data,
  error,
  loading,
}: {
  data?: AssetCollection | null
  error: unknown
  loading: boolean
}): AssetResourceState {
  const normalizedError = error instanceof Error ? error : null
  const apiError = normalizedError instanceof ApiQueryError ? normalizedError : null
  const accessRequired = apiError?.code === 'EVE_SCOPE_REQUIRED'
  const authorizationRejected = apiError?.code === 'EVE_REAUTH_REQUIRED'
  const authorizationRequired = accessRequired || authorizationRejected
  const retainedFailureClass = data?.stale ? data.refreshFailureClass : null
  const cooldown =
    apiError?.status === 429 ||
    apiError?.code === 'ESI_COOLDOWN' ||
    retainedFailureClass === 'esi-cooldown'
  const retained = data != null

  return {
    phase: resourcePhase({
      retained,
      loading,
      accessRequired,
      authorizationRejected,
      cooldown,
      unavailable: normalizedError !== null,
    }),
    initialLoading: loading && !retained,
    refreshing: loading && retained,
    refreshFailed: retained && normalizedError !== null,
    stale: data?.stale ?? false,
    message: resourceMessage(normalizedError, apiError, retainedFailureClass),
    statusLabel: resourceStatusLabel(normalizedError, apiError, cooldown),
    canRetry:
      !cooldown &&
      ((normalizedError !== null && !authorizationRequired) || retainedFailureClass !== null),
    retryAt: apiError?.retryAt ?? data?.retryAt ?? null,
    action:
      authorizationRequired && apiError?.authorizeUrl
        ? { href: apiError.authorizeUrl, label: 'AUTHORIZE ASSETS FOR THIS CHARACTER' }
        : null,
  }
}

function resourcePhase({
  retained,
  loading,
  accessRequired,
  authorizationRejected,
  cooldown,
  unavailable,
}: {
  retained: boolean
  loading: boolean
  accessRequired: boolean
  authorizationRejected: boolean
  cooldown: boolean
  unavailable: boolean
}): AssetResourceState['phase'] {
  if (retained) return 'ready'
  if (loading) return 'loading'
  if (accessRequired) return 'access-required'
  if (authorizationRejected) return 'authorization-rejected'
  if (cooldown) return 'cooldown'
  if (unavailable) return 'unavailable'
  return 'ready'
}

function resourceMessage(
  error: Error | null,
  apiError: ApiQueryError | null,
  retainedFailureClass: string | null,
) {
  if (error) return assetsErrorMessage(error, apiError)
  if (retainedFailureClass) return retainedFailureMessage(retainedFailureClass)
  return null
}

function resourceStatusLabel(
  error: Error | null,
  apiError: ApiQueryError | null,
  cooldown: boolean,
) {
  if (!error) return null
  if (cooldown) return 'ESI / QUOTA'
  return `ESI ${apiError?.status ?? 502} / ASSETS`
}

function retainedFailureMessage(failureClass: string) {
  if (failureClass === 'esi-cooldown') {
    return 'Live ESI validation is cooling down; retained inventory is shown.'
  }
  return 'Live ESI validation is unavailable; retained inventory is shown.'
}

function assetsErrorMessage(error: Error, apiError: ApiQueryError | null) {
  const message = error.message.trim()
    ? error.message
    : 'This character asset collection is temporarily unavailable.'
  if (apiError?.status === 429 && apiError.retryAfterSeconds !== undefined) {
    return `${message} Retry after ${apiError.retryAfterSeconds} seconds.`
  }
  return message
}

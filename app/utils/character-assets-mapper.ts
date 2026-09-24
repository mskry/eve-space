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
      solarSystemId: asset.solarSystemId,
      solarSystemSecurityStatus: asset.solarSystemSecurityStatus,
      locationFlag: asset.locationFlag,
      parentItemId: asset.parentItemId,
    })),
    enrichment: {
      locations: response.enrichment.locations,
      names: response.enrichment.names,
      types: response.enrichment.types,
    },
    refreshFailureClass: response.refreshFailureClass ?? null,
    retryAt: response.retryAt ?? null,
    stale: response.stale,
    validatedAt: response.validatedAt,
  }
}

export function mapCharacterAssetsResourceState({
  data,
  error,
  loading,
  parked = false,
}: {
  data?: AssetCollection | null
  error: unknown
  loading: boolean
  // An enabled query holding no data with no request in flight: no verdict was ever reached, so it
  // must offer a retry rather than a spinner that nothing will ever resolve.
  parked?: boolean
}): AssetResourceState {
  const {
    normalizedError,
    apiError,
    accessRequired,
    authorizationRejected,
    authorizationRequired,
    retainedFailureClass,
    cooldown,
    retained,
  } = classifyAssetsResource(error, data)

  return {
    phase: resourcePhase({
      accessRequired,
      authorizationRejected,
      cooldown,
      loading,
      retained,
      unavailable: normalizedError !== null || parked,
    }),
    ...assetsLoadingState(loading, retained, normalizedError),
    stale: data?.stale ?? false,
    message: resourceMessage(normalizedError, apiError, retainedFailureClass, parked),
    statusLabel: parked
      ? 'IDLE / ASSETS'
      : resourceStatusLabel(normalizedError, apiError, cooldown),
    canRetry: canRetryAssets(
      cooldown,
      normalizedError,
      authorizationRequired,
      retainedFailureClass,
      parked,
    ),
    retryAt: apiError?.retryAt ?? data?.retryAt ?? null,
    action:
      authorizationRequired && apiError?.authorizeUrl
        ? { href: apiError.authorizeUrl, label: 'AUTHORIZE ASSETS FOR THIS CHARACTER' }
        : null,
  }
}

function classifyAssetsResource(error: unknown, data?: AssetCollection | null) {
  const normalizedError = error instanceof Error ? error : null
  const apiError = normalizedError instanceof ApiQueryError ? normalizedError : null
  const accessRequired = apiError?.code === 'EVE_SCOPE_REQUIRED'
  const authorizationRejected = apiError?.code === 'EVE_REAUTH_REQUIRED'
  const retainedFailureClass = data?.stale ? data.refreshFailureClass : null
  return {
    accessRequired,
    apiError,
    authorizationRejected,
    authorizationRequired: accessRequired || authorizationRejected,
    cooldown: isAssetsCooldown(apiError, retainedFailureClass),
    normalizedError,
    retained: data != null,
    retainedFailureClass,
  }
}

function assetsLoadingState(loading: boolean, retained: boolean, error: Error | null) {
  return {
    initialLoading: loading && !retained,
    refreshFailed: retained && error !== null,
    refreshing: loading && retained,
  }
}

function isAssetsCooldown(apiError: ApiQueryError | null, failureClass: string | null) {
  return (
    apiError?.status === 429 || apiError?.code === 'ESI_COOLDOWN' || failureClass === 'esi-cooldown'
  )
}

function canRetryAssets(
  cooldown: boolean,
  error: Error | null,
  authorizationRequired: boolean,
  failureClass: string | null,
  parked: boolean,
) {
  return (
    !cooldown && ((error !== null && !authorizationRequired) || failureClass !== null || parked)
  )
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
  if (retained) {
    return 'ready'
  }
  if (loading) {
    return 'loading'
  }
  if (accessRequired) {
    return 'access-required'
  }
  if (authorizationRejected) {
    return 'authorization-rejected'
  }
  if (cooldown) {
    return 'cooldown'
  }
  if (unavailable) {
    return 'unavailable'
  }
  return 'ready'
}

function resourceMessage(
  error: Error | null,
  apiError: ApiQueryError | null,
  retainedFailureClass: string | null,
  parked: boolean,
) {
  if (error) {
    return assetsErrorMessage(error, apiError)
  }
  if (retainedFailureClass) {
    return retainedFailureMessage(retainedFailureClass)
  }
  if (parked) {
    return 'Character assets are not loaded. Retry to request them again.'
  }
  return null
}

function resourceStatusLabel(
  error: Error | null,
  apiError: ApiQueryError | null,
  cooldown: boolean,
) {
  if (!error) {
    return null
  }
  if (cooldown) {
    return 'ESI / QUOTA'
  }
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

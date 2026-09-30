import type { PlatformPublicRouteCapabilities } from '@eve-space/platform-module-contract/server'
import {
  globalPlexMarketRegionId,
  marketCollectionBounds,
  plexMarketTypeId,
  supportedPublicMarketRegions,
} from './market-bounds.js'

export interface MarketPublicProfileInput {
  readonly regionId: number
  readonly mode: 'region' | 'watched-types'
  readonly stationIds: readonly number[]
  readonly watchedTypeIds: readonly number[]
  readonly enabled: boolean
}

export interface MarketPublicProfile extends MarketPublicProfileInput {
  readonly stationIds: readonly number[]
  readonly watchedTypeIds: readonly number[]
  readonly stationRevision: {
    readonly buildNumber: number
    readonly ingestVersion: number
    readonly ingestedAt: string
  }
}

type StationReads = Pick<
  PlatformPublicRouteCapabilities<readonly ['market-station-regions']>['coreData'],
  'marketStationRegions'
>

const boundedIds = (ids: readonly number[], maximum: number, label: string) => {
  if (ids.length > maximum || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new RangeError(`${label} must contain at most ${maximum} positive IDs`)
  }
  const unique = [...new Set(ids)]
  if (unique.length !== ids.length) throw new TypeError(`${label} cannot repeat an ID`)
  return unique.toSorted((left, right) => left - right)
}

const assertProfileConfiguration = (
  input: MarketPublicProfileInput,
  existing: readonly Pick<MarketPublicProfileInput, 'regionId' | 'mode' | 'enabled'>[],
) => {
  if (!Number.isSafeInteger(input.regionId) || input.regionId <= 0) {
    throw new TypeError('Market region ID must be positive')
  }
  if (!supportedPublicMarketRegions.some((supported) => supported === input.regionId)) {
    throw new TypeError('Market region is not in the supported public profile set')
  }
  if (input.mode !== 'region' && input.mode !== 'watched-types') {
    throw new TypeError('Unsupported Market collection mode')
  }
  if (existing.length >= marketCollectionBounds.maximumProfiles) {
    throw new RangeError('Market profile limit reached')
  }
  if (
    input.mode === 'region' &&
    existing.some((profile) => profile.mode === 'region' && profile.enabled)
  ) {
    throw new RangeError('Only one enabled full-region Market profile is supported')
  }
}

export const validateMarketPublicProfile = async (
  input: MarketPublicProfileInput,
  existing: readonly Pick<MarketPublicProfileInput, 'regionId' | 'mode' | 'enabled'>[],
  coreData: StationReads,
): Promise<MarketPublicProfile> => {
  assertProfileConfiguration(input, existing)
  const watchedTypeIds = boundedIds(
    input.watchedTypeIds,
    marketCollectionBounds.maximumWatchedTypesPerProfile,
    'Watched Market types',
  )
  if (input.mode === 'watched-types' && watchedTypeIds.length === 0) {
    throw new TypeError('A watched-type profile requires at least one type')
  }
  if (input.mode === 'region' && watchedTypeIds.length !== 0) {
    throw new TypeError('A full-region profile cannot declare watched types')
  }
  const stationIds = boundedIds(
    input.stationIds,
    marketCollectionBounds.maximumStationIdsPerProfile,
    'Market stations',
  )
  if (
    input.regionId === globalPlexMarketRegionId &&
    (input.mode !== 'watched-types' ||
      watchedTypeIds.length !== 1 ||
      watchedTypeIds[0] !== plexMarketTypeId ||
      stationIds.length !== 0)
  ) {
    throw new TypeError('Global PLEX Market requires only PLEX and no station filter')
  }
  const stations = await coreData.marketStationRegions({ stationIds })
  if (!stations.complete || stations.rows.length !== stationIds.length) {
    throw new TypeError('An unknown public NPC station was selected')
  }
  if (stations.rows.some((station) => station.regionId !== input.regionId)) {
    throw new TypeError('A selected station does not belong to the Market region')
  }
  return {
    ...input,
    stationIds,
    watchedTypeIds,
    stationRevision: stations.revision,
  }
}

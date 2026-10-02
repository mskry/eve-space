import type { PlatformPublicRouteCapabilities } from '@eve-space/platform-module-contract/server'
import type { MarketBookReads } from './persistence.js'
import { marketOrderExpiryAt } from './market-order-expiry.js'
import { globalPlexMarketRegionId } from './market-bounds.js'

type ProfileReads = Pick<MarketBookReads, 'listMarketProfiles'>
type ObservationReads = ProfileReads &
  Pick<MarketBookReads, 'readMarketObservation' | 'readMarketReplacementStatus'>
type OrderReads = Pick<MarketBookReads, 'readMarketObservation' | 'readMarketOrderRows'>
type BookOrderRows = Awaited<ReturnType<MarketBookReads['readMarketOrderRows']>>['rows']
type LocationCoreData = PlatformPublicRouteCapabilities<
  readonly ['static-location-labels']
>['coreData']
type LocationLabels = Awaited<ReturnType<LocationCoreData['staticLocationLabels']>>['rows']
type OrderInput = Parameters<OrderReads['readMarketOrderRows']>[0]

export const marketSourceStatus = (freshUntil: string) =>
  Date.parse(freshUntil) > Date.now() ? ('current' as const) : ('stale' as const)

const collectionStatus = (failure: string | null) =>
  failure === null ? ('ready' as const) : ('profile-failed' as const)

export const readEnabledMarketProfiles = async (persistence: ProfileReads) => {
  const profiles = await persistence.listMarketProfiles({ enabledOnly: true })
  return profiles.map(({ profileId, revision, regionId, mode, stationIds, watchedTypeIds }) => ({
    profileId,
    revision,
    regionId,
    marketScope:
      regionId === globalPlexMarketRegionId ? ('global-plex' as const) : ('region' as const),
    mode,
    stationIds,
    watchedTypeIds,
  }))
}

export const readMarketBookState = async (
  persistence: ObservationReads,
  profileId: string,
  typeId: number,
) => {
  const profiles = await persistence.listMarketProfiles({ enabledOnly: true })
  const profile = profiles.find((entry) => entry.profileId === profileId)
  if (!profile) return null
  const observation = await persistence.readMarketObservation({
    profileId,
    typeId,
    observationId: null,
  })
  const replacement = await persistence.readMarketReplacementStatus({ profileId, typeId })
  return {
    profileRevision: profile.revision,
    status: observation ? marketSourceStatus(observation.freshUntil) : ('uncollected' as const),
    collectionStatus: collectionStatus(profile.lastFailureClass),
    replacement: replacement
      ? { status: 'incomplete' as const, attemptedAt: replacement.attemptedAt }
      : null,
    observation,
  }
}

export const marketLocationIdsForRows = (rows: BookOrderRows) => [
  ...new Set(
    rows.flatMap((row) =>
      [row.locationId, row.solarSystemId].filter((id): id is number => id !== null),
    ),
  ),
]

export const labelMarketRows = (rows: BookOrderRows, labels: LocationLabels) => {
  const byId = new Map(labels.map((label) => [label.locationId, label]))
  return rows.map((row) => {
    const location = byId.get(row.locationId)
    const system = location ?? (row.solarSystemId ? byId.get(row.solarSystemId) : undefined)
    return {
      ...row,
      locationName:
        location?.name ??
        (system ? `${system.name} · Location ${row.locationId}` : `Location ${row.locationId}`),
      solarSystemSecurityStatus: system?.solarSystemSecurityStatus ?? null,
      expiryAt: marketOrderExpiryAt(row.issuedAt, row.durationDays),
    }
  })
}

export const readMarketOrderPage = async (
  persistence: OrderReads,
  coreData: LocationCoreData,
  profileId: string,
  input: OrderInput,
) => {
  const observation = await persistence.readMarketObservation({
    profileId,
    typeId: input.typeId,
    observationId: input.observationId,
  })
  if (!observation) return null
  const page = await persistence.readMarketOrderRows(input)
  const labels = await coreData.staticLocationLabels({
    locationIds: marketLocationIdsForRows(page.rows),
  })
  return {
    observation,
    observationId: input.observationId,
    rows: labelMarketRows(page.rows, labels.rows),
    hasMore: page.hasMore,
    labelsComplete: labels.complete,
  }
}

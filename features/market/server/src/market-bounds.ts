export const marketCollectionBounds = {
  maximumProfiles: 4,
  maximumRegionProfiles: 1,
  maximumWatchedTypesPerProfile: 16,
  maximumStationIdsPerProfile: 100,
  maximumPagesPerObservation: 512,
  maximumOrdersPerObservation: 512_000,
  maximumOrderDurationDays: 365,
  maximumConcurrentPages: 3,
  maximumQueuedProfiles: 16,
} as const

export const globalPlexMarketRegionId = 19000001
export const plexMarketTypeId = 44992
export const supportedPublicMarketRegions = [
  10000002,
  10000043,
  10000058,
  globalPlexMarketRegionId,
] as const

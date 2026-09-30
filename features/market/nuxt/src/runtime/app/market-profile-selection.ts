const plexTypeId = 44992

export interface SelectableMarketProfile {
  readonly profileId: string
  readonly marketScope: 'region' | 'global-plex'
  readonly watchedTypeIds: readonly number[]
}

export const isGlobalPlexItem = (typeId: number | null) => typeId === plexTypeId

export const eligibleMarketProfiles = <Profile extends SelectableMarketProfile>(
  profiles: readonly Profile[],
  typeId: number | null,
) => {
  if (isGlobalPlexItem(typeId)) {
    return profiles.filter(
      (profile) =>
        profile.marketScope === 'global-plex' && profile.watchedTypeIds.includes(plexTypeId),
    )
  }
  return profiles.filter((profile) => profile.marketScope === 'region')
}

export const selectMarketProfile = <Profile extends SelectableMarketProfile>(
  profiles: readonly Profile[],
  requestedProfileId: string,
) =>
  profiles.find((profile) => profile.profileId === requestedProfileId) ??
  profiles.find((profile) => profile.marketScope === 'global-plex') ??
  profiles[0] ??
  null

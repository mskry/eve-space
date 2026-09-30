export interface SelectableMarketProfile {
  readonly profileId: string
  readonly marketScope: 'region' | 'global-plex'
  readonly watchedTypeIds: readonly number[]
}

export const eligibleMarketProfiles = <Profile extends SelectableMarketProfile>(
  profiles: readonly Profile[],
  typeId: number | null,
) =>
  profiles.filter(
    (profile) =>
      profile.marketScope === 'region' ||
      (typeId !== null && profile.watchedTypeIds.includes(typeId)),
  )

export const selectMarketProfile = <Profile extends SelectableMarketProfile>(
  profiles: readonly Profile[],
  requestedProfileId: string,
) =>
  profiles.find((profile) => profile.profileId === requestedProfileId) ??
  profiles.find((profile) => profile.marketScope === 'global-plex') ??
  profiles[0] ??
  null

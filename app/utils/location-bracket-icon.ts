import type { CharacterRosterEntry } from '../queries/characters'

export type CharacterLocationType = NonNullable<CharacterRosterEntry['location']>['locationType']

export interface LocationBracketIdentity {
  locationType: CharacterLocationType | null | undefined
  stationId: number | undefined
  structureId: number | undefined
}

export function locationBracketIconSource({
  locationType,
  stationId,
  structureId,
}: LocationBracketIdentity) {
  if (stationId !== undefined || locationType === 'station') {
    return '/images/eve-brackets/station.png'
  }
  if (structureId !== undefined || locationType === 'structure') {
    return '/images/eve-brackets/structure.png'
  }
  return '/images/eve-brackets/solarSystem.png'
}

import { describe, expect, it } from 'vitest'
import { locationBracketIconSource } from '../../app/utils/location-bracket-icon'

describe('locationBracketIconSource', () => {
  it.each([
    [
      'station category',
      'station.png',
      { locationType: 'station', stationId: undefined, structureId: undefined },
    ],
    [
      'structure category',
      'structure.png',
      { locationType: 'structure', stationId: undefined, structureId: undefined },
    ],
    [
      'space category with no ids',
      'solarSystem.png',
      { locationType: 'space', stationId: undefined, structureId: undefined },
    ],
    [
      'bare station ID',
      'station.png',
      { locationType: undefined, stationId: 60_003_768, structureId: undefined },
    ],
    [
      'bare structure ID',
      'structure.png',
      { locationType: undefined, stationId: undefined, structureId: 1_035_466_617_946 },
    ],
    [
      'stale space category with a station ID',
      'station.png',
      { locationType: 'space', stationId: 60_003_768, structureId: undefined },
    ],
    [
      'no location details',
      'solarSystem.png',
      { locationType: undefined, stationId: undefined, structureId: undefined },
    ],
  ] as const)('maps %s to %s', (_label, filename, identity) => {
    expect(locationBracketIconSource(identity)).toBe(`/images/eve-brackets/${filename}`)
  })
})

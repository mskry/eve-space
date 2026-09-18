import { describe, expect, it } from 'vitest'
import { locationBracketIconSource } from '../../app/utils/location-bracket-icon'

describe('locationBracketIconSource', () => {
  it.each([
    ['station.png', { locationType: 'station', stationId: undefined, structureId: undefined }],
    ['structure.png', { locationType: 'structure', stationId: undefined, structureId: undefined }],
    ['solarSystem.png', { locationType: 'space', stationId: undefined, structureId: undefined }],
    ['station.png', { locationType: undefined, stationId: 60_003_768, structureId: undefined }],
    [
      'structure.png',
      { locationType: undefined, stationId: undefined, structureId: 1_035_466_617_946 },
    ],
  ] as const)('maps a location identity to %s', (filename, identity) => {
    expect(locationBracketIconSource(identity)).toBe(`/images/eve-brackets/${filename}`)
  })

  it('uses the concrete station identifier when the category is stale', () => {
    expect(
      locationBracketIconSource({
        locationType: 'space',
        stationId: 60_003_768,
        structureId: undefined,
      }),
    ).toBe('/images/eve-brackets/station.png')
  })

  it('uses the solar-system bracket without location details', () => {
    expect(
      locationBracketIconSource({
        locationType: undefined,
        stationId: undefined,
        structureId: undefined,
      }),
    ).toBe('/images/eve-brackets/solarSystem.png')
  })
})

import { describe, expect, it } from 'vitest'
import { shipBracketIconSource } from '../../app/utils/ship-bracket-icon'

describe('shipBracketIconSource', () => {
  it.each([
    [25, 'frigate_16.png'],
    [26, 'cruiser_16.png'],
    [27, 'battleship_16.png'],
    [28, 'industrial_16.png'],
    [29, 'capsule_16.png'],
    [30, 'titan_16.png'],
    [31, 'shuttle_16.png'],
    [237, 'rookie_16.png'],
    [419, 'battleCruiser_16.png'],
    [420, 'destroyer_16.png'],
    [463, 'miningBarge_16.png'],
    [485, 'dreadnought_16.png'],
    [513, 'freighter_16.png'],
    [547, 'carrier_16.png'],
    [659, 'supercarrier_16.png'],
    [941, 'industrialCommand_16.png'],
    [1283, 'miningFrigate_16.png'],
    [1538, 'forceAuxiliary_16.png'],
  ])('maps ship group %i to %s', (groupId, filename) => {
    expect(shipBracketIconSource(groupId)).toBe(`/images/eve-brackets/${filename}`)
  })

  it.each([undefined, null, 1])('uses the generic ship bracket for group %s', (groupId) => {
    expect(shipBracketIconSource(groupId)).toBe('/images/eve-brackets/ship.png')
  })
})

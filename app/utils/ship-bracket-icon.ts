type ShipBracketIconName =
  | 'battleCruiser'
  | 'battleship'
  | 'capsule'
  | 'carrier'
  | 'cruiser'
  | 'destroyer'
  | 'dreadnought'
  | 'forceAuxiliary'
  | 'freighter'
  | 'frigate'
  | 'industrial'
  | 'industrialCommand'
  | 'miningBarge'
  | 'miningFrigate'
  | 'rookie'
  | 'shuttle'
  | 'supercarrier'
  | 'titan'

const shipBracketIconByGroupId = new Map<number, ShipBracketIconName>([
  [1022, 'frigate'],
  [1201, 'battleCruiser'],
  [1202, 'industrial'],
  [1283, 'miningFrigate'],
  [1305, 'destroyer'],
  [1527, 'frigate'],
  [1534, 'destroyer'],
  [1538, 'forceAuxiliary'],
  [1972, 'cruiser'],
  [237, 'rookie'],
  [25, 'frigate'],
  [26, 'cruiser'],
  [27, 'battleship'],
  [28, 'industrial'],
  [29, 'capsule'],
  [30, 'titan'],
  [31, 'shuttle'],
  [324, 'frigate'],
  [358, 'cruiser'],
  [380, 'industrial'],
  [419, 'battleCruiser'],
  [420, 'destroyer'],
  [4594, 'dreadnought'],
  [463, 'miningBarge'],
  [485, 'dreadnought'],
  [4902, 'industrialCommand'],
  [5087, 'shuttle'],
  [5120, 'carrier'],
  [513, 'freighter'],
  [540, 'battleCruiser'],
  [541, 'destroyer'],
  [543, 'miningBarge'],
  [547, 'carrier'],
  [659, 'supercarrier'],
  [830, 'frigate'],
  [831, 'frigate'],
  [832, 'cruiser'],
  [833, 'cruiser'],
  [834, 'frigate'],
  [883, 'industrialCommand'],
  [893, 'frigate'],
  [894, 'cruiser'],
  [898, 'battleship'],
  [900, 'battleship'],
  [902, 'freighter'],
  [906, 'cruiser'],
  [941, 'industrialCommand'],
  [963, 'cruiser'],
])

export function shipBracketIconSource(groupId?: number | null) {
  const icon =
    groupId === null || groupId === undefined ? undefined : shipBracketIconByGroupId.get(groupId)
  const filename = icon ? `${icon}_16.png` : 'ship.png'
  return `/images/eve-brackets/${filename}`
}

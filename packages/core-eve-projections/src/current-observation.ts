export interface CurrentShipIdentity {
  readonly typeId: number
  readonly name: string
}

export interface CurrentLocationIdentity {
  readonly solarSystemId: number
  readonly stationId?: number
  readonly structureId?: number
}

export const projectCurrentShipIdentity = (wire: {
  readonly ship_type_id: number
  readonly ship_name: string
}): CurrentShipIdentity => ({
  typeId: wire.ship_type_id,
  name: wire.ship_name,
})

export const projectCurrentLocationIdentity = (wire: {
  readonly solar_system_id: number
  readonly station_id?: number
  readonly structure_id?: number
}): CurrentLocationIdentity => ({
  solarSystemId: wire.solar_system_id,
  ...(wire.station_id !== undefined && { stationId: wire.station_id }),
  ...(wire.structure_id !== undefined && { structureId: wire.structure_id }),
})

export const currentLocationKind = (location: CurrentLocationIdentity) => {
  if (location.stationId !== undefined) return 'station' as const
  if (location.structureId !== undefined) return 'structure' as const
  return 'space' as const
}

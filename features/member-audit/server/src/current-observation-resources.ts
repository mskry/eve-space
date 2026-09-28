import type {
  PlatformCharacterResourceSubject,
  PlatformResourceMaterializationContext,
  PlatformSingleRequestResourceImplementation,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformCoreEsiOperationProtocol } from '@eve-space/platform-module-server'
import {
  currentLocationKind,
  projectCurrentLocationIdentity,
  projectCurrentShipIdentity,
} from '@eve-space/core-eve-projections/current-observation'
import { z } from 'zod'
import { createObservationId } from './observation-identity.js'
import { maintainCurrentObservation } from './current-observation-maintenance.js'
import type {
  CurrentObservationMaintenancePersistence,
  CurrentObservationPersistence,
} from './persistence.js'

const shipResponseSchema = z.object({
  ship_name: z.string().max(500),
  ship_type_id: z.number().int().positive(),
})
const locationResponseSchema = z.object({
  solar_system_id: z.number().int().positive(),
  station_id: z.number().int().positive().optional(),
  structure_id: z.number().int().positive().optional(),
})

interface CurrentShip {
  readonly kind: 'current-ship'
  readonly typeId: number
  readonly typeName: string
  readonly groupId: number | null
  readonly groupName: string
  readonly name: string
}

interface CurrentLocation {
  readonly kind: 'current-location'
  readonly solarSystemId: number
  readonly solarSystemName: string
  readonly solarSystemSecurityStatus: number | null
  readonly locationType: 'space' | 'station' | 'structure'
  readonly stationId?: number
  readonly stationName?: string
  readonly structureId?: number
}

type ObservationData = CurrentShip | CurrentLocation
type ObservationContext = PlatformResourceMaterializationContext<
  ObservationData,
  PlatformCharacterResourceSubject,
  CurrentObservationPersistence
>

const persistObservation = async (
  resourceId: 'current-ship' | 'current-location',
  context: ObservationContext,
): Promise<void | { readonly outcome: 'obsolete' }> => {
  const authority = context.managedAuthority
  if (
    context.organizationVersion !== authority?.organizationVersion ||
    authority.sectionId !== 'current-observation' ||
    context.authorizationGeneration === null ||
    !context.cachedUntil
  ) {
    return { outcome: 'obsolete' }
  }
  const common = {
    authorizationGeneration: context.authorizationGeneration,
    cachedUntil: context.cachedUntil,
    characterId: context.subject.characterId,
    characterLifecycleId: context.subject.lifecycleId,
    disclosureVersion: authority.disclosureVersion,
    dtoRevision: 1 as const,
    managedMemberLifecycleId: authority.managedMemberLifecycleId,
    observationId: createObservationId(
      resourceId,
      context.subject.lifecycleId,
      context.validatedAt,
    ),
    organizationVersion: authority.organizationVersion,
    sectionActivationVersion: authority.sectionActivationVersion,
    targetUserId: authority.targetUserId,
    validatedAt: context.validatedAt,
  }
  if (resourceId !== context.data.kind) return { outcome: 'obsolete' }
  let result: { readonly outcome: 'applied' | 'obsolete' }
  if (resourceId === 'current-ship' && context.data.kind === 'current-ship') {
    result = await context.capabilities.persistence.writeCurrentObservation({
      ...common,
      resourceId: 'current-ship',
      snapshot: context.data,
    })
  } else if (context.data.kind === 'current-location') {
    result = await context.capabilities.persistence.writeCurrentObservation({
      ...common,
      resourceId: 'current-location',
      snapshot: context.data,
    })
  } else {
    return { outcome: 'obsolete' }
  }
  return result.outcome === 'obsolete' ? { outcome: 'obsolete' } : undefined
}

type ShipResource = PlatformSingleRequestResourceImplementation<
  'ship',
  PlatformCoreEsiOperationProtocol<'ship'>,
  CurrentShip,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly ['published-type-details'],
  CurrentObservationPersistence,
  CurrentObservationMaintenancePersistence
>

export const currentShipResource: ShipResource = {
  maintain: (context) => maintainCurrentObservation('current-ship', context),
  mode: 'single-request',
  operation: 'ship',
  request: (subject) => ({ path: { character_id: subject.characterId } }),
  async map({ data, capabilities }) {
    const ship = shipResponseSchema.parse(data)
    const identity = projectCurrentShipIdentity(ship)
    const types = await capabilities.coreData.publishedTypeDetails({ typeIds: [identity.typeId] })
    const type = types.rows.find(({ typeId }) => typeId === identity.typeId)
    return {
      kind: 'current-ship',
      typeId: identity.typeId,
      typeName: type?.typeName ?? 'Unknown type',
      groupId: type?.groupId ?? null,
      groupName: type?.groupName ?? 'Unknown group',
      name: identity.name,
    }
  },
  materialize: (context) => persistObservation('current-ship', context),
}

type LocationResource = PlatformSingleRequestResourceImplementation<
  'location',
  PlatformCoreEsiOperationProtocol<'location'>,
  CurrentLocation,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly ['static-location-labels'],
  CurrentObservationPersistence,
  CurrentObservationMaintenancePersistence
>

export const currentLocationResource: LocationResource = {
  maintain: (context) => maintainCurrentObservation('current-location', context),
  mode: 'single-request',
  operation: 'location',
  request: (subject) => ({ path: { character_id: subject.characterId } }),
  async map({ data, capabilities }) {
    const location = locationResponseSchema.parse(data)
    const identity = projectCurrentLocationIdentity(location)
    const locationIds = [
      identity.solarSystemId,
      ...(identity.stationId ? [identity.stationId] : []),
    ]
    const labels = await capabilities.coreData.staticLocationLabels({ locationIds })
    const system = labels.rows.find(
      ({ kind, locationId }) => kind === 'solar_system' && locationId === identity.solarSystemId,
    )
    const station = labels.rows.find(
      ({ kind, locationId }) => kind === 'station' && locationId === identity.stationId,
    )
    const locationType = currentLocationKind(identity)
    return {
      kind: 'current-location',
      solarSystemId: identity.solarSystemId,
      solarSystemName: system?.name ?? 'Unknown solar system',
      solarSystemSecurityStatus: null,
      locationType,
      ...(identity.stationId && {
        stationId: identity.stationId,
        stationName: station?.name ?? 'Unknown station',
      }),
      ...(identity.structureId && { structureId: identity.structureId }),
    }
  },
  materialize: (context) => persistObservation('current-location', context),
}

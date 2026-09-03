import { createClonesClient } from '@evespace/esi-client/domains/clones'
import type {
  GetCharactersCharacterIdClonesOutput,
  GetCharactersCharacterIdImplantsOutput,
} from '@evespace/esi-client/schemas'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sdeTypeDogmaAttributes, sdeTypes } from '../db/schema.js'
import { getCharacterEsiScope } from '../esi-resilience/catalog.js'
import { toEsiResultMetadata } from '../esi-resilience/public-metadata.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'
import type { EsiCachedResult, EsiResultMetadata } from '../esi-resilience/types.js'
import type { ImplantBonus } from '../universe/implant-attributes.js'
import {
  implantBonusAttributeFor,
  implantDogmaAttributeIds,
  implantSlotAttributeId,
  isImplantBonusValue,
  isImplantSlot,
} from '../universe/implant-attributes.js'
import { resolveUniverseNames } from '../universe/names.js'

export const characterClonesScope = getCharacterEsiScope('character-clones')
export const characterImplantsScope = getCharacterEsiScope('character-implants')

const maximumImplantTypeLookupIds = 500
const stationNameEnrichmentTimeoutMs = 250

type CloneLocationType = 'station' | 'structure'

interface CloneLocationSnapshot {
  locationId: number | null
  locationType: CloneLocationType | null
}

interface JumpCloneSnapshot {
  jumpCloneId: number
  name: string | null
  location: {
    locationId: number
    locationType: CloneLocationType
  }
  implantTypeIds: number[]
}

interface CharacterClonesSnapshot {
  homeLocation: CloneLocationSnapshot | null
  jumpClones: JumpCloneSnapshot[]
  lastCloneJumpAt: string | null
  lastStationChangeAt: string | null
}

interface CharacterImplantsSnapshot {
  implantTypeIds: number[]
}

interface ImplantSummary {
  typeId: number
  name: string
  slot: number | null
  bonuses: ImplantBonus[]
}

interface ImplantStaticData {
  name: string
  slot: number | null
  bonuses: ImplantBonus[]
}

interface ImplantStaticRow {
  typeId: number
  name: string
  attributeId: number | null
  attributeValue: number | null
}

interface CloneLocation extends CloneLocationSnapshot {
  name: string | null
}

interface CharacterClonesData {
  homeLocation: CloneLocation | null
  jumpClones: Array<{
    jumpCloneId: number
    name: string | null
    location: {
      locationId: number
      locationType: CloneLocationType
      name: string | null
    }
    implants: ImplantSummary[]
  }>
  lastCloneJumpAt: string | null
  lastStationChangeAt: string | null
}

interface CharacterImplantsData {
  implants: ImplantSummary[]
}

export type CharacterClones = CharacterClonesData & EsiResultMetadata
export type CharacterImplants = CharacterImplantsData & EsiResultMetadata

function getCharacterClonesData(
  characterId: number,
): Promise<EsiCachedResult<CharacterClonesSnapshot>> {
  return getEsiResilienceLayer().getCharacter({
    operation: 'character-clones',
    inputs: { characterId },
    load: async (authority, revalidation) => {
      const response = await createClonesClient({
        fetch: createEsiTransport('character-clones', authority.principal),
        token: authority.accessToken,
      })
        .withMetadata()
        .getState(characterId, revalidation)
      return { data: mapCharacterClonesSnapshot(response.data), meta: response.meta }
    },
  })
}

function getCharacterImplantsData(
  characterId: number,
): Promise<EsiCachedResult<CharacterImplantsSnapshot>> {
  return getEsiResilienceLayer().getCharacter({
    operation: 'character-implants',
    inputs: { characterId },
    load: async (authority, revalidation) => {
      const response = await createClonesClient({
        fetch: createEsiTransport('character-implants', authority.principal),
        token: authority.accessToken,
      })
        .withMetadata()
        .listActiveImplants(characterId, revalidation)
      return { data: mapCharacterImplantsSnapshot(response.data), meta: response.meta }
    },
  })
}

export async function getCharacterClones(characterId: number): Promise<CharacterClones> {
  const snapshot = await getCharacterClonesData(characterId)
  const implantTypeIds = snapshot.data.jumpClones.flatMap((clone) => clone.implantTypeIds)
  const stationIds = collectStationIds(snapshot.data)
  const [implantStaticData, stationNames] = await Promise.all([
    loadImplantStaticData(implantTypeIds),
    loadStationNames(stationIds),
  ])

  return {
    homeLocation: enrichLocation(snapshot.data.homeLocation, stationNames),
    jumpClones: snapshot.data.jumpClones.map((clone) => ({
      jumpCloneId: clone.jumpCloneId,
      name: clone.name,
      location: {
        ...clone.location,
        name: locationName(clone.location, stationNames),
      },
      implants: enrichImplants(clone.implantTypeIds, implantStaticData),
    })),
    lastCloneJumpAt: snapshot.data.lastCloneJumpAt,
    lastStationChangeAt: snapshot.data.lastStationChangeAt,
    ...toEsiResultMetadata(snapshot),
  }
}

export async function getCharacterImplants(characterId: number): Promise<CharacterImplants> {
  const snapshot = await getCharacterImplantsData(characterId)
  const implantStaticData = await loadImplantStaticData(snapshot.data.implantTypeIds)
  return {
    implants: enrichImplants(snapshot.data.implantTypeIds, implantStaticData),
    ...toEsiResultMetadata(snapshot),
  }
}

function mapCharacterClonesSnapshot(
  result: GetCharactersCharacterIdClonesOutput,
): CharacterClonesSnapshot {
  return {
    homeLocation: result.home_location
      ? {
          locationId: result.home_location.location_id ?? null,
          locationType: result.home_location.location_type ?? null,
        }
      : null,
    jumpClones: result.jump_clones.map((clone) => ({
      jumpCloneId: clone.jump_clone_id,
      name: clone.name ?? null,
      location: {
        locationId: clone.location_id,
        locationType: clone.location_type,
      },
      implantTypeIds: [...new Set(clone.implants)],
    })),
    lastCloneJumpAt: result.last_clone_jump_date ?? null,
    lastStationChangeAt: result.last_station_change_date ?? null,
  }
}

function mapCharacterImplantsSnapshot(
  result: GetCharactersCharacterIdImplantsOutput,
): CharacterImplantsSnapshot {
  return { implantTypeIds: [...new Set(result)] }
}

async function loadImplantStaticData(typeIds: readonly number[]) {
  const lookupIds = [...new Set(typeIds)]
    .filter((typeId) => Number.isSafeInteger(typeId) && typeId > 0)
    .slice(0, maximumImplantTypeLookupIds)
  if (lookupIds.length === 0) return new Map<number, ImplantStaticData>()

  try {
    const rows = await db
      .select({
        typeId: sdeTypes.typeId,
        name: sdeTypes.name,
        attributeId: sdeTypeDogmaAttributes.attributeId,
        attributeValue: sdeTypeDogmaAttributes.value,
      })
      .from(sdeTypes)
      .leftJoin(
        sdeTypeDogmaAttributes,
        and(
          eq(sdeTypeDogmaAttributes.typeId, sdeTypes.typeId),
          inArray(sdeTypeDogmaAttributes.attributeId, [...implantDogmaAttributeIds]),
        ),
      )
      .where(and(inArray(sdeTypes.typeId, lookupIds), eq(sdeTypes.published, true)))
      .limit(maximumImplantTypeLookupIds * implantDogmaAttributeIds.length)
    return groupImplantStaticData(rows)
  } catch {
    return new Map<number, ImplantStaticData>()
  }
}

function groupImplantStaticData(rows: readonly ImplantStaticRow[]) {
  const staticByType = new Map<number, ImplantStaticData>()
  for (const row of rows) {
    const entry = staticByType.get(row.typeId) ?? { name: row.name, slot: null, bonuses: [] }
    if (row.attributeId === implantSlotAttributeId && isImplantSlot(row.attributeValue))
      entry.slot = row.attributeValue

    const attribute = row.attributeId === null ? null : implantBonusAttributeFor(row.attributeId)
    if (attribute && isImplantBonusValue(row.attributeValue))
      entry.bonuses.push({ attribute, value: row.attributeValue })

    staticByType.set(row.typeId, entry)
  }
  for (const entry of staticByType.values())
    entry.bonuses.sort((left, right) => left.attribute.localeCompare(right.attribute))
  return staticByType
}

function enrichImplants(
  typeIds: readonly number[],
  staticByType: ReadonlyMap<number, ImplantStaticData>,
): ImplantSummary[] {
  return typeIds
    .map((typeId) => {
      const staticData = staticByType.get(typeId)
      return {
        typeId,
        name: staticData?.name ?? `Unknown implant ${typeId}`,
        slot: staticData?.slot ?? null,
        bonuses: staticData?.bonuses ?? [],
      }
    })
    .toSorted(compareImplants)
}

function compareImplants(left: ImplantSummary, right: ImplantSummary) {
  if (left.slot !== right.slot) {
    if (left.slot === null) return 1
    if (right.slot === null) return -1
    return left.slot - right.slot
  }
  return compareNameAndId(left.name, left.typeId, right.name, right.typeId)
}

function collectStationIds(snapshot: CharacterClonesSnapshot) {
  const stationIds: number[] = []
  if (
    snapshot.homeLocation?.locationType === 'station' &&
    snapshot.homeLocation.locationId !== null
  )
    stationIds.push(snapshot.homeLocation.locationId)
  for (const clone of snapshot.jumpClones)
    if (clone.location.locationType === 'station') stationIds.push(clone.location.locationId)
  return [...new Set(stationIds)]
}

async function loadStationNames(stationIds: readonly number[]) {
  if (stationIds.length === 0) return new Map<number, string>()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const timedOut = Symbol('station-name-enrichment-timeout')
    const resolved = await Promise.race([
      resolveUniverseNames(stationIds),
      new Promise<typeof timedOut>((resolve) => {
        timeout = setTimeout(() => resolve(timedOut), stationNameEnrichmentTimeoutMs)
        timeout.unref()
      }),
    ])
    if (resolved === timedOut) return new Map<number, string>()
    return new Map(
      [...resolved]
        .filter(([, entry]) => entry.category === 'station')
        .map(([id, entry]) => [id, entry.name]),
    )
  } catch {
    return new Map<number, string>()
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function enrichLocation(
  location: CloneLocationSnapshot | null,
  namesByStation: ReadonlyMap<number, string>,
): CloneLocation | null {
  return location ? { ...location, name: locationName(location, namesByStation) } : null
}

function locationName(
  location: CloneLocationSnapshot,
  namesByStation: ReadonlyMap<number, string>,
) {
  return location.locationType === 'station' && location.locationId !== null
    ? (namesByStation.get(location.locationId) ?? null)
    : null
}

function compareNameAndId(leftName: string, leftId: number, rightName: string, rightId: number) {
  if (leftName < rightName) return -1
  if (leftName > rightName) return 1
  return leftId - rightId
}

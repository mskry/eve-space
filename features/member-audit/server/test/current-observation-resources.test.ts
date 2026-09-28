import { describe, expect, test, vi } from 'vitest'
import {
  currentLocationResource,
  currentShipResource,
} from '../src/current-observation-resources.js'
import { maintenanceContext, materializationContext, subject } from './resource-test-fixtures.js'

const revision = { buildNumber: 1, ingestVersion: 1, ingestedAt: '2026-09-18T09:00:00Z' }

describe('independent current observations', () => {
  test('maps only ship type and name with bounded public labels', async () => {
    const mapped = await currentShipResource.map({
      subject,
      data: { ship_type_id: 34, ship_item_id: 123456789, ship_name: 'Review Vessel' },
      capabilities: {
        coreData: {
          publishedTypeDetails: vi.fn().mockResolvedValue({
            complete: true,
            revision,
            rows: [{ typeId: 34, typeName: 'Merlin', groupId: 25, groupName: 'Frigate' }],
          }),
        },
      },
    })
    expect(mapped).toStrictEqual({
      kind: 'current-ship',
      typeId: 34,
      typeName: 'Merlin',
      groupId: 25,
      groupName: 'Frigate',
      name: 'Review Vessel',
    })
    expect(JSON.stringify(mapped)).not.toContain('123456789')
  })

  test('retains valid ship and location identity when public labels are missing', async () => {
    const ship = await currentShipResource.map({
      subject,
      data: { ship_type_id: 35, ship_item_id: 99, ship_name: '' },
      capabilities: {
        coreData: {
          publishedTypeDetails: vi.fn().mockResolvedValue({ complete: true, revision, rows: [] }),
        },
      },
    })
    const location = await currentLocationResource.map({
      subject,
      data: { solar_system_id: 30_000_001, structure_id: 1_000_000_001 },
      capabilities: {
        coreData: {
          staticLocationLabels: vi.fn().mockResolvedValue({ complete: true, revision, rows: [] }),
        },
      },
    })
    expect(ship).toMatchObject({
      typeId: 35,
      typeName: 'Unknown type',
      groupId: null,
      groupName: 'Unknown group',
    })
    expect(location).toStrictEqual({
      kind: 'current-location',
      solarSystemId: 30_000_001,
      solarSystemName: 'Unknown solar system',
      solarSystemSecurityStatus: null,
      locationType: 'structure',
      structureId: 1_000_000_001,
    })
  })

  test('maps station observations with public system and station labels', async () => {
    const staticLocationLabels = vi.fn().mockResolvedValue({
      complete: true,
      revision,
      rows: [
        { kind: 'solar_system', locationId: 30_000_001, name: 'Jita' },
        { kind: 'station', locationId: 60_003_760, name: 'Jita IV - Moon 4' },
      ],
    })
    const mapped = await currentLocationResource.map({
      subject,
      data: { solar_system_id: 30_000_001, station_id: 60_003_760 },
      capabilities: { coreData: { staticLocationLabels } },
    })

    expect(staticLocationLabels).toHaveBeenCalledWith({
      locationIds: [30_000_001, 60_003_760],
    })
    expect(mapped).toStrictEqual({
      kind: 'current-location',
      solarSystemId: 30_000_001,
      solarSystemName: 'Jita',
      solarSystemSecurityStatus: null,
      locationType: 'station',
      stationId: 60_003_760,
      stationName: 'Jita IV - Moon 4',
    })
  })

  test('rejects invalid wire observations before any enrichment or persistence', async () => {
    const publishedTypeDetails = vi.fn()
    // SAFETY: The malformed wire fixture intentionally bypasses the generated ESI response type.
    await expect(
      currentShipResource.map({
        subject,
        data: { ship_type_id: -1, ship_name: 'Invalid' } as never,
        capabilities: { coreData: { publishedTypeDetails } },
      }),
    ).rejects.toThrow('ship_type_id')
    expect(publishedTypeDetails).not.toHaveBeenCalled()
    const staticLocationLabels = vi.fn()
    // SAFETY: This malformed location intentionally tests the runtime parser.
    await expect(
      currentLocationResource.map({
        subject,
        data: { solar_system_id: 0 } as never,
        capabilities: { coreData: { staticLocationLabels } },
      }),
    ).rejects.toThrow('solar_system_id')
    expect(staticLocationLabels).not.toHaveBeenCalled()
  })

  test('preserves original validation and expiry independently at materialization', async () => {
    const writeCurrentObservation = vi.fn().mockResolvedValue({ outcome: 'applied' })
    const ship = {
      kind: 'current-ship' as const,
      typeId: 34,
      typeName: 'Merlin',
      groupId: 25,
      groupName: 'Frigate',
      name: 'Review Vessel',
    }
    const context = materializationContext(ship, { writeCurrentObservation })
    const admitted = {
      ...context,
      cachedUntil: '2026-09-17T10:00:05Z',
      managedAuthority: { ...context.managedAuthority!, sectionId: 'current-observation' },
    }
    await currentShipResource.materialize(admitted)
    expect(writeCurrentObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'current-ship',
        snapshot: ship,
        validatedAt: context.validatedAt,
        cachedUntil: '2026-09-17T10:00:05Z',
      }),
    )
    writeCurrentObservation.mockClear()
    await expect(
      currentShipResource.materialize({ ...admitted, cachedUntil: undefined }),
    ).resolves.toStrictEqual({ outcome: 'obsolete' })
    expect(writeCurrentObservation).not.toHaveBeenCalled()
  })

  test('rejects mismatched observation authority and surfaces obsolete writes', async () => {
    const writeCurrentObservation = vi.fn().mockResolvedValue({ outcome: 'obsolete' })
    const location = {
      kind: 'current-location' as const,
      solarSystemId: 30_000_001,
      solarSystemName: 'Jita',
      solarSystemSecurityStatus: null,
      locationType: 'space' as const,
    }
    const context = materializationContext(location, { writeCurrentObservation })
    const admitted = {
      ...context,
      cachedUntil: '2026-09-17T10:00:05Z',
      managedAuthority: { ...context.managedAuthority!, sectionId: 'current-observation' },
    }

    await expect(currentLocationResource.materialize(admitted)).resolves.toStrictEqual({
      outcome: 'obsolete',
    })
    expect(writeCurrentObservation).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'current-location', snapshot: location }),
    )
    writeCurrentObservation.mockClear()

    for (const invalid of [
      { ...admitted, organizationVersion: 5 },
      { ...admitted, authorizationGeneration: null },
      { ...admitted, managedAuthority: { ...admitted.managedAuthority, sectionId: 'skills' } },
    ]) {
      await expect(currentLocationResource.materialize(invalid)).resolves.toStrictEqual({
        outcome: 'obsolete',
      })
    }
    expect(writeCurrentObservation).not.toHaveBeenCalled()
  })

  test('maintains both resources through bounded retention, authority, and account purges', async () => {
    const purgeCurrentObservation = vi
      .fn()
      .mockResolvedValueOnce({ deleted: 1000, remaining: true })
      .mockResolvedValue({ deleted: 0, remaining: false })
    const context = {
      ...maintenanceContext({ purgeCurrentObservation }),
      purgeRetention: true,
      invalidAuthorities: [
        {
          authorizationGeneration: 8,
          characterId: subject.characterId,
          characterLifecycleId: subject.lifecycleId,
          disclosureVersion: 2,
          managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
          organizationVersion: 4,
          sectionActivationVersion: 3,
          targetUserId: '22222222-2222-4222-8222-222222222222',
        },
      ],
      purgeAccountIds: ['22222222-2222-4222-8222-222222222222'],
    }
    await currentShipResource.maintain!(context)
    expect(purgeCurrentObservation).toHaveBeenCalledTimes(4)
    expect(purgeCurrentObservation).toHaveBeenNthCalledWith(1, {
      cutoff: context.now,
      mode: 'retention',
      store: 'current-ship',
      limit: 1000,
    })
    expect(purgeCurrentObservation).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        mode: 'authority',
        store: 'current-ship',
        characterLifecycleId: subject.lifecycleId,
        limit: 1000,
      }),
    )
    expect(purgeCurrentObservation).toHaveBeenNthCalledWith(4, {
      mode: 'account',
      store: 'current-ship',
      targetUserId: context.purgeAccountIds[0],
      limit: 1000,
    })
    purgeCurrentObservation.mockClear()
    await currentLocationResource.maintain!(context)
    expect(
      purgeCurrentObservation.mock.calls.every(([input]) => input.store === 'current-location'),
    ).toBe(true)
  })
})

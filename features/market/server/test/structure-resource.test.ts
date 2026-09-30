import { expect, test, vi } from 'vitest'
import { marketStructureResource } from '../src/structure-resource.js'

const observation = {
  structureId: 1020000000000,
  pages: 1,
  orders: [{ orderId: 1 }],
  pageResults: [
    {
      page: 1,
      orders: [
        {
          orderId: 1,
          typeId: 34,
          locationId: 1020000000000,
          solarSystemId: null,
          side: 'sell',
          price: '6.42',
          volumeRemain: 10,
          issuedAt: '2026-09-28T12:00:00Z',
          durationDays: 90,
          minimumVolume: 1,
          range: 'station',
        },
      ],
      validatedAt: '2026-09-28T12:00:00Z',
      freshUntil: '2026-09-28T12:05:00Z',
    },
  ],
  observedAt: '2026-09-28T12:00:00Z',
  validatedAt: '2026-09-28T12:00:00Z',
  freshUntil: '2026-09-28T12:05:00Z',
} as const

test('materializes a complete private book through named operations under the host authority fence', async () => {
  const beginStructureObservation = vi.fn().mockResolvedValue({ outcome: 'started' })
  const stageStructurePage = vi.fn().mockResolvedValue({ outcome: 'staged' })
  const publishStructureObservation = vi.fn().mockResolvedValue({ outcome: 'published' })
  const subject = {
    kind: 'character' as const,
    characterId: 90000001,
    lifecycleId: '00000000-0000-4000-8000-000000000001',
  }
  const context = {
    data: observation,
    subject,
    authorizationGeneration: 4,
    organizationVersion: 7,
    managedAuthority: null,
    validatedAt: observation.validatedAt,
    capabilities: {
      persistence: {
        beginStructureObservation,
        stageStructurePage,
        publishStructureObservation,
        cleanupStructureObservations: vi.fn(),
        cleanupStructureDemands: vi.fn(),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    },
  }
  await marketStructureResource.materialize(context as never)
  expect(beginStructureObservation).toHaveBeenCalledWith(
    expect.objectContaining({
      characterId: 90000001,
      subjectLifecycleId: subject.lifecycleId,
      authorizationGeneration: 4,
      organizationVersion: 7,
      structureId: observation.structureId,
    }),
  )
  expect(stageStructurePage).toHaveBeenCalledWith(
    expect.objectContaining({
      orders: [expect.objectContaining({ orderId: 1, solarSystemId: null })],
    }),
  )
  expect(publishStructureObservation).toHaveBeenCalledOnce()
  stageStructurePage.mockResolvedValueOnce({ outcome: 'obsolete' })
  await expect(marketStructureResource.materialize(context as never)).rejects.toThrow('obsolete')
  expect(publishStructureObservation).toHaveBeenCalledOnce()
})

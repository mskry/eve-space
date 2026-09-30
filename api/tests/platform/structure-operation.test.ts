import { randomUUID } from 'node:crypto'
import { expect, test, vi } from 'vitest'
import { executeInstalledResourceOperation } from '../../src/platform/resource-operation-executor.js'
import { platformResources } from '../../src/platform/resources.js'

const resource = platformResources.find(
  ({ moduleId, resourceId }) => moduleId === 'market' && resourceId === 'structure-orders',
)!
const structureId = 1020000000000
const subjectLifecycleId = randomUUID()
const subject = {
  kind: 'character' as const,
  characterId: 90000001,
  lifecycleId: subjectLifecycleId,
}
const identity = {
  moduleId: 'market',
  resourceId: 'structure-orders',
  subjectKind: 'character' as const,
  subjectId: '90000001',
  subjectLifecycleId,
}

test('binds every structure page to the exact character principal and selector', async () => {
  const guardExecution = vi.fn().mockResolvedValue({
    outcome: 'ready',
    resource,
    subject,
    authorization: { tokenVersion: 4 },
    characterId: 90000001,
    authorizationCharacterId: 90000001,
    authorizationCharacterLifecycleId: subjectLifecycleId,
    managedAuthority: null,
  })
  const loadCollectionContext = vi.fn().mockResolvedValue({
    corporationId: 98000001,
    organizationVersion: 7,
  })
  const executeEsiOperation = vi.fn(
    async ({ inputs }: { inputs: { query?: { page?: number } } }) => {
      const page = inputs.query?.page ?? 1
      return {
        data: [
          {
            order_id: page,
            type_id: 34,
            location_id: structureId,
            is_buy_order: false,
            price: 6.42,
            volume_remain: 10,
            issued: new Date().toISOString(),
            duration: 90,
            min_volume: 1,
            range: 'station',
          },
        ],
        authorizationGeneration: 4,
        cachedUntil: new Date(Date.now() + 300_000).toISOString(),
        validatedAt: new Date().toISOString(),
        pagination: { pages: 2 },
        quota: {},
        source: 'esi' as const,
        stale: false,
      }
    },
  )
  const result = await executeInstalledResourceOperation(identity, {
    resources: [resource],
    guardExecution,
    loadCollectionContext,
    executeEsiOperation: executeEsiOperation as never,
    selector: { structureId },
    signal: new AbortController().signal,
  })
  expect(result.outcome).toBe('loaded')
  if (result.outcome !== 'loaded') throw new Error('Expected complete structure book')
  expect(result.complete).toBe(true)
  expect(result.result.data).toMatchObject({
    structureId,
    pages: 2,
    orders: [
      { orderId: 1, solarSystemId: null },
      { orderId: 2, solarSystemId: null },
    ],
  })
  expect(executeEsiOperation).toHaveBeenCalledTimes(2)
  expect(guardExecution).toHaveBeenCalledWith(
    identity,
    expect.objectContaining({
      allowUndue: true,
    }),
  )
  expect(executeEsiOperation).toHaveBeenCalledWith(
    expect.objectContaining({
      authorization: {
        kind: 'character-lifecycle',
        characterId: 90000001,
        lifecycleId: subjectLifecycleId,
        generation: 4,
      },
      operation: 'market-structure-orders',
    }),
  )
})

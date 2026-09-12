import { operationRegistry } from '@evespace/esi-client/operations'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeMutationRepresentation: vi.fn(),
  executePlatformOperation: vi.fn(),
  executeRepresentation: vi.fn(),
}))

vi.mock('../../src/esi-gateway/internal/production-runtime.js', () => ({
  getProductionEsiExecutionRuntime: async () => mocks,
}))

import {
  assertCoreEsiOperation,
  assertEsiPlatformExecutionConfiguration,
  assertPlatformEsiOperation,
} from '../../src/esi-gateway/catalog-interface.js'
import { createPublicEsiRead } from '../../src/esi-gateway/feature-execution.js'
import { executePlatformEsiOperation } from '../../src/esi-gateway/platform-execution.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ESI execution path selection', () => {
  test('selects exactly one catalog-validated core or platform path per operation', () => {
    expect(() => assertEsiPlatformExecutionConfiguration()).not.toThrow()
    expect(() => assertCoreEsiOperation('status')).not.toThrow()
    expect(() => assertPlatformEsiOperation('organization-activity-campaign-list')).not.toThrow()
    expect(() => assertCoreEsiOperation('organization-activity-campaign-list')).toThrow(
      'registered for platform execution',
    )
    expect(() => assertPlatformEsiOperation('status')).toThrow(
      'not registered for platform execution',
    )
  })

  test('routes a callable core read only through representation execution', async () => {
    const result = {
      data: { players: 1 },
      source: 'esi' as const,
      validatedAt: '2026-09-11T12:00:00.000Z',
      cachedUntil: '2026-09-11T12:01:00.000Z',
      stale: false,
      quota: {},
    }
    mocks.executeRepresentation.mockResolvedValue(result)
    const status = createPublicEsiRead({
      operation: 'status',
      name: 'status-execution-selection-fixture',
      descriptor: operationRegistry.GetStatus.transport,
      encodeRequest: () => ({}),
      map: ({ data }) => data,
    })

    await expect(status.execute(undefined)).resolves.toEqual(result)
    expect(mocks.executeRepresentation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'status', name: 'status-execution-selection-fixture' }),
      undefined,
      undefined,
    )
    expect(mocks.executePlatformOperation).not.toHaveBeenCalled()
  })

  test('routes an installed-module read only through platform execution', async () => {
    const operation = 'organization-activity-campaign-list'
    const request = {
      operation,
      inputs: {},
      authorization: { kind: 'public' as const },
    } as const
    mocks.executePlatformOperation.mockResolvedValue({
      result: { data: { campaigns: [] }, source: 'esi' },
      authorizationGeneration: null,
    })

    await expect(executePlatformEsiOperation(request)).resolves.toMatchObject({
      data: { campaigns: [] },
      authorizationGeneration: null,
      source: 'esi',
    })
    expect(mocks.executePlatformOperation).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ sdkOperationId: 'GetMilitaryCampaignsListing' }),
      {},
    )
    expect(mocks.executeRepresentation).not.toHaveBeenCalled()
    expect(mocks.executeMutationRepresentation).not.toHaveBeenCalled()
  })
})

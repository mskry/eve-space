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
  getPlatformEsiOperationDefinition,
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

  test('registers the reviewed Member Audit core operations without aliases', () => {
    const expected = {
      'character-asset-names': 'PostCharactersCharacterIdAssetsNames',
      'character-assets-page': 'GetCharactersCharacterIdAssets',
      'mail-headers': 'GetCharactersCharacterIdMail',
      'mail-lists': 'GetCharactersCharacterIdMailLists',
      'mail-message': 'GetCharactersCharacterIdMailMailId',
      'skill-queue': 'GetCharactersCharacterIdSkillqueue',
      skills: 'GetCharactersCharacterIdSkills',
      'universe-resolve-names': 'PostUniverseNames',
      'wallet-balance': 'GetCharactersCharacterIdWallet',
      'wallet-journal': 'GetCharactersCharacterIdWalletJournal',
      'wallet-transactions': 'GetCharactersCharacterIdWalletTransactions',
    } as const

    for (const [operation, sdkOperationId] of Object.entries(expected)) {
      assertPlatformEsiOperation(operation)
      expect(() => assertCoreEsiOperation(operation)).toThrow('registered for platform execution')
      expect(getPlatformEsiOperationDefinition(operation)).toMatchObject({ sdkOperationId })
    }
  })

  test('routes a callable core read only through representation execution', async () => {
    const result = {
      cachedUntil: '2026-09-11T12:01:00.000Z',
      data: { players: 1 },
      quota: {},
      source: 'esi' as const,
      stale: false,
      validatedAt: '2026-09-11T12:00:00.000Z',
    }
    mocks.executeRepresentation.mockResolvedValue(result)
    const status = createPublicEsiRead({
      cacheSchema: operationRegistry.GetStatus.responseSchema,
      descriptor: operationRegistry.GetStatus.transport,
      encodeRequest: () => ({}),
      map: ({ data }) => data,
      name: 'status-execution-selection-fixture',
      operation: 'status',
    })

    await expect(status.execute(undefined)).resolves.toStrictEqual(result)
    expect(mocks.executeRepresentation).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'status-execution-selection-fixture', operation: 'status' }),
      undefined,
      undefined,
    )
    expect(mocks.executePlatformOperation).not.toHaveBeenCalled()
  })

  test('routes an installed-module read only through platform execution', async () => {
    const operation = 'organization-activity-campaign-list'
    const request = {
      authorization: { kind: 'public' as const },
      inputs: {},
      operation,
    } as const
    mocks.executePlatformOperation.mockResolvedValue({
      authorizationGeneration: null,
      result: { data: { campaigns: [] }, source: 'esi' },
    })

    await expect(executePlatformEsiOperation(request)).resolves.toMatchObject({
      authorizationGeneration: null,
      data: { campaigns: [] },
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

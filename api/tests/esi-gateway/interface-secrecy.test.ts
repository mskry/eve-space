import { EsiTransportError } from '@evespace/esi-client'
import { describe, expect, test } from 'vitest'
import {
  getEsiOperationAuthorization,
  getEsiSetOperationConfiguration,
} from '../../src/esi-gateway/catalog-interface.js'
import { classifyEsiOperationFailure } from '../../src/esi-gateway/failures.js'

describe('ESI purpose interface secrecy', () => {
  test('exports only purpose-specific runtime behavior', async () => {
    const [failures, lifecycle, status, catalog] = await Promise.all([
      import('../../src/esi-gateway/failures.js'),
      import('../../src/esi-gateway/runtime-lifecycle.js'),
      import('../../src/esi-gateway/status-interface.js'),
      import('../../src/esi-gateway/catalog-interface.js'),
    ])

    expect(Object.keys(failures).toSorted()).toStrictEqual([
      'EsiQuotaError',
      'classifyEsiOperationFailure',
      'classifyEsiRefreshFailure',
      'getEsiFailureStatus',
      'getEsiQuotaStatuses',
      'isEsiAuthorizationFailure',
      'isEsiMutationOutcomeUnknown',
      'isEsiOperationQuotaLimited',
    ])
    expect(Object.keys(lifecycle).toSorted()).toStrictEqual(['closeProductionEsiExecutionRuntime'])
    expect(Object.keys(status).toSorted()).toStrictEqual([
      'isEsiErrorBudgetAtFloor',
      'probeEsiStatus',
      'readEsiCallRateReport',
    ])
    expect(Object.keys(catalog).toSorted()).toStrictEqual([
      'assertCoreEsiOperation',
      'assertEsiCatalogConfiguration',
      'assertEsiExecutableDefinition',
      'assertEsiPlatformExecutionConfiguration',
      'assertPlatformEsiOperation',
      'assertRegisteredEsiOperation',
      'coreEsiOperationIds',
      'getCharacterEsiScope',
      'getEsiMaximumBatchSize',
      'getEsiOperationAuthorization',
      'getEsiSetOperationConfiguration',
      'getOptionalCharacterEsiScope',
      'getPlatformEsiOperationDefinition',
      'narrowPlatformEsiOperationOutput',
      'parsePlatformEsiOperationInputs',
    ])
  })

  test('projects failures and catalog facts without implementation representations', () => {
    const failure = classifyEsiOperationFailure(
      new EsiTransportError({
        cause: new Error('redis://coordination.internal bearer-secret'),
        operationId: 'GetStatus',
        phase: 'request',
        reason: 'network',
      }),
    )

    expect(failure).toStrictEqual({ kind: 'unavailable' })
    expect(getEsiOperationAuthorization('wallet-balance')).toStrictEqual({
      kind: 'character',
      requiredScope: 'esi-wallet.read_character_wallet.v1',
    })
    expect(getEsiSetOperationConfiguration('bulk-affiliation')).toStrictEqual({
      field: 'characterIds',
      maximumItems: 1000,
    })

    const serialized = JSON.stringify({ failure })
    for (const forbidden of [
      'redis://',
      'bearer-secret',
      'principal',
      'headers',
      'metadata',
      'descriptor',
      'cache',
      'permit',
      'transport',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})

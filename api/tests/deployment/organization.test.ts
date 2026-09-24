import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  executeRepresentation: vi.fn(),
}))

vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)

import { resolveDeploymentOrganization } from '../../src/deployment/organization.js'

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation((definition) =>
    definition.operation === 'public-corporation'
      ? completeResult({ corporation: { name: 'Test Corporation', ticker: 'CORP' }, found: true })
      : completeResult({ executorCorporationId: 98, name: 'Test Alliance', ticker: 'TEST' }),
  )
})

describe('deployment organization resolution', () => {
  test('maps an alliance ID to stable deployment details', async () => {
    await expect(resolveDeploymentOrganization('alliance', 99)).resolves.toStrictEqual({
      id: 99,
      name: 'Test Alliance',
      ticker: 'TEST',
      type: 'alliance',
    })
    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toStrictEqual({ allianceId: 99 })
  })

  test('maps a corporation ID to stable deployment details', async () => {
    await expect(resolveDeploymentOrganization('corporation', 98)).resolves.toStrictEqual({
      id: 98,
      name: 'Test Corporation',
      ticker: 'CORP',
      type: 'corporation',
    })
    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toStrictEqual({ corporationId: 98 })
  })
})

function completeResult<Data>(data: Data) {
  return { cachedUntil: '', data, quota: {}, source: 'esi' as const, stale: false, validatedAt: '' }
}

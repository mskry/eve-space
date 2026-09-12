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
      ? completeResult({ found: true, corporation: { name: 'Test Corporation', ticker: 'CORP' } })
      : completeResult({ name: 'Test Alliance', ticker: 'TEST', executorCorporationId: 98 }),
  )
})

describe('deployment organization resolution', () => {
  test('maps an alliance ID to stable deployment details', async () => {
    await expect(resolveDeploymentOrganization('alliance', 99)).resolves.toEqual({
      type: 'alliance',
      id: 99,
      name: 'Test Alliance',
      ticker: 'TEST',
    })
    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toEqual({ allianceId: 99 })
  })

  test('maps a corporation ID to stable deployment details', async () => {
    await expect(resolveDeploymentOrganization('corporation', 98)).resolves.toEqual({
      type: 'corporation',
      id: 98,
      name: 'Test Corporation',
      ticker: 'CORP',
    })
    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toEqual({ corporationId: 98 })
  })
})

function completeResult<Data>(data: Data) {
  return { data, cachedUntil: '', validatedAt: '', quota: {}, source: 'esi' as const, stale: false }
}

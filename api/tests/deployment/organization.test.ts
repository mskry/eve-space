import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  executeRepresentation: vi.fn(),
}))

vi.mock('@evespace/esi-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@evespace/esi-client')>()),
  EsiClient: class {
    callOperation(...arguments_: unknown[]) {
      return mocks.callOperation(...arguments_)
    }
  },
}))

vi.mock('../../src/esi-resilience/layer.js', () => ({
  esiExecutionLayer: { executeRepresentation: mocks.executeRepresentation },
}))

import { resolveDeploymentOrganization } from '../../src/deployment/organization.js'
import { executeRepresentationFixture } from '../support/execute-representation.js'

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation((representation, input) =>
    executeRepresentationFixture(representation, input),
  )
  mocks.callOperation.mockImplementation((operationId: string) => {
    if (operationId === 'GetCorporationsCorporationId')
      return { data: { name: 'Test Corporation', ticker: 'CORP' }, meta: { headers: {} } }
    if (operationId === 'GetAlliancesAllianceId')
      return {
        data: { name: 'Test Alliance', ticker: 'TEST', executor_corporation_id: 98 },
        meta: { headers: {} },
      }
    throw new Error(`Unexpected operation ${operationId}`)
  })
})

describe('deployment organization resolution', () => {
  test('maps an alliance ID to stable deployment details', async () => {
    await expect(resolveDeploymentOrganization('alliance', 99)).resolves.toEqual({
      type: 'alliance',
      id: 99,
      name: 'Test Alliance',
      ticker: 'TEST',
    })
    expect(mocks.callOperation).toHaveBeenCalledWith('GetAlliancesAllianceId', {
      path: { alliance_id: 99 },
    })
  })

  test('maps a corporation ID to stable deployment details', async () => {
    await expect(resolveDeploymentOrganization('corporation', 98)).resolves.toEqual({
      type: 'corporation',
      id: 98,
      name: 'Test Corporation',
      ticker: 'CORP',
    })
    expect(mocks.callOperation).toHaveBeenCalledWith('GetCorporationsCorporationId', {
      path: { corporation_id: 98 },
    })
  })
})

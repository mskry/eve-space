import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  executePublicRepresentation: vi.fn(),
  get: vi.fn(),
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
  getEsiResilienceLayer: () => ({
    executePublicRepresentation: mocks.executePublicRepresentation,
    getPublic: mocks.get,
  }),
}))
vi.mock('../../src/esi-resilience/request-transport.js', () => ({ createEsiTransport: vi.fn() }))

import { resolveDeploymentOrganization } from '../../src/deployment/organization.js'

beforeEach(() => {
  mocks.executePublicRepresentation.mockImplementation((_representation, resource) =>
    mocks.get(resource),
  )
  mocks.get.mockImplementation(async (resource) => {
    const response = await resource.load({})
    return { data: response.data, cachedUntil: '', quota: {}, source: 'esi', stale: false }
  })
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

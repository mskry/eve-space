import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  allianceInfo: vi.fn(),
  corporationInfo: vi.fn(),
  get: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/alliance', () => ({
  createAllianceClient: () => ({ withMetadata: () => ({ getPublicInfo: mocks.allianceInfo }) }),
}))

vi.mock('@evespace/esi-client/domains/corporation', () => ({
  createCorporationClient: () => ({
    withMetadata: () => ({ getPublicInfo: mocks.corporationInfo }),
  }),
}))

vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getPublic: mocks.get }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({ createEsiTransport: vi.fn() }))

import { resolveDeploymentOrganization } from '../../src/deployment/organization.js'

beforeEach(() => {
  mocks.get.mockImplementation(async (resource) => {
    const response = await resource.load({})
    return { data: response.data, cachedUntil: '', quota: {}, source: 'esi', stale: false }
  })
  mocks.allianceInfo.mockResolvedValue({
    data: { name: 'Test Alliance', ticker: 'TEST' },
    meta: { headers: {} },
  })
  mocks.corporationInfo.mockResolvedValue({
    data: { name: 'Test Corporation', ticker: 'CORP' },
    meta: { headers: {} },
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
    expect(mocks.allianceInfo).toHaveBeenCalledWith(99, {})
  })

  test('maps a corporation ID to stable deployment details', async () => {
    await expect(resolveDeploymentOrganization('corporation', 98)).resolves.toEqual({
      type: 'corporation',
      id: 98,
      name: 'Test Corporation',
      ticker: 'CORP',
    })
    expect(mocks.corporationInfo).toHaveBeenCalledWith(98, {})
  })
})

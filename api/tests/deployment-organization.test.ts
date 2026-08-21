import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  allianceInfo: vi.fn(),
  corporationInfo: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/alliance', () => ({
  createAllianceClient: () => ({ getPublicInfo: mocks.allianceInfo }),
}))

vi.mock('@evespace/esi-client/domains/corporation', () => ({
  createCorporationClient: () => ({ getPublicInfo: mocks.corporationInfo }),
}))

vi.mock('../src/esi-fetch.js', () => ({ esiFetch: vi.fn() }))

import { resolveDeploymentOrganization } from '../src/deployment-organization.js'

beforeEach(() => {
  mocks.allianceInfo.mockResolvedValue({ name: 'Test Alliance', ticker: 'TEST' })
  mocks.corporationInfo.mockResolvedValue({ name: 'Test Corporation', ticker: 'CORP' })
})

describe('deployment organization resolution', () => {
  test('maps an alliance ID to stable deployment details', async () => {
    await expect(resolveDeploymentOrganization('alliance', 99)).resolves.toEqual({
      type: 'alliance',
      id: 99,
      name: 'Test Alliance',
      ticker: 'TEST',
    })
    expect(mocks.allianceInfo).toHaveBeenCalledWith(99)
  })

  test('maps a corporation ID to stable deployment details', async () => {
    await expect(resolveDeploymentOrganization('corporation', 98)).resolves.toEqual({
      type: 'corporation',
      id: 98,
      name: 'Test Corporation',
      ticker: 'CORP',
    })
    expect(mocks.corporationInfo).toHaveBeenCalledWith(98)
  })
})

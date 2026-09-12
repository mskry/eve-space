import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  get: vi.fn(),
}))

vi.mock('../../src/esi-gateway/feature-execution.js', () => createFeatureExecutionMock(mocks.get))

import { resolveOrganizationAuthorityCorporation } from '../../src/organization/authority.js'
import {
  assertOrganizationOwnerAuthorization,
  OrganizationAuthorityError,
} from '../../src/organization/authority-policy.js'

const requiredScope = 'esi-characters.read_corporation_roles.v1'
const corporationId = 98_000_001
const allianceId = 99_000_001

beforeEach(() => {
  mocks.get.mockImplementation(() =>
    response({ executorCorporationId: corporationId, name: 'Alliance' }),
  )
})

describe('organization owner authority', () => {
  test('accepts fresh affiliation with the managed corporation', async () => {
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'corporation', organizationId: corporationId },
        { corporationId, allianceId: null },
      ),
    ).resolves.toBe(corporationId)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  test('requires alliance claimants to belong to the current executor corporation', async () => {
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId, allianceId },
      ),
    ).resolves.toBe(corporationId)
    expect(mocks.get.mock.calls[0]?.[1]).toEqual({ allianceId })
  })

  test('rejects a corporation outside the managed organization authority', async () => {
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'corporation', organizationId: corporationId },
        { corporationId: corporationId + 1, allianceId: null },
      ),
    ).rejects.toEqual(new OrganizationAuthorityError('wrong-corporation'))
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId: corporationId + 1, allianceId },
      ),
    ).rejects.toEqual(new OrganizationAuthorityError('wrong-corporation'))
  })

  test('rejects a character outside the managed alliance before executor lookup', async () => {
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId, allianceId: allianceId + 1 },
      ),
    ).rejects.toEqual(new OrganizationAuthorityError('wrong-alliance'))
    expect(mocks.get).not.toHaveBeenCalled()
  })

  test('rejects stale alliance executor evidence', async () => {
    mocks.get.mockImplementationOnce(() => ({
      ...response({ executorCorporationId: corporationId, name: 'Alliance' }),
      source: 'cache',
      stale: true,
    }))
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId, allianceId },
      ),
    ).rejects.toEqual(new OrganizationAuthorityError('stale-affiliation'))
  })

  test('treats an alliance without a current executor as unavailable evidence', async () => {
    mocks.get.mockResolvedValueOnce(response({ name: 'Alliance' }))
    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId, allianceId },
      ),
    ).rejects.toEqual(new OrganizationAuthorityError('executor-unavailable'))
  })

  test('requires the corporation-role scope and current Director role', async () => {
    const roles = {
      roles: ['Director'],
      rolesAtBase: [],
      rolesAtHeadquarters: [],
      rolesAtOther: [],
    }

    expect(() =>
      assertOrganizationOwnerAuthorization(requiredScope, [requiredScope], roles),
    ).not.toThrow()
    expect(() => assertOrganizationOwnerAuthorization(requiredScope, [], roles)).toThrow(
      new OrganizationAuthorityError('missing-scope'),
    )
    expect(() =>
      assertOrganizationOwnerAuthorization(requiredScope, [requiredScope], {
        ...roles,
        roles: ['Accountant'],
      }),
    ).toThrow(new OrganizationAuthorityError('not-director'))
  })
})

function response<Data>(data: Data) {
  return { data, cachedUntil: '', validatedAt: '', quota: {}, source: 'esi' as const, stale: false }
}

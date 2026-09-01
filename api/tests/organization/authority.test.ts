import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAllianceClient: vi.fn(),
  createEsiTransport: vi.fn(),
  get: vi.fn(),
  getPublicInfo: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/alliance', () => ({
  createAllianceClient: mocks.createAllianceClient,
}))
vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getPublic: mocks.get }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({
  createEsiTransport: mocks.createEsiTransport,
}))

const requiredScope = 'esi-characters.read_corporation_roles.v1'
const corporationId = 98_000_001
const allianceId = 99_000_001

beforeEach(() => {
  mocks.get.mockImplementation(async (resource) => {
    const loaded = await resource.load({ ifNoneMatch: 'etag' })
    return { data: loaded.data, cachedUntil: '', quota: {}, source: 'esi', stale: false }
  })
  mocks.createAllianceClient.mockReturnValue({
    withMetadata: () => ({ getPublicInfo: mocks.getPublicInfo }),
  })
  mocks.getPublicInfo.mockResolvedValue(
    response({ executor_corporation_id: corporationId, name: 'Alliance' }),
  )
})

describe('organization owner authority', () => {
  test('accepts fresh affiliation with the managed corporation', async () => {
    const { resolveOrganizationAuthorityCorporation } =
      await import('../../src/organization/authority.js')

    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'corporation', organizationId: corporationId },
        { corporationId, allianceId: null },
      ),
    ).resolves.toBe(corporationId)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  test('requires alliance claimants to belong to the current executor corporation', async () => {
    const { resolveOrganizationAuthorityCorporation } =
      await import('../../src/organization/authority.js')

    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId, allianceId },
      ),
    ).resolves.toBe(corporationId)
    expect(mocks.get.mock.calls[0]?.[0]).toMatchObject({
      operation: 'public-alliance',
      inputs: { allianceId },
    })
    expect(mocks.getPublicInfo).toHaveBeenCalledWith(allianceId, { ifNoneMatch: 'etag' })
  })

  test('rejects a corporation outside the managed organization authority', async () => {
    const { OrganizationAuthorityError, resolveOrganizationAuthorityCorporation } =
      await import('../../src/organization/authority.js')

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
    const { OrganizationAuthorityError, resolveOrganizationAuthorityCorporation } =
      await import('../../src/organization/authority.js')

    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId, allianceId: allianceId + 1 },
      ),
    ).rejects.toEqual(new OrganizationAuthorityError('wrong-alliance'))
    expect(mocks.get).not.toHaveBeenCalled()
  })

  test('rejects stale alliance executor evidence', async () => {
    mocks.get.mockImplementationOnce(async (resource) => {
      const loaded = await resource.load({})
      return { data: loaded.data, cachedUntil: '', quota: {}, source: 'stale', stale: true }
    })
    const { OrganizationAuthorityError, resolveOrganizationAuthorityCorporation } =
      await import('../../src/organization/authority.js')

    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId, allianceId },
      ),
    ).rejects.toEqual(new OrganizationAuthorityError('stale-affiliation'))
  })

  test('treats an alliance without a current executor as unavailable evidence', async () => {
    mocks.getPublicInfo.mockResolvedValueOnce(response({ name: 'Alliance' }))
    const { OrganizationAuthorityError, resolveOrganizationAuthorityCorporation } =
      await import('../../src/organization/authority.js')

    await expect(
      resolveOrganizationAuthorityCorporation(
        { organizationType: 'alliance', organizationId: allianceId },
        { corporationId, allianceId },
      ),
    ).rejects.toEqual(new OrganizationAuthorityError('executor-unavailable'))
  })

  test('requires the corporation-role scope and current Director role', async () => {
    const { assertOrganizationOwnerAuthorization, OrganizationAuthorityError } =
      await import('../../src/organization/authority.js')
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
  return { data, meta: { headers: {} } }
}

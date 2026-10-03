import { beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({
  authorize: vi.fn(),
  load: vi.fn(),
  subjects: vi.fn(),
  policy: vi.fn(),
}))
vi.mock('../../src/organization/module-authorization.js', () => ({
  authorizeOrganizationReviewerContribution: boundary.authorize,
  authorizeOrganizationContribution: vi.fn(() => {
    throw new Error('Wrong member policy')
  }),
}))
vi.mock('../../src/organization/session-context.js', () => ({
  loadOrganizationSessionContext: boundary.load,
}))
vi.mock('../../src/organization/inventory-subject-store.js', () => ({
  resolveCorporationInventorySubjects: boundary.subjects,
  loadInventoryOrganizationPolicy: boundary.policy,
}))

import { admitCorporationInventoryScope } from '../../src/organization/inventory-admission.js'

const session = {
  userId: 'reviewer',
  mainCharacter: {
    characterId: 1,
    name: 'Pilot',
    corporationId: 98,
    allianceId: null,
    isMain: true,
  },
}
const declaration = {
  moduleId: 'trading',
  publisherPackage: '@eve-space/trading-manifest',
  audience: 'hr' as const,
  requiredPermission: 'trading.inventory.corporation.read',
  additionalRequiredPermissions: ['member-audit.assets.read'],
}
const organization = {
  organizationVersion: 3,
  audience: 'hr',
  requiredPermission: declaration.requiredPermission,
  additionalRequiredPermissions: declaration.additionalRequiredPermissions,
  entitlementScope: 'all',
}
const candidate = {
  characterId: 1,
  characterName: 'Blocked Target',
  userId: 'target',
  characterLifecycle: 'character-life',
  memberLifecycle: 'member-life',
  corporationId: 98,
  affiliationPeriodRevision: 'period',
}

beforeEach(() => {
  boundary.load.mockResolvedValue({
    organizationVersion: 3,
    state: 'compliant',
    blocked: false,
    evidenceFreshness: 'fresh',
    accessValidUntil: new Date('2099-01-01'),
    reviewDeadline: null,
  })
  boundary.authorize.mockResolvedValue({ authorized: true, context: organization })
  boundary.subjects.mockResolvedValue([candidate])
  boundary.policy.mockResolvedValue(4)
})

describe('corporation inventory scope admission', () => {
  it('uses reviewer policy with both exact permissions and no directory/search permission', async () => {
    const admission = await admitCorporationInventoryScope(session, declaration, 98)
    expect(admission).toMatchObject({
      admitted: true,
      binding: { corporationId: 98, policyVersion: 4, subjects: [candidate] },
    })
    expect(boundary.authorize).toHaveBeenCalledWith('reviewer', expect.anything(), declaration)
    expect(boundary.subjects).toHaveBeenCalledWith(
      expect.objectContaining({ corporationId: 98, organizationVersion: 3, maximum: 250 }),
    )
  })

  it.each(['blocked', 'compliance', 'audience', 'permission'])(
    'stops before member enumeration after %s denial',
    async (reason) => {
      boundary.authorize.mockResolvedValue({ authorized: false, reason })
      expect(await admitCorporationInventoryScope(session, declaration, 98)).toMatchObject({
        admitted: false,
        status: 403,
      })
      expect(boundary.subjects).not.toHaveBeenCalled()
    },
  )

  it.each([
    { audience: 'member' as const },
    { requiredPermission: 'member-audit.assets.read' },
    { additionalRequiredPermissions: [] },
    { additionalRequiredPermissions: ['member-audit.search'] },
  ])('rejects a declaration that cannot grant this aggregate: %j', async (overrides) => {
    await expect(
      admitCorporationInventoryScope(session, { ...declaration, ...overrides }, 98),
    ).rejects.toThrow('exact reviewer permissions')
    expect(boundary.load).not.toHaveBeenCalled()
  })

  it('denies unknown corp and out-of-scope subset identities with the same safe outcome', async () => {
    boundary.subjects.mockResolvedValueOnce(null).mockResolvedValueOnce([])
    expect(await admitCorporationInventoryScope(session, declaration, 99)).toEqual(
      await admitCorporationInventoryScope(session, declaration, 98, [999]),
    )
  })

  it('refuses maximum-plus-one and never silently selects the first 250 subjects', async () => {
    boundary.subjects.mockResolvedValue(
      Array.from({ length: 251 }, (_, index) => ({ ...candidate, characterId: index + 1 })),
    )
    expect(await admitCorporationInventoryScope(session, declaration, 98)).toMatchObject({
      admitted: false,
      body: { code: 'INVENTORY_LIMIT' },
    })
  })
})

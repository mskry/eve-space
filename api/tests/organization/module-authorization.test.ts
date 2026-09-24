import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  currentCatalogPermission: vi.fn(),
  effectiveAuthority: { director: false, organizationOwner: false },
  getOrganizationGroupPermissions: vi.fn(),
  grants: [] as unknown[],
  loadEffectiveOrganizationAuthority: vi.fn(),
}))

vi.mock('../../src/organization/group-permissions.js', () => ({
  getOrganizationGroupPermissions: mocks.getOrganizationGroupPermissions,
}))
vi.mock('../../src/organization/effective-authority.js', () => ({
  loadEffectiveOrganizationAuthority: mocks.loadEffectiveOrganizationAuthority,
}))
vi.mock('../../src/organization/permission-catalog-store.js', () => ({
  currentCatalogPermission: mocks.currentCatalogPermission,
}))
vi.mock('../../src/db/client.js', () => ({
  db: { select: vi.fn(() => query(mocks.grants)) },
}))

import {
  authorizeOrganizationContribution,
  authorizeOrganizationReviewerContribution,
} from '../../src/organization/module-authorization.js'

const now = new Date('2026-09-02T12:00:00.000Z')
const organization = {
  accessValidUntil: new Date('2026-09-02T13:00:00.000Z') as Date | null,
  blocked: false,
  evidenceFreshness: 'fresh' as const,
  organizationVersion: 7,
  reviewDeadline: null as Date | null,
  state: 'compliant' as 'pending' | 'compliant' | 'review_required' | 'suspended',
}

describe('organization module contribution authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.effectiveAuthority = { director: false, organizationOwner: false }
    mocks.grants = []
    mocks.loadEffectiveOrganizationAuthority.mockImplementation(() =>
      Promise.resolve(mocks.effectiveAuthority),
    )
    mocks.currentCatalogPermission.mockImplementation((value) => value)
    mocks.getOrganizationGroupPermissions.mockResolvedValue({
      modules: ['alpha.view'],
      services: [],
    })
  })

  test('authorizes the exact member permission and pins the organization version', async () => {
    await expect(
      authorizeOrganizationContribution(
        'user-1',
        organization,
        moduleDeclaration('member', 'alpha.view'),
        now,
      ),
    ).resolves.toStrictEqual({
      authorized: true,
      context: {
        audience: 'member',
        entitlementScope: 'all',
        organizationVersion: 7,
        requiredPermission: 'alpha.view',
      },
    })
    expect(mocks.getOrganizationGroupPermissions).toHaveBeenCalledWith('user-1', now, 7)
  })

  test('denies blocked and noncompliant users before permission reads', async () => {
    await expect(
      authorizeOrganizationContribution(
        'user-1',
        { ...organization, blocked: true },
        moduleDeclaration('member', 'alpha.view'),
        now,
      ),
    ).resolves.toStrictEqual({ authorized: false, reason: 'blocked' })
    await expect(
      authorizeOrganizationContribution(
        'user-1',
        { ...organization, accessValidUntil: null, state: 'suspended' },
        moduleDeclaration('member', 'alpha.view'),
        now,
      ),
    ).resolves.toStrictEqual({ authorized: false, reason: 'compliance' })
    expect(mocks.getOrganizationGroupPermissions).not.toHaveBeenCalled()
  })

  test('uses exact permission matching and preserves review scope', async () => {
    mocks.getOrganizationGroupPermissions
      .mockResolvedValueOnce({ modules: ['alpha.viewer'], services: [] })
      .mockResolvedValueOnce({ modules: ['alpha.view'], services: [] })
    const review = {
      ...organization,
      reviewDeadline: new Date('2026-09-02T12:30:00.000Z'),
      state: 'review_required' as const,
    }

    await expect(
      authorizeOrganizationContribution(
        'user-1',
        review,
        moduleDeclaration('member', 'alpha.view'),
        now,
      ),
    ).resolves.toStrictEqual({ authorized: false, reason: 'permission' })
    await expect(
      authorizeOrganizationContribution(
        'user-1',
        review,
        moduleDeclaration('member', 'alpha.view'),
        now,
      ),
    ).resolves.toMatchObject({
      authorized: true,
      context: { entitlementScope: 'review' },
    })
  })

  test('denies a declaration whose exact publisher ownership is absent from the current catalog', async () => {
    mocks.currentCatalogPermission.mockReturnValueOnce(undefined)

    await expect(
      authorizeOrganizationContribution(
        'user-1',
        organization,
        {
          ...moduleDeclaration('member', 'alpha.view'),
          publisherPackage: '@replacement/alpha-manifest',
        },
        now,
      ),
    ).resolves.toStrictEqual({ authorized: false, reason: 'permission' })
    expect(mocks.getOrganizationGroupPermissions).not.toHaveBeenCalled()
  })

  test('requires exact HR grants and accepts director or current owner evidence', async () => {
    await expect(
      authorizeOrganizationContribution(
        'user-1',
        organization,
        moduleDeclaration('hr', 'alpha.view'),
        now,
      ),
    ).resolves.toStrictEqual({ authorized: false, reason: 'audience' })

    mocks.grants = [{ evidenceStatus: null, reviewDeadline: null, role: 'hr_auditor' }]
    await expect(
      authorizeOrganizationContribution(
        'user-1',
        organization,
        moduleDeclaration('hr', 'alpha.view'),
        now,
      ),
    ).resolves.toMatchObject({ authorized: true })

    mocks.grants = []
    mocks.effectiveAuthority = { director: false, organizationOwner: true }
    await expect(
      authorizeOrganizationContribution(
        'user-1',
        organization,
        moduleDeclaration('director', 'alpha.view'),
        now,
      ),
    ).resolves.toMatchObject({ authorized: true })
  })
})

describe('organization reviewer contribution authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.effectiveAuthority = { director: false, organizationOwner: false }
    mocks.grants = []
    mocks.loadEffectiveOrganizationAuthority.mockImplementation(() =>
      Promise.resolve(mocks.effectiveAuthority),
    )
    mocks.currentCatalogPermission.mockImplementation((value) => value)
    mocks.getOrganizationGroupPermissions.mockResolvedValue({
      modules: ['member-audit.skills.read'],
      services: [],
    })
  })

  test.each(['hr_auditor', 'director'] as const)(
    'authorizes an explicit %s reviewer with the exact permission',
    async (role) => {
      mocks.grants = role === 'hr_auditor' ? [{ role }] : []
      mocks.effectiveAuthority = {
        director: role === 'director',
        organizationOwner: false,
      }

      await expect(
        authorizeOrganizationReviewerContribution(
          'user-1',
          organization,
          moduleDeclaration('hr', 'member-audit.skills.read'),
          now,
        ),
      ).resolves.toStrictEqual({
        authorized: true,
        context: {
          audience: 'hr',
          entitlementScope: 'all',
          organizationVersion: 7,
          requiredPermission: 'member-audit.skills.read',
        },
      })
      expect(mocks.getOrganizationGroupPermissions).toHaveBeenCalledWith('user-1', now, 7)
    },
  )

  test('does not treat organization-owner authority as a reviewer grant', async () => {
    mocks.effectiveAuthority = { director: false, organizationOwner: true }

    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        organization,
        moduleDeclaration('hr', 'member-audit.skills.read'),
        now,
      ),
    ).resolves.toStrictEqual({ authorized: false, reason: 'audience' })
    expect(mocks.getOrganizationGroupPermissions).not.toHaveBeenCalled()
  })

  test('does not let an HR reviewer enter a director-only contribution', async () => {
    mocks.grants = [{ role: 'hr_auditor' }]

    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        organization,
        moduleDeclaration('director', 'member-audit.skills.read'),
        now,
      ),
    ).resolves.toStrictEqual({ authorized: false, reason: 'audience' })
    expect(mocks.getOrganizationGroupPermissions).not.toHaveBeenCalled()

    mocks.grants = []
    mocks.effectiveAuthority = { director: true, organizationOwner: false }
    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        organization,
        moduleDeclaration('director', 'member-audit.skills.read'),
        now,
      ),
    ).resolves.toMatchObject({ authorized: true })
  })

  test('requires current compliance and refuses review grace', async () => {
    mocks.grants = [{ role: 'hr_auditor' }]

    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        {
          ...organization,
          reviewDeadline: new Date('2026-09-02T12:30:00.000Z'),
          state: 'review_required',
        },
        moduleDeclaration('hr', 'member-audit.skills.read'),
        now,
      ),
    ).resolves.toStrictEqual({ authorized: false, reason: 'compliance' })
    expect(mocks.getOrganizationGroupPermissions).not.toHaveBeenCalled()
  })

  test('refuses a blocked reviewer before role and permission reads', async () => {
    mocks.effectiveAuthority = { director: true, organizationOwner: false }

    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        { ...organization, blocked: true },
        moduleDeclaration('director', 'member-audit.skills.read'),
        now,
      ),
    ).resolves.toStrictEqual({ authorized: false, reason: 'blocked' })
    expect(mocks.getOrganizationGroupPermissions).not.toHaveBeenCalled()
  })

  test.each([
    ['skills', 'assets'],
    ['assets', 'wallet'],
    ['wallet', 'mail'],
    ['mail', 'skills'],
  ] as const)('does not let %s permission authorize the %s section', async (granted, requested) => {
    mocks.effectiveAuthority = { director: true, organizationOwner: false }
    mocks.getOrganizationGroupPermissions.mockResolvedValue({
      modules: [`member-audit.${granted}.read`],
      services: [],
    })

    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        organization,
        moduleDeclaration('director', `member-audit.${requested}.read`),
        now,
      ),
    ).resolves.toStrictEqual({ authorized: false, reason: 'permission' })
  })

  test('requires the exact permission and a reviewer audience', async () => {
    mocks.effectiveAuthority = { director: true, organizationOwner: false }
    mocks.getOrganizationGroupPermissions.mockResolvedValue({
      modules: ['member-audit.assets.read'],
      services: [],
    })

    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        organization,
        moduleDeclaration('hr', 'member-audit.skills.read'),
        now,
      ),
    ).resolves.toStrictEqual({ authorized: false, reason: 'permission' })
    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        organization,
        moduleDeclaration('member', 'member-audit.assets.read'),
        now,
      ),
    ).resolves.toStrictEqual({ authorized: false, reason: 'audience' })
  })

  test('requires every permission declared by a reviewer contribution', async () => {
    mocks.grants = [{ role: 'hr_auditor' }]
    mocks.getOrganizationGroupPermissions.mockResolvedValue({
      modules: ['member-audit.search'],
      services: [],
    })
    const declaration = {
      additionalRequiredPermissions: ['member-audit.summary.read'],
      audience: 'hr' as const,
      moduleId: 'member-audit',
      publisherPackage: '@eve-space/member-audit-manifest',
      requiredPermission: 'member-audit.search',
    }

    await expect(
      authorizeOrganizationReviewerContribution('user-1', organization, declaration, now),
    ).resolves.toStrictEqual({ authorized: false, reason: 'permission' })

    mocks.getOrganizationGroupPermissions.mockResolvedValue({
      modules: ['member-audit.search', 'member-audit.summary.read'],
      services: [],
    })
    await expect(
      authorizeOrganizationReviewerContribution('user-1', organization, declaration, now),
    ).resolves.toMatchObject({ authorized: true })
  })
})

function moduleDeclaration(audience: 'member' | 'hr' | 'director', requiredPermission: string) {
  const moduleId = requiredPermission.split('.')[0]!
  return {
    audience,
    moduleId,
    publisherPackage:
      moduleId === 'member-audit' ? '@eve-space/member-audit-manifest' : '@example/alpha-manifest',
    requiredPermission,
  }
}

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'limit']) {
    builder[method] = () => builder
  }
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

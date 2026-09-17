import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getOrganizationGroupPermissions: vi.fn(),
  grants: [] as unknown[],
}))

vi.mock('../../src/organization/group-permissions.js', () => ({
  getOrganizationGroupPermissions: mocks.getOrganizationGroupPermissions,
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
  organizationVersion: 7,
  state: 'compliant' as 'pending' | 'compliant' | 'review_required' | 'suspended',
  evidenceFreshness: 'fresh' as const,
  reviewDeadline: null as Date | null,
  accessValidUntil: new Date('2026-09-02T13:00:00.000Z') as Date | null,
  blocked: false,
}

describe('organization module contribution authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.grants = []
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
        { audience: 'member', requiredPermission: 'alpha.view' },
        now,
      ),
    ).resolves.toEqual({
      authorized: true,
      context: {
        organizationVersion: 7,
        audience: 'member',
        requiredPermission: 'alpha.view',
        entitlementScope: 'all',
      },
    })
    expect(mocks.getOrganizationGroupPermissions).toHaveBeenCalledWith('user-1', now, 7)
  })

  test('denies blocked and noncompliant users before permission reads', async () => {
    await expect(
      authorizeOrganizationContribution(
        'user-1',
        { ...organization, blocked: true },
        { audience: 'member', requiredPermission: 'alpha.view' },
        now,
      ),
    ).resolves.toEqual({ authorized: false, reason: 'blocked' })
    await expect(
      authorizeOrganizationContribution(
        'user-1',
        { ...organization, state: 'suspended', accessValidUntil: null },
        { audience: 'member', requiredPermission: 'alpha.view' },
        now,
      ),
    ).resolves.toEqual({ authorized: false, reason: 'compliance' })
    expect(mocks.getOrganizationGroupPermissions).not.toHaveBeenCalled()
  })

  test('uses exact permission matching and preserves review scope', async () => {
    mocks.getOrganizationGroupPermissions
      .mockResolvedValueOnce({ modules: ['alpha.viewer'], services: [] })
      .mockResolvedValueOnce({ modules: ['alpha.view'], services: [] })
    const review = {
      ...organization,
      state: 'review_required' as const,
      reviewDeadline: new Date('2026-09-02T12:30:00.000Z'),
    }

    await expect(
      authorizeOrganizationContribution(
        'user-1',
        review,
        { audience: 'member', requiredPermission: 'alpha.view' },
        now,
      ),
    ).resolves.toEqual({ authorized: false, reason: 'permission' })
    await expect(
      authorizeOrganizationContribution(
        'user-1',
        review,
        { audience: 'member', requiredPermission: 'alpha.view' },
        now,
      ),
    ).resolves.toMatchObject({
      authorized: true,
      context: { entitlementScope: 'review' },
    })
  })

  test('requires exact HR grants and accepts director or current owner evidence', async () => {
    await expect(
      authorizeOrganizationContribution(
        'user-1',
        organization,
        { audience: 'hr', requiredPermission: 'alpha.view' },
        now,
      ),
    ).resolves.toEqual({ authorized: false, reason: 'audience' })

    mocks.grants = [{ role: 'hr_auditor', evidenceStatus: null, reviewDeadline: null }]
    await expect(
      authorizeOrganizationContribution(
        'user-1',
        organization,
        { audience: 'hr', requiredPermission: 'alpha.view' },
        now,
      ),
    ).resolves.toMatchObject({ authorized: true })

    mocks.grants = [{ role: 'organization_owner', evidenceStatus: 'fresh', reviewDeadline: null }]
    await expect(
      authorizeOrganizationContribution(
        'user-1',
        organization,
        { audience: 'director', requiredPermission: 'alpha.view' },
        now,
      ),
    ).resolves.toMatchObject({ authorized: true })
  })
})

describe('organization reviewer contribution authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.grants = []
    mocks.getOrganizationGroupPermissions.mockResolvedValue({
      modules: ['member-audit.skills.read'],
      services: [],
    })
  })

  test.each(['hr_auditor', 'director'] as const)(
    'authorizes an explicit %s reviewer with the exact permission',
    async (role) => {
      mocks.grants = [{ role }]

      await expect(
        authorizeOrganizationReviewerContribution(
          'user-1',
          organization,
          { audience: 'hr', requiredPermission: 'member-audit.skills.read' },
          now,
        ),
      ).resolves.toEqual({
        authorized: true,
        context: {
          organizationVersion: 7,
          audience: 'hr',
          requiredPermission: 'member-audit.skills.read',
          entitlementScope: 'all',
        },
      })
      expect(mocks.getOrganizationGroupPermissions).toHaveBeenCalledWith('user-1', now, 7)
    },
  )

  test('does not treat organization-owner authority as a reviewer grant', async () => {
    mocks.grants = [{ role: 'organization_owner' }]

    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        organization,
        { audience: 'hr', requiredPermission: 'member-audit.skills.read' },
        now,
      ),
    ).resolves.toEqual({ authorized: false, reason: 'audience' })
    expect(mocks.getOrganizationGroupPermissions).not.toHaveBeenCalled()
  })

  test('does not let an HR reviewer enter a director-only contribution', async () => {
    mocks.grants = [{ role: 'hr_auditor' }]

    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        organization,
        { audience: 'director', requiredPermission: 'member-audit.skills.read' },
        now,
      ),
    ).resolves.toEqual({ authorized: false, reason: 'audience' })
    expect(mocks.getOrganizationGroupPermissions).not.toHaveBeenCalled()

    mocks.grants = [{ role: 'director' }]
    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        organization,
        { audience: 'director', requiredPermission: 'member-audit.skills.read' },
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
          state: 'review_required',
          reviewDeadline: new Date('2026-09-02T12:30:00.000Z'),
        },
        { audience: 'hr', requiredPermission: 'member-audit.skills.read' },
        now,
      ),
    ).resolves.toEqual({ authorized: false, reason: 'compliance' })
    expect(mocks.getOrganizationGroupPermissions).not.toHaveBeenCalled()
  })

  test('refuses a blocked reviewer before role and permission reads', async () => {
    mocks.grants = [{ role: 'director' }]

    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        { ...organization, blocked: true },
        { audience: 'director', requiredPermission: 'member-audit.skills.read' },
        now,
      ),
    ).resolves.toEqual({ authorized: false, reason: 'blocked' })
    expect(mocks.getOrganizationGroupPermissions).not.toHaveBeenCalled()
  })

  test.each([
    ['skills', 'assets'],
    ['assets', 'wallet'],
    ['wallet', 'mail'],
    ['mail', 'skills'],
  ] as const)('does not let %s permission authorize the %s section', async (granted, requested) => {
    mocks.grants = [{ role: 'director' }]
    mocks.getOrganizationGroupPermissions.mockResolvedValue({
      modules: [`member-audit.${granted}.read`],
      services: [],
    })

    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        organization,
        { audience: 'director', requiredPermission: `member-audit.${requested}.read` },
        now,
      ),
    ).resolves.toEqual({ authorized: false, reason: 'permission' })
  })

  test('requires the exact permission and a reviewer audience', async () => {
    mocks.grants = [{ role: 'director' }]
    mocks.getOrganizationGroupPermissions.mockResolvedValue({
      modules: ['member-audit.assets.read'],
      services: [],
    })

    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        organization,
        { audience: 'hr', requiredPermission: 'member-audit.skills.read' },
        now,
      ),
    ).resolves.toEqual({ authorized: false, reason: 'permission' })
    await expect(
      authorizeOrganizationReviewerContribution(
        'user-1',
        organization,
        { audience: 'member', requiredPermission: 'member-audit.assets.read' },
        now,
      ),
    ).resolves.toEqual({ authorized: false, reason: 'audience' })
  })

  test('requires every permission declared by a reviewer contribution', async () => {
    mocks.grants = [{ role: 'hr_auditor' }]
    mocks.getOrganizationGroupPermissions.mockResolvedValue({
      modules: ['member-audit.search'],
      services: [],
    })
    const declaration = {
      audience: 'hr' as const,
      requiredPermission: 'member-audit.search',
      additionalRequiredPermissions: ['member-audit.summary.read'],
    }

    await expect(
      authorizeOrganizationReviewerContribution('user-1', organization, declaration, now),
    ).resolves.toEqual({ authorized: false, reason: 'permission' })

    mocks.getOrganizationGroupPermissions.mockResolvedValue({
      modules: ['member-audit.search', 'member-audit.summary.read'],
      services: [],
    })
    await expect(
      authorizeOrganizationReviewerContribution('user-1', organization, declaration, now),
    ).resolves.toMatchObject({ authorized: true })
  })
})

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where']) builder[method] = () => builder
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

import type {
  PlatformInstalledOrganizationContributionAuthorization,
  PlatformInstalledReviewerContributionDescriptor,
} from '@eve-space/platform-module-contract/installed'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizeOrganizationReviewerContribution: vi.fn(),
  findSession: vi.fn(),
  listAvailableReviewerContributions: vi.fn(),
  organization: {
    organizationVersion: 7,
    state: 'compliant' as 'pending' | 'compliant' | 'review_required' | 'suspended',
    evidenceFreshness: 'fresh' as const,
    reviewDeadline: null as Date | null,
    accessValidUntil: new Date('2026-09-19T12:00:00.000Z') as Date | null,
    blocked: false,
  },
  searchManagedOrganizationDirectory: vi.fn(),
  resolveOrganizationReviewerTarget: vi.fn(),
}))

vi.mock('../../src/env.js', () => ({
  env: {
    EVE_CALLBACK_URL: 'http://localhost:8788/auth/eve/callback',
    WEB_ORIGIN: 'http://localhost:3000',
  },
}))
vi.mock('../../src/auth/session-store.js', () => ({ findSession: mocks.findSession }))
vi.mock('../../src/middleware/organization-session.js', () => ({
  loadOrganizationSession: async (
    context: { set(key: string, value: unknown): void },
    next: () => Promise<void>,
  ) => {
    context.set('organization', mocks.organization)
    await next()
  },
}))
vi.mock('../../src/organization/module-authorization.js', () => ({
  authorizeOrganizationReviewerContribution: mocks.authorizeOrganizationReviewerContribution,
}))
vi.mock('../../src/organization/reviewer-account-search.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/organization/reviewer-account-search.js')>()
  return {
    ...original,
    searchManagedOrganizationDirectory: mocks.searchManagedOrganizationDirectory,
  }
})
vi.mock('../../src/organization/reviewer-target.js', () => ({
  resolveOrganizationReviewerTarget: mocks.resolveOrganizationReviewerTarget,
}))
vi.mock('../../src/platform/reviewer-contributions.js', () => ({
  listAvailableReviewerContributions: mocks.listAvailableReviewerContributions,
}))

import { organizationReviewerPlatformRoutes } from '../../src/platform/organization-review-routes.js'
import { ReviewerAccountSearchInputError } from '../../src/organization/reviewer-account-search.js'

const alpha = contribution('alpha', 'overview', 10)
const beta = contribution('beta', 'details', 20)
const directoryPage = {
  organizationVersion: 7,
  status: 'available' as const,
  items: [
    {
      managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
      managedSince: '2026-01-01T00:00:00.000Z',
      siteRegisteredAt: '2025-12-01T00:00:00.000Z',
      account: {
        userId: '00000000-0000-4000-8000-000000000002',
        mainCharacter: { characterId: 90_000_001, name: 'Target Main' },
      },
      portraitCharacter: {
        characterId: 90_000_001,
        name: 'Target Main',
        source: 'main-character' as const,
      },
      managedAffiliation: {
        characterId: 90_000_001,
        name: 'Target Main',
        corporationId: 98_000_001,
        allianceId: null,
        checkedAt: '2026-09-18T12:00:00.000Z',
      },
      disclosedCharacterCount: 1,
      groups: [{ groupId: '00000000-0000-4000-8000-000000000030', name: 'Audited' }],
      compliance: {
        state: 'compliant' as const,
        evidenceFreshness: 'fresh' as const,
        evidenceAt: '2026-09-18T12:00:00.000Z',
        reviewDeadline: null,
        accessValidUntil: '2026-09-19T12:00:00.000Z',
        evaluatedAt: '2026-09-18T12:00:00.000Z',
      },
      block: { blocked: false as const },
      auditData: {
        state: 'current' as const,
        expected: 7,
        covered: 7,
        asOf: '2026-09-18T12:00:00.000Z',
      },
    },
  ],
  groupFacets: [{ groupId: '00000000-0000-4000-8000-000000000030', name: 'Audited' }],
  nextCursor: null,
}

describe('platform organization review routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.organization.organizationVersion = 7
    mocks.organization.state = 'compliant'
    mocks.organization.reviewDeadline = null
    mocks.organization.accessValidUntil = new Date('2026-09-19T12:00:00.000Z')
    mocks.organization.blocked = false
    mocks.findSession.mockResolvedValue({
      userId: 'reviewer-1',
      mainCharacter: null,
    })
    mocks.listAvailableReviewerContributions.mockResolvedValue([alpha, beta])
    mocks.authorizeOrganizationReviewerContribution.mockImplementation(
      async (
        _userId,
        _organization,
        descriptor: PlatformInstalledOrganizationContributionAuthorization,
      ) =>
        descriptor.moduleId === 'alpha'
          ? {
              authorized: true,
              context: {
                organizationVersion: 7,
                audience: 'hr',
                requiredPermission: 'alpha.review',
                entitlementScope: 'all',
              },
            }
          : { authorized: false, reason: 'permission' },
    )
    mocks.searchManagedOrganizationDirectory.mockResolvedValue(directoryPage)
    mocks.resolveOrganizationReviewerTarget.mockResolvedValue({
      organizationVersion: 7,
      managedMemberLifecycleId: directoryPage.items[0]!.managedMemberLifecycleId,
      selection: { kind: 'account' },
      account: directoryPage.items[0]!.account,
      characters: [
        {
          characterId: 90_000_001,
          subjectLifecycleId: 'character-lifecycle-1',
          authorizationGeneration: 4,
          name: 'Target Main',
          isMain: true,
          affiliation: {
            corporationId: 98_000_001,
            allianceId: null,
            membership: 'managed',
            freshness: 'fresh',
            checkedAt: '2026-09-18T12:00:00.000Z',
          },
        },
      ],
      compliance: {
        state: 'compliant',
        evidenceFreshness: 'fresh',
        evidenceAt: '2026-09-18T12:00:00.000Z',
        reviewDeadline: null,
        accessValidUntil: '2026-09-19T12:00:00.000Z',
        evaluatedAt: '2026-09-18T12:00:00.000Z',
      },
      groups: [],
      block: { blocked: false },
    })
  })

  test('returns only independently authorized safe contribution metadata', async () => {
    const response = await request('/')

    expect(response.status).toBe(200)
    expectPrivateResponsePolicy(response)
    const responseText = await response.clone().text()
    await expect(response.json()).resolves.toEqual({
      organizationVersion: 7,
      contributions: [
        {
          moduleId: 'alpha',
          contributionId: 'overview',
          routeId: 'alpha-route',
          routePath: '/api/modules/alpha/accounts/:userId',
          target: 'managed-organization-account',
          label: 'Alpha',
          description: 'Review alpha.',
          icon: 'overview',
          order: 10,
        },
      ],
    })
    expect(responseText).not.toContain('panelPackage')
    expect(mocks.authorizeOrganizationReviewerContribution).toHaveBeenCalledTimes(2)
    expect(mocks.authorizeOrganizationReviewerContribution).toHaveBeenCalledWith(
      'reviewer-1',
      mocks.organization,
      expect.objectContaining({
        moduleId: 'alpha',
        additionalRequiredPermissions: ['alpha.search', 'member-audit.summary.read'],
      }),
    )
  })

  test('returns only the bounded core directory after entry authorization', async () => {
    const response = await request(
      '/members?query=Target&corporationId=98000001&groupId=00000000-0000-4000-8000-000000000030&complianceState=compliant&blocked=false&auditState=current&sort=managed_since&direction=desc&limit=10',
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(directoryPage)
    expect(mocks.searchManagedOrganizationDirectory).toHaveBeenCalledWith({
      organizationVersion: 7,
      filters: {
        query: 'Target',
        corporationId: 98_000_001,
        groupId: '00000000-0000-4000-8000-000000000030',
        complianceState: 'compliant',
        blocked: false,
        auditState: 'current',
        sort: 'managed_since',
        direction: 'desc',
        limit: 10,
      },
    })
    const serialized = JSON.stringify(directoryPage)
    for (const forbidden of [
      'evidenceSections',
      'resourceId',
      'snapshot',
      'records',
      'accessToken',
      'refreshToken',
      'sessionToken',
      'undisclosed',
      'hiddenCharacter',
      'lastSiteActivity',
      'lastSiteLogin',
      'lastLogin',
      'lastLogout',
      'loginCount',
      'exportUrl',
      'csv',
    ])
      expect(serialized).not.toContain(forbidden)
  })

  test('returns the JSON error contract when an opaque cursor no longer matches', async () => {
    mocks.searchManagedOrganizationDirectory.mockRejectedValue(
      new ReviewerAccountSearchInputError(),
    )

    const response = await request('/members?cursor=syntactically-valid-cursor')

    expect(response.status).toBe(400)
    expectPrivateResponsePolicy(response)
    await expect(response.json()).resolves.toEqual({
      code: 'INVALID_REVIEWER_DIRECTORY_INPUT',
      message: 'Invalid reviewer directory input.',
    })
  })

  test.each(['/members', '/members/00000000-0000-4000-8000-000000000002'])(
    'requires summary permission before serving %s',
    async (path) => {
      mocks.authorizeOrganizationReviewerContribution.mockImplementation(
        async (
          _userId,
          _organization,
          descriptor: PlatformInstalledOrganizationContributionAuthorization,
        ) => {
          if (descriptor.additionalRequiredPermissions?.includes('member-audit.summary.read'))
            return { authorized: false, reason: 'permission' }
          return {
            authorized: true,
            context: {
              organizationVersion: 7,
              audience: 'hr',
              requiredPermission: descriptor.requiredPermission,
              entitlementScope: 'all',
            },
          }
        },
      )

      const response = await request(path)

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({
        code: 'ORGANIZATION_REVIEWER_REQUIRED',
      })
      expect(mocks.searchManagedOrganizationDirectory).not.toHaveBeenCalled()
      expect(mocks.resolveOrganizationReviewerTarget).not.toHaveBeenCalled()
    },
  )

  test.each(['directory search', 'member-audit.summary.read'] as const)(
    'requires the exact %s permission before directory enrichment',
    async (missingPermission) => {
      mocks.authorizeOrganizationReviewerContribution.mockImplementation(
        async (
          _userId,
          _organization,
          descriptor: PlatformInstalledOrganizationContributionAuthorization,
        ) =>
          descriptor.additionalRequiredPermissions?.some((permission) =>
            missingPermission === 'directory search'
              ? permission.endsWith('.search')
              : permission === missingPermission,
          )
            ? { authorized: false, reason: 'permission' }
            : {
                authorized: true,
                context: {
                  organizationVersion: 7,
                  audience: 'hr',
                  requiredPermission: descriptor.requiredPermission,
                  entitlementScope: 'all',
                },
              },
      )

      const response = await request('/members')

      expect(response.status).toBe(403)
      expect(mocks.searchManagedOrganizationDirectory).not.toHaveBeenCalled()
    },
  )

  test('does not accept a deployment administrator session as reviewer identity', async () => {
    const response = await organizationReviewerPlatformRoutes.request('/', {
      headers: { cookie: 'eve_space_admin_session=administrator-token' },
    })

    expect(response.status).toBe(401)
    expectPrivateResponsePolicy(response)
    expect(mocks.authorizeOrganizationReviewerContribution).not.toHaveBeenCalled()
  })

  test('returns current disclosed target authority identities without evidence', async () => {
    const response = await request('/members/00000000-0000-4000-8000-000000000002')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      organizationVersion: 7,
      member: {
        managedMemberLifecycleId: directoryPage.items[0]!.managedMemberLifecycleId,
        characters: [
          {
            characterId: 90_000_001,
            subjectLifecycleId: 'character-lifecycle-1',
            authorizationGeneration: 4,
          },
        ],
      },
    })
    expect(mocks.resolveOrganizationReviewerTarget).toHaveBeenCalledWith({
      organizationVersion: 7,
      targetUserId: '00000000-0000-4000-8000-000000000002',
    })
  })

  test('returns no out-of-scope target details after the directory gate', async () => {
    mocks.resolveOrganizationReviewerTarget.mockResolvedValue(null)

    const response = await request('/members/00000000-0000-4000-8000-000000000099')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ message: 'Route not found' })
    expect(mocks.searchManagedOrganizationDirectory).not.toHaveBeenCalled()
  })

  test.each([
    ['ordinary member', 'audience', 'ORGANIZATION_REVIEWER_REQUIRED'],
    ['owner-only authority', 'audience', 'ORGANIZATION_REVIEWER_REQUIRED'],
    ['missing contribution permissions', 'permission', 'ORGANIZATION_REVIEWER_REQUIRED'],
    ['blocked reviewer', 'blocked', 'ORGANIZATION_MEMBER_BLOCKED'],
    ['noncompliant reviewer', 'compliance', 'ORGANIZATION_COMPLIANCE_REQUIRED'],
  ] as const)('refuses %s before directory access', async (_label, reason, code) => {
    mocks.authorizeOrganizationReviewerContribution.mockResolvedValue({
      authorized: false,
      reason,
    })

    const response = await request('/members')

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code })
    expect(mocks.searchManagedOrganizationDirectory).not.toHaveBeenCalled()
  })

  test('hides the transport when every contribution is disabled', async () => {
    mocks.listAvailableReviewerContributions.mockResolvedValue([])

    const response = await request('/')

    expect(response.status).toBe(404)
    expectPrivateResponsePolicy(response)
    expect(mocks.authorizeOrganizationReviewerContribution).not.toHaveBeenCalled()
  })
})

function request(path: string) {
  return organizationReviewerPlatformRoutes.request(path, {
    headers: { cookie: 'eve_space_session=session-token' },
  })
}

function contribution(
  moduleId: string,
  contributionId: string,
  order: number,
): PlatformInstalledReviewerContributionDescriptor {
  return {
    publisherPackage: `@example/${moduleId}-manifest`,
    moduleId,
    contributionId,
    routeId: `${moduleId}-route`,
    routePath: `/api/modules/${moduleId}/accounts/:userId`,
    audience: 'hr',
    requiredPermission: `${moduleId}.review`,
    directoryPermission: `${moduleId}.search`,
    target: 'managed-organization-account',
    panelPackage: `@example/${moduleId}-nuxt`,
    panelExport: `./reviewer/${contributionId}`,
    label: moduleId === 'alpha' ? 'Alpha' : 'Beta',
    description: `Review ${moduleId}.`,
    icon: 'overview',
    order,
  }
}

function expectPrivateResponsePolicy(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Cookie')
}

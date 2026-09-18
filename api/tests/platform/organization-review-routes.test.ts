import type { PlatformInstalledReviewerContributionDescriptor } from '@eve-space/platform-module-contract/installed'
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
vi.mock('../../src/platform/reviewer-contributions.js', () => ({
  listAvailableReviewerContributions: mocks.listAvailableReviewerContributions,
}))

import { organizationReviewerPlatformRoutes } from '../../src/platform/organization-review-routes.js'

const alpha = contribution('alpha', 'overview', 10)
const beta = contribution('beta', 'details', 20)
const directoryPage = {
  organizationVersion: 7,
  status: 'available' as const,
  items: [
    {
      managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
      account: {
        userId: '00000000-0000-4000-8000-000000000002',
        mainCharacter: { characterId: 90_000_001, name: 'Target Main' },
      },
      managedAffiliation: {
        characterId: 90_000_001,
        name: 'Target Main',
        corporationId: 98_000_001,
        allianceId: null,
        checkedAt: '2026-09-18T12:00:00.000Z',
      },
    },
  ],
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
        descriptor: PlatformInstalledReviewerContributionDescriptor,
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
  })

  test('returns only the bounded core directory after entry authorization', async () => {
    const response = await request('/members?query=Target&corporationId=98000001&limit=10')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(directoryPage)
    expect(mocks.searchManagedOrganizationDirectory).toHaveBeenCalledWith({
      organizationVersion: 7,
      filters: { query: 'Target', corporationId: 98_000_001, limit: 10 },
    })
    expect(JSON.stringify(directoryPage)).not.toContain('evidenceSections')
    expect(JSON.stringify(directoryPage)).not.toContain('compliance')
    expect(JSON.stringify(directoryPage)).not.toContain('block')
  })

  test('does not accept a deployment administrator session as reviewer identity', async () => {
    const response = await organizationReviewerPlatformRoutes.request('/', {
      headers: { cookie: 'eve_space_admin_session=administrator-token' },
    })

    expect(response.status).toBe(401)
    expectPrivateResponsePolicy(response)
    expect(mocks.authorizeOrganizationReviewerContribution).not.toHaveBeenCalled()
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

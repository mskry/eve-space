import type { Context, MiddlewareHandler } from 'hono'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { OrganizationSessionEnv } from '../../src/middleware/organization-session.js'

const mocks = vi.hoisted(() => ({
  hasCurrentOrganizationHrAuthority: vi.fn(),
  hasCurrentOrganizationManagerAuthority: vi.fn(),
  hasCurrentOrganizationOwnerAuthority: vi.fn(),
  loadCurrentOrganizationAuthorityForUser: vi.fn(),
  resolveOrganizationEntitlementScope: vi.fn(),
}))

vi.mock('../../src/env.js', () => ({ env: { WEB_ORIGIN: 'http://localhost:3000' } }))
vi.mock('../../src/organization/access-policy.js', () => ({
  resolveOrganizationEntitlementScope: mocks.resolveOrganizationEntitlementScope,
}))
vi.mock('../../src/organization/management-authority.js', () => ({
  hasCurrentOrganizationManagerAuthority: mocks.hasCurrentOrganizationManagerAuthority,
}))
vi.mock('../../src/organization/role-store.js', () => ({
  hasCurrentOrganizationHrAuthority: mocks.hasCurrentOrganizationHrAuthority,
  hasCurrentOrganizationOwnerAuthority: mocks.hasCurrentOrganizationOwnerAuthority,
  loadCurrentOrganizationAuthorityForUser: mocks.loadCurrentOrganizationAuthorityForUser,
}))

import {
  requireFreshOrganizationManager,
  requireFreshOrganizationOwner,
  requireOrganizationActivityAccess,
  requireOrganizationHr,
  requireOrganizationManager,
  requireOrganizationManagerRemediation,
  requireOrganizationOwner,
  requireOrganizationOwnerRemediation,
  requireRegistrationPolicyOwner,
  requireTrustedOrigin,
} from '../../src/organization/route-middleware.js'

const userId = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  mocks.hasCurrentOrganizationHrAuthority.mockResolvedValue(true)
  mocks.hasCurrentOrganizationManagerAuthority.mockResolvedValue(true)
  mocks.hasCurrentOrganizationOwnerAuthority.mockResolvedValue(true)
  mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValue(authority())
  mocks.resolveOrganizationEntitlementScope.mockReturnValue('member')
})

describe('organization route middleware', () => {
  test('requires the configured origin', async () => {
    const refused = await invoke(requireTrustedOrigin, { origin: 'https://attacker.invalid' })
    expect(refused.response?.status).toBe(403)
    expect(refused.next).not.toHaveBeenCalled()

    const accepted = await invoke(requireTrustedOrigin)
    expect(accepted.next).toHaveBeenCalledOnce()
  })

  test('requires current compliance before ordinary owner, manager, and HR checks', async () => {
    const organization = organizationContext({ accessValidUntil: null, state: 'suspended' })

    for (const middleware of [
      requireOrganizationOwner,
      requireFreshOrganizationOwner,
      requireOrganizationOwnerRemediation,
      requireOrganizationManager,
      requireFreshOrganizationManager,
      requireOrganizationManagerRemediation,
      requireOrganizationHr,
    ]) {
      const result = await invoke(middleware, { organization })
      expect(await responseCode(result.response)).toBe('ORGANIZATION_COMPLIANCE_REQUIRED')
      expect(result.next).not.toHaveBeenCalled()
    }

    expect(mocks.hasCurrentOrganizationOwnerAuthority).not.toHaveBeenCalled()
    expect(mocks.hasCurrentOrganizationManagerAuthority).not.toHaveBeenCalled()
    expect(mocks.hasCurrentOrganizationHrAuthority).not.toHaveBeenCalled()
  })

  test('reports blocked and expired compliance with stable context', async () => {
    const blocked = await invoke(requireOrganizationOwner, {
      organization: organizationContext({ blocked: true }),
    })
    expect(await responseCode(blocked.response)).toBe('ORGANIZATION_MEMBER_BLOCKED')

    const expired = await invoke(requireOrganizationOwner, {
      organization: organizationContext({ accessValidUntil: new Date(0) }),
    })
    expect(await responseCode(expired.response)).toBe('ORGANIZATION_COMPLIANCE_REQUIRED')

    const missing = await invoke(requireOrganizationOwner, { organization: undefined })
    expect(await responseCode(missing.response)).toBe('ORGANIZATION_COMPLIANCE_REQUIRED')
  })

  test('checks ordinary owner, manager, and HR authority', async () => {
    mocks.hasCurrentOrganizationOwnerAuthority.mockResolvedValueOnce(false)
    expect(await responseCode((await invoke(requireOrganizationOwner)).response)).toBe(
      'ORGANIZATION_OWNER_REQUIRED',
    )
    expect((await invoke(requireOrganizationOwner)).next).toHaveBeenCalledOnce()

    mocks.hasCurrentOrganizationManagerAuthority.mockResolvedValueOnce(false)
    expect(await responseCode((await invoke(requireOrganizationManager)).response)).toBe(
      'ORGANIZATION_MANAGER_REQUIRED',
    )
    expect((await invoke(requireOrganizationManager)).next).toHaveBeenCalledOnce()

    mocks.hasCurrentOrganizationHrAuthority.mockResolvedValueOnce(false)
    expect(await responseCode((await invoke(requireOrganizationHr)).response)).toBe(
      'ORGANIZATION_HR_REQUIRED',
    )
    expect((await invoke(requireOrganizationHr)).next).toHaveBeenCalledOnce()
  })

  test.each([
    ['fresh', null],
    ['degraded', 'ORGANIZATION_AUTHORITY_DEGRADED'],
    ['invalid', 'ORGANIZATION_AUTHORITY_SOURCE_INVALID'],
    [null, 'ORGANIZATION_OWNER_REQUIRED'],
  ] as const)('classifies %s registration-policy owner evidence', async (state, code) => {
    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(authority({ owner: state }))
    const result = await invoke(requireRegistrationPolicyOwner)

    expect(result.next).toHaveBeenCalledTimes(code === null ? 1 : 0)
    expect(await responseCode(result.response)).toBe(code ?? undefined)
  })

  test('requires fresh owner evidence for privilege expansion', async () => {
    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(
      authority({ organizationOwner: true, owner: 'degraded' }),
    )
    expect(await responseCode((await invoke(requireFreshOrganizationOwner)).response)).toBe(
      'ORGANIZATION_AUTHORITY_DEGRADED',
    )

    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(
      authority({ owner: 'fresh' }),
    )
    expect((await invoke(requireFreshOrganizationOwner)).next).toHaveBeenCalledOnce()
  })

  test('permits owner remediation only with continuity authority', async () => {
    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(null)
    expect(await responseCode((await invoke(requireOrganizationOwnerRemediation)).response)).toBe(
      'ORGANIZATION_OWNER_REPLACEMENT_REQUIRED',
    )

    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(
      authority({ organizationOwner: true, owner: 'degraded' }),
    )
    expect((await invoke(requireOrganizationOwnerRemediation)).next).toHaveBeenCalledOnce()
    expect(mocks.loadCurrentOrganizationAuthorityForUser).toHaveBeenLastCalledWith(
      userId,
      expect.any(Date),
      'remediate',
    )
  })

  test.each([
    [authority({ explicitDirector: true }), null],
    [authority({ owner: 'fresh' }), null],
    [authority({ derived: ['fresh'] }), null],
    [authority({ organizationOwner: true, owner: 'degraded' }), 'ORGANIZATION_AUTHORITY_DEGRADED'],
    [authority({ derived: ['invalid'] }), 'ORGANIZATION_AUTHORITY_SOURCE_INVALID'],
    [null, 'ORGANIZATION_MANAGER_REQUIRED'],
  ] as const)('classifies fresh manager authority %#', async (value, code) => {
    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(value)
    const result = await invoke(requireFreshOrganizationManager)

    expect(result.next).toHaveBeenCalledTimes(code === null ? 1 : 0)
    expect(await responseCode(result.response)).toBe(code ?? undefined)
  })

  test('falls back to fresh mutation authority when no source detail is present', async () => {
    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(authority())
    mocks.hasCurrentOrganizationManagerAuthority.mockResolvedValueOnce(false)
    expect(await responseCode((await invoke(requireFreshOrganizationManager)).response)).toBe(
      'ORGANIZATION_MANAGER_REQUIRED',
    )

    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(authority())
    expect((await invoke(requireFreshOrganizationManager)).next).toHaveBeenCalledOnce()
    expect(mocks.hasCurrentOrganizationManagerAuthority).toHaveBeenLastCalledWith(userId, 'mutate')
  })

  test('classifies manager remediation authority', async () => {
    mocks.loadCurrentOrganizationAuthorityForUser
      .mockResolvedValueOnce(authority({ derived: ['degraded'], director: true }))
      .mockResolvedValueOnce(authority({ derived: ['invalid'] }))
      .mockResolvedValueOnce(authority())

    expect((await invoke(requireOrganizationManagerRemediation)).next).toHaveBeenCalledOnce()
    expect(await responseCode((await invoke(requireOrganizationManagerRemediation)).response)).toBe(
      'ORGANIZATION_AUTHORITY_SOURCE_INVALID',
    )
    expect(await responseCode((await invoke(requireOrganizationManagerRemediation)).response)).toBe(
      'ORGANIZATION_MANAGER_REQUIRED',
    )
  })

  test('gates organization activity by block and entitlement scope', async () => {
    const blocked = await invoke(requireOrganizationActivityAccess, {
      organization: organizationContext({ blocked: true }),
    })
    expect(await responseCode(blocked.response)).toBe('ORGANIZATION_MEMBER_BLOCKED')

    mocks.resolveOrganizationEntitlementScope.mockReturnValueOnce('none')
    const noncompliant = await invoke(requireOrganizationActivityAccess)
    expect(await responseCode(noncompliant.response)).toBe('ORGANIZATION_COMPLIANCE_REQUIRED')

    expect((await invoke(requireOrganizationActivityAccess)).next).toHaveBeenCalledOnce()
  })
})

interface InvokeOptions {
  readonly origin?: string
  readonly organization?: ReturnType<typeof organizationContext>
}

async function invoke(
  middleware: MiddlewareHandler<OrganizationSessionEnv>,
  options: InvokeOptions = {},
) {
  const next = vi.fn(async () => undefined)
  const context = {
    json: vi.fn((body: unknown, status: number) => Response.json(body, { status })),
    req: { header: vi.fn(() => options.origin ?? 'http://localhost:3000') },
    var: {
      organization: 'organization' in options ? options.organization : organizationContext(),
      session: { userId },
    },
  } as unknown as Context<OrganizationSessionEnv>
  const response = await middleware(context, next)
  return { next, response: response instanceof Response ? response : undefined }
}

async function responseCode(response: Response | undefined) {
  return (await response?.json())?.code
}

function organizationContext(
  overrides: Partial<{
    blocked: boolean
    state: 'compliant' | 'pending' | 'suspended'
    accessValidUntil: Date | null
    reviewDeadline: Date | null
  }> = {},
) {
  return {
    accessValidUntil: new Date(Date.now() + 60_000),
    blocked: false,
    reviewDeadline: null,
    state: 'compliant' as const,
    ...overrides,
  }
}

function authority(
  options: {
    readonly owner?: 'fresh' | 'degraded' | 'invalid' | null
    readonly derived?: readonly ('fresh' | 'degraded' | 'invalid')[]
    readonly organizationOwner?: boolean
    readonly explicitDirector?: boolean
    readonly director?: boolean
  } = {},
) {
  const derivedSources = (options.derived ?? []).map((state, index) => ({
    characterId: index + 1,
    sourceId: `derived-${index}`,
    state,
  }))
  return {
    degraded:
      options.owner === 'degraded' || derivedSources.some(({ state }) => state === 'degraded'),
    derivedDirector: derivedSources.some(({ state }) => state !== 'invalid'),
    derivedSources,
    director: options.director ?? options.explicitDirector ?? false,
    explicitDirector: options.explicitDirector ?? false,
    organizationOwner: options.organizationOwner ?? false,
    ownerSource: options.owner ? { sourceId: 'owner', characterId: 1, state: options.owner } : null,
  }
}

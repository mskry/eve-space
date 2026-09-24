import type { ApiClient } from '../../app/utils/api-client'
import {
  organizationReviewDirectoryQuery,
  organizationReviewEntryQuery,
  organizationReviewTargetQuery,
} from '../../app/queries/organization-review'
import {
  availableOrganizationReviewerPanels,
  parseOrganizationReviewUrlState,
  selectedReviewerTarget,
} from '../../app/utils/organization-review'
import { describe, expect, it, vi } from 'vitest'

describe('organization review queries', () => {
  it('keys every directory dimension under the private reviewer scope', () => {
    const options = organizationReviewDirectoryQuery({
      apiClient: apiClient(),
      enabled: true,
      input: {
        auditState: 'stale',
        blocked: false,
        complianceState: 'review_required',
        corporationId: 98_000_001,
        cursor: 'opaque_cursor',
        direction: 'desc',
        groupId: '00000000-0000-4000-8000-000000000099',
        limit: 50,
        organizationVersion: 7,
        query: 'pilot',
        sort: 'managed_since',
      },
    })

    expect(options.key).toStrictEqual([
      'private',
      'organization',
      'reviewer',
      7,
      'members',
      'pilot',
      98_000_001,
      '00000000-0000-4000-8000-000000000099',
      'review_required',
      false,
      'stale',
      'managed_since',
      'desc',
      'opaque_cursor',
      50,
    ])
    expect(options.meta?.esiPersistence).toStrictEqual({ kind: 'none' })
    expect(options.enabled ?? false).toBe(false)
  })

  it('uses typed review paths, forwards abort signals, and handles responses strictly', async () => {
    const signal = new AbortController().signal
    const entryGet = vi.fn().mockResolvedValue(Response.json(entryResponse()))
    const membersGet = vi.fn().mockResolvedValue(Response.json(directoryResponse()))
    const client = apiClient(entryGet, membersGet)
    const entry = organizationReviewEntryQuery({ apiClient: client, authenticated: true })
    const directory = organizationReviewDirectoryQuery({
      apiClient: client,
      enabled: true,
      input: { limit: 25, organizationVersion: 7 },
    })

    await expect(entry.query({ signal } as never)).resolves.toStrictEqual(entryResponse())
    await expect(directory.query({ signal } as never)).resolves.toStrictEqual(directoryResponse())
    expect(entryGet).toHaveBeenCalledWith(undefined, { init: { signal } })
    expect(membersGet).toHaveBeenCalledWith({ query: { limit: '25' } }, { init: { signal } })

    entryGet.mockResolvedValueOnce(
      Response.json(
        { code: 'ORGANIZATION_REVIEWER_REQUIRED', message: 'Denied.' },
        { status: 403 },
      ),
    )
    await expect(entry.query({ signal } as never)).rejects.toMatchObject({
      code: 'ORGANIZATION_REVIEWER_REQUIRED',
      status: 403,
    })
  })

  it('keys exact targets by organization and identity and forwards character lookups and aborts', async () => {
    const signal = new AbortController().signal
    const targetGet = vi.fn().mockResolvedValue(Response.json(targetResponse()))
    const options = organizationReviewTargetQuery({
      apiClient: apiClient(vi.fn(), vi.fn(), targetGet),
      enabled: true,
      input: {
        organizationVersion: 7,
        targetCharacterId: 90_000_001,
        targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      },
    })

    expect(options.key).toStrictEqual([
      'private',
      'organization',
      'reviewer',
      7,
      'targets',
      '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      90_000_001,
      null,
    ])
    expect(options.meta?.esiPersistence).toStrictEqual({ kind: 'none' })
    await expect(options.query({ signal } as never)).resolves.toMatchObject({
      member: targetResponse().member,
    })
    expect(targetGet).toHaveBeenCalledWith(
      { param: { userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c' } },
      { init: { signal } },
    )
  })

  it('rejects a character outside the resolved disclosed target', async () => {
    const targetGet = vi.fn().mockResolvedValue(Response.json(targetResponse()))
    const options = organizationReviewTargetQuery({
      apiClient: apiClient(vi.fn(), vi.fn(), targetGet),
      enabled: true,
      input: {
        organizationVersion: 7,
        targetCharacterId: 90_000_099,
        targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      },
    })

    await expect(options.query({ signal: undefined } as never)).resolves.toMatchObject({
      member: null,
    })
  })
})

describe('organization review selection policy', () => {
  it('intersects API authority with exact literal catalog route metadata', () => {
    const alpha = panel('alpha', 'summary', 'managed-organization-account')
    const beta = panel('beta', 'details', 'managed-organization-character')
    const mismatch = { ...beta, routePath: '/api/modules/untrusted' }

    expect(
      availableOrganizationReviewerPanels([authorized(alpha), authorized(beta)], [alpha, mismatch]),
    ).toStrictEqual([alpha])
  })

  it('validates untrusted deep links and never accepts an invented character identity', () => {
    expect(
      parseOrganizationReviewUrlState({
        contribution: 'alpha/summary',
        targetCharacterId: '90000002',
        targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      }),
    ).toStrictEqual({
      contribution: 'alpha/summary',
      targetCharacterId: 90_000_002,
      targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
    })
    expect(
      parseOrganizationReviewUrlState({
        contribution: '@bad/path/extra',
        targetCharacterId: '-1',
        targetUserId: '../user',
      }),
    ).toStrictEqual({})

    const member = targetResponse().member
    const sectionAuthority = { activationVersion: 3, disclosureVersion: 2 }
    const accountTarget = selectedReviewerTarget(
      member,
      panel('alpha', 'summary', 'managed-organization-account'),
      123,
      sectionAuthority,
    )
    const characterTarget = selectedReviewerTarget(
      member,
      panel('beta', 'details', 'managed-organization-character'),
      member.managedAffiliation.characterId,
      sectionAuthority,
    )
    expect(accountTarget).toStrictEqual({
      kind: 'managed-organization-account',
      managedMemberLifecycleId: 'member-lifecycle-1',
      sectionActivationVersion: 3,
      userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
    })
    expect(characterTarget).toStrictEqual({
      authorizationGeneration: 4,
      characterId: 90_000_001,
      characterLifecycleId: 'character-lifecycle-1',
      disclosureVersion: 2,
      kind: 'managed-organization-character',
      managedMemberLifecycleId: 'member-lifecycle-1',
      sectionActivationVersion: 3,
      userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
    })
    expect(
      selectedReviewerTarget(
        member,
        panel('beta', 'details', 'managed-organization-character'),
        90_000_002,
        sectionAuthority,
      ),
    ).toMatchObject({
      authorizationGeneration: 5,
      characterId: 90_000_002,
      characterLifecycleId: 'character-lifecycle-2',
    })
    expect(
      selectedReviewerTarget(
        member,
        panel('beta', 'details', 'managed-organization-character'),
        90_000_099,
        sectionAuthority,
      ),
    ).toBeUndefined()
    expect(characterTarget).not.toHaveProperty('subjectLifecycleId')
  })
})

function apiClient(entryGet = vi.fn(), membersGet = vi.fn(), targetGet = vi.fn()) {
  return {
    api: {
      organization: {
        review: { $get: entryGet, members: { $get: membersGet, ':userId': { $get: targetGet } } },
      },
    },
  } as unknown as ApiClient
}

function entryResponse() {
  const alpha = panel('alpha', 'summary', 'managed-organization-account')
  return { contributions: [authorized(alpha)], organizationVersion: 7 }
}

function directoryResponse() {
  return {
    groupFacets: [{ groupId: 'group-remote', name: 'Remote reviewers' }],
    items: [
      {
        managedMemberLifecycleId: 'member-lifecycle-1',
        managedSince: '2026-01-01T00:00:00.000Z',
        siteRegisteredAt: '2025-12-01T00:00:00.000Z',
        account: {
          userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
          mainCharacter: { characterId: 90_000_001, name: 'Review Pilot' },
        },
        portraitCharacter: {
          characterId: 90_000_001,
          name: 'Review Pilot',
          source: 'main-character' as const,
        },
        managedAffiliation: {
          characterId: 90_000_001,
          name: 'Review Pilot',
          corporationId: 98_000_001,
          allianceId: null,
          checkedAt: '2026-09-18T00:00:00.000Z',
        },
        disclosedCharacterCount: 1,
        groups: [],
        compliance: {
          state: 'compliant' as const,
          evidenceFreshness: 'fresh' as const,
          evidenceAt: '2026-09-18T00:00:00.000Z',
          reviewDeadline: null,
          accessValidUntil: '2026-09-19T00:00:00.000Z',
          evaluatedAt: '2026-09-18T00:00:00.000Z',
        },
        block: { blocked: false as const },
        auditData: {
          state: 'current' as const,
          expected: 7,
          covered: 7,
          asOf: '2026-09-18T00:00:00.000Z',
        },
      },
    ],
    nextCursor: null,
    organizationVersion: 7,
    status: 'available' as const,
  }
}

function targetResponse() {
  return {
    member: {
      ...directoryResponse().items[0]!,
      characters: [
        {
          characterId: 90_000_001,
          subjectLifecycleId: 'character-lifecycle-1',
          authorizationGeneration: 4,
          name: 'Review Pilot',
          isMain: true,
          affiliation: {
            corporationId: 98_000_001,
            allianceId: null,
            membership: 'managed' as const,
            freshness: 'fresh' as const,
            checkedAt: '2026-09-18T00:00:00.000Z',
          },
        },
        {
          characterId: 90_000_002,
          subjectLifecycleId: 'character-lifecycle-2',
          authorizationGeneration: 5,
          name: 'External Pilot',
          isMain: false,
          affiliation: {
            corporationId: 98_000_002,
            allianceId: null,
            membership: 'approved-external' as const,
            freshness: 'fresh' as const,
            checkedAt: '2026-09-18T00:00:00.000Z',
          },
        },
      ],
    },
    organizationVersion: 7,
  }
}

function panel(
  moduleId: string,
  contributionId: string,
  target: 'managed-organization-account' | 'managed-organization-character',
) {
  return {
    audience: 'hr' as const,
    contributionId,
    description: `Review ${moduleId}.`,
    icon: 'overview' as const,
    label: `${moduleId} ${contributionId}`,
    load: vi.fn(),
    moduleId,
    order: moduleId === 'alpha' ? 10 : 20,
    panelExport: `./reviewer/${contributionId}`,
    requiredPermission: `${moduleId}.review`,
    routeId: `${moduleId}-${contributionId}`,
    routePath: `/api/modules/${moduleId}/${contributionId}`,
    sectionId: undefined,
    target,
  }
}

function authorized(panelEntry: ReturnType<typeof panel>) {
  const {
    moduleId,
    contributionId,
    routeId,
    routePath,
    sectionId,
    target,
    label,
    description,
    icon,
    order,
  } = panelEntry
  return {
    moduleId,
    contributionId,
    routeId,
    routePath,
    ...(sectionId === undefined ? {} : { sectionId }),
    target,
    label,
    description,
    icon,
    order,
  }
}

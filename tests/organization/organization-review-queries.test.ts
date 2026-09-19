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
        organizationVersion: 7,
        query: 'pilot',
        corporationId: 98_000_001,
        cursor: 'opaque_cursor',
        limit: 50,
      },
    })

    expect(options.key).toEqual([
      'private',
      'organization',
      'reviewer',
      7,
      'members',
      'pilot',
      98_000_001,
      'opaque_cursor',
      50,
    ])
    expect(options.meta?.esiPersistence).toEqual({ kind: 'none' })
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
      input: { organizationVersion: 7, limit: 25 },
    })

    await expect(entry.query({ signal } as never)).resolves.toEqual(entryResponse())
    await expect(directory.query({ signal } as never)).resolves.toEqual(directoryResponse())
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
        targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        targetCharacterId: 90_000_001,
      },
    })

    expect(options.key).toEqual([
      'private',
      'organization',
      'reviewer',
      7,
      'targets',
      '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      90_000_001,
      null,
    ])
    expect(options.meta?.esiPersistence).toEqual({ kind: 'none' })
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
        targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        targetCharacterId: 90_000_099,
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
    ).toEqual([alpha])
  })

  it('validates untrusted deep links and never accepts an invented character identity', () => {
    expect(
      parseOrganizationReviewUrlState({
        targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        targetCharacterId: '90000002',
        contribution: 'alpha/summary',
      }),
    ).toEqual({
      targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      targetCharacterId: 90_000_002,
      contribution: 'alpha/summary',
    })
    expect(
      parseOrganizationReviewUrlState({
        targetUserId: '../user',
        targetCharacterId: '-1',
        contribution: '@bad/path/extra',
      }),
    ).toEqual({})

    const member = targetResponse().member
    const sectionAuthority = { disclosureVersion: 2, activationVersion: 3 }
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
    expect(accountTarget).toEqual({
      kind: 'managed-organization-account',
      managedMemberLifecycleId: 'member-lifecycle-1',
      userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      sectionActivationVersion: 3,
    })
    expect(characterTarget).toEqual({
      kind: 'managed-organization-character',
      managedMemberLifecycleId: 'member-lifecycle-1',
      userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      characterId: 90_000_001,
      characterLifecycleId: 'character-lifecycle-1',
      authorizationGeneration: 4,
      disclosureVersion: 2,
      sectionActivationVersion: 3,
    })
    expect(
      selectedReviewerTarget(
        member,
        panel('beta', 'details', 'managed-organization-character'),
        90_000_002,
        sectionAuthority,
      ),
    ).toMatchObject({
      characterId: 90_000_002,
      characterLifecycleId: 'character-lifecycle-2',
      authorizationGeneration: 5,
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
  return { organizationVersion: 7, contributions: [authorized(alpha)] }
}

function directoryResponse() {
  return {
    organizationVersion: 7,
    status: 'available' as const,
    items: [
      {
        managedMemberLifecycleId: 'member-lifecycle-1',
        account: {
          userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
          mainCharacter: { characterId: 90_000_001, name: 'Review Pilot' },
        },
        managedAffiliation: {
          characterId: 90_000_001,
          name: 'Review Pilot',
          corporationId: 98_000_001,
          allianceId: null,
          checkedAt: '2026-09-18T00:00:00.000Z',
        },
      },
    ],
    nextCursor: null,
  }
}

function targetResponse() {
  return {
    organizationVersion: 7,
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
  }
}

function panel(
  moduleId: string,
  contributionId: string,
  target: 'managed-organization-account' | 'managed-organization-character',
) {
  return {
    moduleId,
    contributionId,
    routeId: `${moduleId}-${contributionId}`,
    routePath: `/api/modules/${moduleId}/${contributionId}`,
    audience: 'hr' as const,
    requiredPermission: `${moduleId}.review`,
    target,
    panelExport: `./reviewer/${contributionId}`,
    label: `${moduleId} ${contributionId}`,
    description: `Review ${moduleId}.`,
    icon: 'overview' as const,
    order: moduleId === 'alpha' ? 10 : 20,
    sectionId: undefined,
    load: vi.fn(),
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
    sectionId,
    target,
    label,
    description,
    icon,
    order,
  }
}

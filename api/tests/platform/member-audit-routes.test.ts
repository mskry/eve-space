import type {
  PlatformOrganizationContributionAuthorization,
  PlatformReviewerTargetContext,
} from '@eve-space/platform-module-contract/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assignOrdinaryGroup: vi.fn(),
  authorizeReviewer: vi.fn(),
  blockMember: vi.fn(),
  collectionStatusRead: vi.fn(),
  createCommands: vi.fn(),
  createEvidence: vi.fn(),
  createEvidenceSummary: vi.fn(),
  enabled: true,
  evidenceRead: vi.fn(),
  evidenceSummaryRead: vi.fn(),
  findSession: vi.fn(),
  recordSensitiveAccess: vi.fn(),
  resolveTarget: vi.fn(),
  revokeOrdinaryGroup: vi.fn(),
  searchDirectory: vi.fn(),
  unblockMember: vi.fn(),
}))

vi.mock('../../src/auth/session-store.js', () => ({ findSession: mocks.findSession }))
vi.mock('../../src/platform/module-settings.js', () => ({
  isInstalledModuleContributionEnabled: vi.fn(async () => mocks.enabled),
  loadModuleRuntimeState: vi.fn(async () => ({
    enabledModuleIds: ['member-audit'],
    enabledSections: ['overview', 'skills', 'assets', 'wallet', 'mail', 'access-management'].map(
      (sectionId) => ({
        activationVersion: 1,
        disclosureVersion: 1,
        kind: sectionId === 'access-management' ? 'access-management' : 'sensitive-evidence',
        moduleId: 'member-audit',
        sectionId,
      }),
    ),
    shellNavigationOrder: { character: [], dashboard: [] },
  })),
}))
vi.mock('../../src/middleware/organization-session.js', () => ({
  loadOrganizationSession: async (
    context: { set(key: string, value: unknown): void },
    next: () => Promise<void>,
  ) => {
    context.set('organization', organizationSession)
    await next()
  },
}))
vi.mock('../../src/organization/module-authorization.js', () => ({
  authorizeOrganizationContribution: vi.fn(),
  authorizeOrganizationReviewerContribution: mocks.authorizeReviewer,
}))
vi.mock('../../src/organization/reviewer-target.js', () => ({
  resolveOrganizationReviewerTarget: mocks.resolveTarget,
}))
vi.mock('../../src/organization/reviewer-account-search.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/organization/reviewer-account-search.js')>()),
  searchManagedOrganizationDirectory: mocks.searchDirectory,
}))
vi.mock('../../src/platform/module-reviewer-collection-status-capabilities.js', () => ({
  createPlatformReviewerCollectionStatusReads: vi.fn(() => ({
    read: mocks.collectionStatusRead,
  })),
}))
vi.mock('../../src/platform/module-reviewer-evidence-summary-capabilities.js', () => ({
  createPlatformReviewerEvidenceSummaryReads: mocks.createEvidenceSummary,
}))
vi.mock('../../src/platform/module-reviewer-evidence-capabilities.js', () => ({
  createPlatformReviewerEvidenceReads: mocks.createEvidence,
}))
vi.mock('../../src/platform/module-organization-command-capabilities.js', () => ({
  createPlatformOrganizationCommandCapabilities: mocks.createCommands,
}))
vi.mock('../../src/platform/module-sensitive-access-audit.js', () => ({
  recordModuleSensitiveAccessDecision: mocks.recordSensitiveAccess,
}))

import { app } from '../../src/index.js'

const reviewerUserId = '00000000-0000-4000-8000-000000000001'
const targetUserId = '00000000-0000-4000-8000-000000000002'
const characterId = 90_000_001
const groupId = '00000000-0000-4000-8000-000000000030'
const assignmentId = '00000000-0000-4000-8000-000000000031'
const sessionHeaders = { cookie: 'eve_space_session=session-token' }
const jsonHeaders = {
  ...sessionHeaders,
  'content-type': 'application/json',
}
const organizationSession = {
  accessValidUntil: new Date('2026-09-19T12:00:00.000Z'),
  blocked: false,
  evidenceFreshness: 'fresh' as const,
  organizationVersion: 7,
  reviewDeadline: null,
  state: 'compliant' as const,
}
const targetBase = {
  account: {
    mainCharacter: { characterId, name: 'Target Pilot' },
    userId: targetUserId,
  },
  block: { blocked: false as const },
  characters: [
    {
      characterId,
      subjectLifecycleId: '00000000-0000-4000-8000-000000000021',
      authorizationGeneration: 3,
      name: 'Target Pilot',
      isMain: true,
      affiliation: {
        corporationId: 98_000_001,
        allianceId: null,
        membership: 'managed' as const,
        freshness: 'fresh' as const,
        checkedAt: '2026-09-18T10:00:00.000Z',
      },
    },
  ],
  compliance: {
    accessValidUntil: null,
    evaluatedAt: '2026-09-18T10:00:00.000Z',
    evidenceAt: '2026-09-18T10:00:00.000Z',
    evidenceFreshness: 'fresh' as const,
    reviewDeadline: null,
    state: 'compliant' as const,
  },
  groups: [
    {
      groupId,
      assignmentId,
      name: 'Registration compliant',
      restricted: false,
      managementMode: 'compliance' as const,
      readOnly: true,
      assignedAt: '2026-09-18T10:00:00.000Z',
      expiresAt: null,
    },
  ],
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  organizationVersion: 7,
}

describe('full-root Member Audit routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled = true
    mocks.findSession.mockResolvedValue({
      mainCharacter: {
        allianceId: null,
        characterId: 90_000_010,
        corporationId: 98_000_001,
        isMain: true,
        name: 'Reviewer Pilot',
      },
      userId: reviewerUserId,
    })
    mocks.authorizeReviewer.mockImplementation(
      async (
        _userId: string,
        _organization: unknown,
        declaration: PlatformOrganizationContributionAuthorization,
      ) => ({
        authorized: true,
        context: {
          additionalRequiredPermissions: declaration.additionalRequiredPermissions,
          audience: declaration.audience,
          entitlementScope: 'all',
          organizationVersion: 7,
          requiredPermission: declaration.requiredPermission,
        },
      }),
    )
    mocks.resolveTarget.mockImplementation(
      async ({ characterId: selectedCharacterId }: { characterId?: number }) =>
        ({
          ...targetBase,
          selection:
            selectedCharacterId === undefined
              ? { kind: 'account' as const }
              : {
                  characterId: selectedCharacterId,
                  kind: 'character' as const,
                  subjectLifecycleId: targetBase.characters[0]!.subjectLifecycleId,
                },
        }) satisfies PlatformReviewerTargetContext,
    )
    mocks.searchDirectory.mockResolvedValue({
      groupFacets: [],
      items: [],
      nextCursor: null,
      organizationVersion: 7,
      status: 'available',
    })
    mocks.evidenceSummaryRead.mockResolvedValue([
      { characterId, sections: [{ resources: [], sectionId: 'skills' }] },
    ])
    mocks.createEvidenceSummary.mockReturnValue({ read: mocks.evidenceSummaryRead })
    mocks.collectionStatusRead.mockImplementation(async (resourceId: string) => ({
      resourceId,
      status: 'current',
    }))
    mocks.evidenceRead.mockResolvedValue({ records: [] })
    mocks.createEvidence.mockReturnValue({ read: mocks.evidenceRead })
    mocks.assignOrdinaryGroup.mockResolvedValue({
      assignmentId,
      decision: 'assigned',
      expiresAt: null,
      groupId,
    })
    mocks.revokeOrdinaryGroup.mockResolvedValue({
      assignmentId,
      decision: 'revoked',
      groupId,
      revokedAt: '2026-09-18T12:00:00.000Z',
    })
    mocks.blockMember.mockResolvedValue({
      blockId: '00000000-0000-4000-8000-000000000040',
      blockedAt: '2026-09-18T12:00:00.000Z',
      decision: 'blocked',
    })
    mocks.unblockMember.mockResolvedValue({
      blockId: '00000000-0000-4000-8000-000000000040',
      decision: 'unblocked',
      unblockedAt: '2026-09-18T12:05:00.000Z',
    })
    mocks.createCommands.mockReturnValue({
      assignOrdinaryGroup: mocks.assignOrdinaryGroup,
      blockMember: mocks.blockMember,
      revokeOrdinaryGroup: mocks.revokeOrdinaryGroup,
      unblockMember: mocks.unblockMember,
    })
  })

  test('mounts bounded search, summary, and independently authorized detail routes', async () => {
    const search = await app.request('/api/organization/review/members?limit=25', {
      headers: sessionHeaders,
    })
    expect(search.status).toBe(200)
    expectPrivate(search)
    await expect(search.json()).resolves.toMatchObject({ items: [], organizationVersion: 7 })

    const summary = await app.request(
      `/api/modules/member-audit/accounts/${targetUserId}/summary`,
      { headers: sessionHeaders },
    )
    expect(summary.status).toBe(200)
    expectPrivate(summary)
    await expect(summary.json()).resolves.toMatchObject({
      account: { userId: targetUserId },
      evidence: [{ characterId }],
      groups: [{ managementMode: 'compliance', readOnly: true }],
      organizationVersion: 7,
    })

    const sections = [
      ['skills', 'member-audit.skills.read'],
      ['assets', 'member-audit.assets.read'],
      ['wallet', 'member-audit.wallet.read'],
      ['mail', 'member-audit.mail.read'],
    ] as const
    for (const [section, permission] of sections) {
      const response = await app.request(
        `/api/modules/member-audit/accounts/${targetUserId}/characters/${characterId}/${section}`,
        { headers: sessionHeaders },
      )
      expect(response.status).toBe(200)
      expectPrivate(response)
      expect(mocks.authorizeReviewer).toHaveBeenLastCalledWith(
        reviewerUserId,
        organizationSession,
        expect.objectContaining({ requiredPermission: permission }),
      )
    }
    expect(mocks.recordSensitiveAccess).toHaveBeenCalledTimes(4)
    expect(mocks.recordSensitiveAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: reviewerUserId,
        decision: 'allowed',
        reason: 'authorized',
        sectionId: 'mail',
        targetCharacterId: characterId,
        targetUserId,
      }),
    )
  })

  test('mounts exact group and block commands without accepting target substitution', async () => {
    const assigned = await app.request(
      `/api/modules/member-audit/accounts/${targetUserId}/groups/${groupId}`,
      {
        body: JSON.stringify({ reason: 'Approved access.' }),
        headers: jsonHeaders,
        method: 'POST',
      },
    )
    expect(assigned.status).toBe(201)
    expect(mocks.createCommands).toHaveBeenCalledWith(
      ['assign-ordinary-group', 'revoke-ordinary-group'],
      expect.objectContaining({ actorUserId: reviewerUserId }),
    )

    const revoked = await app.request(
      `/api/modules/member-audit/accounts/${targetUserId}/groups/${groupId}/assignments/${assignmentId}`,
      {
        body: JSON.stringify({ reason: 'Access ended.' }),
        headers: jsonHeaders,
        method: 'DELETE',
      },
    )
    expect(revoked.status).toBe(200)
    expect(mocks.revokeOrdinaryGroup).toHaveBeenCalledWith({
      assignmentId,
      groupId,
      reason: 'Access ended.',
    })

    const blocked = await app.request(`/api/modules/member-audit/accounts/${targetUserId}/block`, {
      body: JSON.stringify({ reason: 'Immediate review hold.' }),
      headers: jsonHeaders,
      method: 'POST',
    })
    expect(blocked.status).toBe(201)
    const unblocked = await app.request(
      `/api/modules/member-audit/accounts/${targetUserId}/block`,
      {
        body: JSON.stringify({ reason: 'Reevaluate current access.' }),
        headers: jsonHeaders,
        method: 'DELETE',
      },
    )
    expect(unblocked.status).toBe(200)

    const forged = await app.request(
      `/api/modules/member-audit/accounts/${targetUserId}/groups/${groupId}`,
      {
        body: JSON.stringify({ reason: 'Substitution.', targetUserId: reviewerUserId }),
        headers: jsonHeaders,
        method: 'POST',
      },
    )
    expect(forged.status).toBe(400)
    expect(mocks.assignOrdinaryGroup).toHaveBeenCalledOnce()
  })

  test.each([
    ['ordinary member', 'audience'],
    ['deployment-only administrator', 'audience'],
    ['missing-permission reviewer', 'permission'],
    ['blocked reviewer', 'blocked'],
    ['noncompliant reviewer', 'compliance'],
  ] as const)('refuses a %s before target or evidence access', async (_label, reason) => {
    mocks.authorizeReviewer.mockResolvedValueOnce({ authorized: false, reason })

    const response = await app.request(
      `/api/modules/member-audit/accounts/${targetUserId}/characters/${characterId}/mail`,
      { headers: sessionHeaders },
    )

    expect(response.status).toBe(403)
    expect(mocks.resolveTarget).not.toHaveBeenCalled()
    expect(mocks.collectionStatusRead).not.toHaveBeenCalled()
    expect(mocks.evidenceRead).not.toHaveBeenCalled()
    expect(mocks.recordSensitiveAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'denied',
        targetCharacterId: null,
        targetUserId: null,
      }),
    )
  })

  test('refuses disabled modules and stale or arbitrary targets before feature reads', async () => {
    mocks.enabled = false
    const disabled = await app.request(
      `/api/modules/member-audit/accounts/${targetUserId}/summary`,
      { headers: sessionHeaders },
    )
    expect(disabled.status).toBe(404)
    expect(mocks.findSession).not.toHaveBeenCalled()

    mocks.enabled = true
    mocks.resolveTarget.mockResolvedValueOnce(null)
    const staleTarget = await app.request(
      `/api/modules/member-audit/accounts/${targetUserId}/characters/${characterId}/skills`,
      { headers: sessionHeaders },
    )
    expect(staleTarget.status).toBe(404)
    expect(mocks.collectionStatusRead).not.toHaveBeenCalled()
    expect(mocks.evidenceRead).not.toHaveBeenCalled()
    expect(mocks.recordSensitiveAccess).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'denied', reason: 'target-not-authorized' }),
    )
  })
})

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toContain('Cookie')
}

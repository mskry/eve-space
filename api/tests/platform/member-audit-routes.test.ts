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
  evidenceRead: vi.fn(),
  evidenceSummaryRead: vi.fn(),
  enabled: true,
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
        moduleId: 'member-audit',
        sectionId,
        kind: sectionId === 'access-management' ? 'access-management' : 'sensitive-evidence',
        disclosureVersion: 1,
        activationVersion: 1,
      }),
    ),
    shellNavigationOrder: { dashboard: [], character: [] },
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
  organizationVersion: 7,
  state: 'compliant' as const,
  evidenceFreshness: 'fresh' as const,
  reviewDeadline: null,
  accessValidUntil: new Date('2026-09-19T12:00:00.000Z'),
  blocked: false,
}
const targetBase = {
  organizationVersion: 7,
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  account: {
    userId: targetUserId,
    mainCharacter: { characterId, name: 'Target Pilot' },
  },
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
    state: 'compliant' as const,
    evidenceFreshness: 'fresh' as const,
    evidenceAt: '2026-09-18T10:00:00.000Z',
    reviewDeadline: null,
    accessValidUntil: null,
    evaluatedAt: '2026-09-18T10:00:00.000Z',
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
  block: { blocked: false as const },
}

describe('full-root Member Audit routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled = true
    mocks.findSession.mockResolvedValue({
      userId: reviewerUserId,
      mainCharacter: {
        characterId: 90_000_010,
        name: 'Reviewer Pilot',
        corporationId: 98_000_001,
        allianceId: null,
        isMain: true,
      },
    })
    mocks.authorizeReviewer.mockImplementation(
      async (
        _userId: string,
        _organization: unknown,
        declaration: PlatformOrganizationContributionAuthorization,
      ) => ({
        authorized: true,
        context: {
          organizationVersion: 7,
          audience: declaration.audience,
          requiredPermission: declaration.requiredPermission,
          additionalRequiredPermissions: declaration.additionalRequiredPermissions,
          entitlementScope: 'all',
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
                  kind: 'character' as const,
                  characterId: selectedCharacterId,
                  subjectLifecycleId: targetBase.characters[0]!.subjectLifecycleId,
                },
        }) satisfies PlatformReviewerTargetContext,
    )
    mocks.searchDirectory.mockResolvedValue({
      organizationVersion: 7,
      status: 'available',
      items: [],
      nextCursor: null,
    })
    mocks.evidenceSummaryRead.mockResolvedValue([
      { characterId, sections: [{ sectionId: 'skills', resources: [] }] },
    ])
    mocks.createEvidenceSummary.mockReturnValue({ read: mocks.evidenceSummaryRead })
    mocks.collectionStatusRead.mockImplementation(async (resourceId: string) => ({
      resourceId,
      status: 'current',
    }))
    mocks.evidenceRead.mockResolvedValue({ records: [] })
    mocks.createEvidence.mockReturnValue({ read: mocks.evidenceRead })
    mocks.assignOrdinaryGroup.mockResolvedValue({
      decision: 'assigned',
      groupId,
      assignmentId,
      expiresAt: null,
    })
    mocks.revokeOrdinaryGroup.mockResolvedValue({
      decision: 'revoked',
      groupId,
      assignmentId,
      revokedAt: '2026-09-18T12:00:00.000Z',
    })
    mocks.blockMember.mockResolvedValue({
      decision: 'blocked',
      blockId: '00000000-0000-4000-8000-000000000040',
      blockedAt: '2026-09-18T12:00:00.000Z',
    })
    mocks.unblockMember.mockResolvedValue({
      decision: 'unblocked',
      blockId: '00000000-0000-4000-8000-000000000040',
      unblockedAt: '2026-09-18T12:05:00.000Z',
    })
    mocks.createCommands.mockReturnValue({
      assignOrdinaryGroup: mocks.assignOrdinaryGroup,
      revokeOrdinaryGroup: mocks.revokeOrdinaryGroup,
      blockMember: mocks.blockMember,
      unblockMember: mocks.unblockMember,
    })
  })

  test('mounts bounded search, summary, and independently authorized detail routes', async () => {
    const search = await app.request('/api/organization/review/members?limit=25', {
      headers: sessionHeaders,
    })
    expect(search.status).toBe(200)
    expectPrivate(search)
    await expect(search.json()).resolves.toMatchObject({ organizationVersion: 7, items: [] })

    const summary = await app.request(
      `/api/modules/member-audit/accounts/${targetUserId}/summary`,
      { headers: sessionHeaders },
    )
    expect(summary.status).toBe(200)
    expectPrivate(summary)
    await expect(summary.json()).resolves.toMatchObject({
      organizationVersion: 7,
      account: { userId: targetUserId },
      groups: [{ managementMode: 'compliance', readOnly: true }],
      evidence: [{ characterId }],
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
        targetUserId,
        targetCharacterId: characterId,
        sectionId: 'mail',
        decision: 'allowed',
        reason: 'authorized',
      }),
    )
  })

  test('mounts exact group and block commands without accepting target substitution', async () => {
    const assigned = await app.request(
      `/api/modules/member-audit/accounts/${targetUserId}/groups/${groupId}`,
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ reason: 'Approved access.' }),
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
        method: 'DELETE',
        headers: jsonHeaders,
        body: JSON.stringify({ reason: 'Access ended.' }),
      },
    )
    expect(revoked.status).toBe(200)
    expect(mocks.revokeOrdinaryGroup).toHaveBeenCalledWith({
      groupId,
      assignmentId,
      reason: 'Access ended.',
    })

    const blocked = await app.request(`/api/modules/member-audit/accounts/${targetUserId}/block`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ reason: 'Immediate review hold.' }),
    })
    expect(blocked.status).toBe(201)
    const unblocked = await app.request(
      `/api/modules/member-audit/accounts/${targetUserId}/block`,
      {
        method: 'DELETE',
        headers: jsonHeaders,
        body: JSON.stringify({ reason: 'Reevaluate current access.' }),
      },
    )
    expect(unblocked.status).toBe(200)

    const forged = await app.request(
      `/api/modules/member-audit/accounts/${targetUserId}/groups/${groupId}`,
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ reason: 'Substitution.', targetUserId: reviewerUserId }),
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
        targetUserId: null,
        targetCharacterId: null,
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

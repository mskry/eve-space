import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class RoleMutationError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  class GroupMutationError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  class MemberBlockMutationError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  class CorporationSourceMutationError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  class CharacterExceptionMutationError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  class RegistrationPolicyMutationError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  const organizationSession: {
    context: {
      organizationVersion: number
      state: 'pending' | 'compliant' | 'review_required' | 'suspended'
      evidenceFreshness: 'fresh' | 'stale' | 'unavailable'
      reviewDeadline: Date | null
      accessValidUntil: Date | null
      blocked: boolean
    }
  } = {
    context: {
      organizationVersion: 1,
      state: 'compliant' as const,
      evidenceFreshness: 'fresh' as const,
      reviewDeadline: null,
      accessValidUntil: new Date('2027-09-01T12:00:00.000Z'),
      blocked: false,
    },
  }
  return {
    CorporationSourceMutationError,
    CharacterExceptionMutationError,
    GroupMutationError,
    MemberBlockMutationError,
    RoleMutationError,
    RegistrationPolicyMutationError,
    aggregateOrganizationActivities: vi.fn(),
    approveOrganizationCharacterException: vi.fn(),
    assignOrganizationGroup: vi.fn(),
    blockOrganizationMember: vi.fn(),
    createOrganizationGroup: vi.fn(),
    createOrganizationPermissionBundle: vi.fn(),
    expireOrganizationCharacterException: vi.fn(),
    findSession: vi.fn(),
    getOrganizationAccountComplianceDetails: vi.fn(),
    getOrganizationAccessContext: vi.fn(),
    grantOrganizationRole: vi.fn(),
    hasCurrentOrganizationOwnerAuthority: vi.fn(),
    hasCurrentOrganizationManagerAuthority: vi.fn(),
    hasCurrentOrganizationHrAuthority: vi.fn(),
    listOrganizationRosterCoverage: vi.fn(),
    listCurrentOrganizationAuditHistory: vi.fn(),
    listCurrentOrganizationCharacterExceptionCandidates: vi.fn(),
    listCurrentOrganizationGroups: vi.fn(),
    listCurrentOrganizationCharacterExceptions: vi.fn(),
    listCurrentOrganizationMemberBlocks: vi.fn(),
    listCurrentOrganizationRoles: vi.fn(),
    loadOrganizationSession: vi.fn(
      async (
        context: { set: (key: string, value: unknown) => void },
        next: () => Promise<void>,
      ) => {
        context.set('organization', organizationSession.context)
        await next()
      },
    ),
    organizationSession,
    revokeOrganizationRole: vi.fn(),
    revokeOrganizationCharacterException: vi.fn(),
    revokeOrganizationGroupAssignment: vi.fn(),
    registerOrganizationCorporationSource: vi.fn(),
    unblockOrganizationMember: vi.fn(),
    updateOrganizationRegistrationPolicy: vi.fn(),
  }
})

vi.mock('../../src/env.js', () => ({ env: { WEB_ORIGIN: 'http://localhost:3000' } }))
vi.mock('../../src/auth/session-store.js', () => ({ findSession: mocks.findSession }))
vi.mock('../../src/organization/activity.js', () => ({
  aggregateOrganizationActivities: mocks.aggregateOrganizationActivities,
}))
vi.mock('../../src/middleware/organization-session.js', () => ({
  loadOrganizationSession: mocks.loadOrganizationSession,
}))
vi.mock('../../src/organization/block-store.js', () => ({
  OrganizationMemberBlockMutationError: mocks.MemberBlockMutationError,
  blockOrganizationMember: mocks.blockOrganizationMember,
  listCurrentOrganizationMemberBlocks: mocks.listCurrentOrganizationMemberBlocks,
  unblockOrganizationMember: mocks.unblockOrganizationMember,
}))
vi.mock('../../src/organization/group-store.js', () => ({
  assignOrganizationGroup: mocks.assignOrganizationGroup,
  createOrganizationGroup: mocks.createOrganizationGroup,
  createOrganizationPermissionBundle: mocks.createOrganizationPermissionBundle,
  listCurrentOrganizationGroups: mocks.listCurrentOrganizationGroups,
  revokeOrganizationGroupAssignment: mocks.revokeOrganizationGroupAssignment,
}))
vi.mock('../../src/organization/group-mutation-error.js', () => ({
  OrganizationGroupMutationError: mocks.GroupMutationError,
}))
vi.mock('../../src/organization/management-authority.js', () => ({
  hasCurrentOrganizationManagerAuthority: mocks.hasCurrentOrganizationManagerAuthority,
}))
vi.mock('../../src/organization/corporation-sources.js', () => ({
  OrganizationCorporationSourceMutationError: mocks.CorporationSourceMutationError,
  registerOrganizationCorporationSource: mocks.registerOrganizationCorporationSource,
}))
vi.mock('../../src/organization/compliance-details.js', () => ({
  getOrganizationAccountComplianceDetails: mocks.getOrganizationAccountComplianceDetails,
}))
vi.mock('../../src/organization/exception-store.js', () => ({
  OrganizationCharacterExceptionMutationError: mocks.CharacterExceptionMutationError,
  approveOrganizationCharacterException: mocks.approveOrganizationCharacterException,
  expireOrganizationCharacterException: mocks.expireOrganizationCharacterException,
  listCurrentOrganizationCharacterExceptionCandidates:
    mocks.listCurrentOrganizationCharacterExceptionCandidates,
  listCurrentOrganizationCharacterExceptions: mocks.listCurrentOrganizationCharacterExceptions,
  revokeOrganizationCharacterException: mocks.revokeOrganizationCharacterException,
}))
vi.mock('../../src/organization/roster-coverage.js', () => ({
  listOrganizationRosterCoverage: mocks.listOrganizationRosterCoverage,
}))
vi.mock('../../src/organization/audit-history.js', () => ({
  listCurrentOrganizationAuditHistory: mocks.listCurrentOrganizationAuditHistory,
}))
vi.mock('../../src/organization/role-store.js', () => ({
  OrganizationRoleMutationError: mocks.RoleMutationError,
  getOrganizationAccessContext: mocks.getOrganizationAccessContext,
  grantOrganizationRole: mocks.grantOrganizationRole,
  hasCurrentOrganizationOwnerAuthority: mocks.hasCurrentOrganizationOwnerAuthority,
  hasCurrentOrganizationHrAuthority: mocks.hasCurrentOrganizationHrAuthority,
  listCurrentOrganizationRoles: mocks.listCurrentOrganizationRoles,
  revokeOrganizationRole: mocks.revokeOrganizationRole,
}))
vi.mock('../../src/organization/policy-store.js', () => ({
  OrganizationRegistrationPolicyMutationError: mocks.RegistrationPolicyMutationError,
  updateOrganizationRegistrationPolicy: mocks.updateOrganizationRegistrationPolicy,
}))

import { organizationRoutes } from '../../src/organization/routes.js'

const actorUserId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const targetUserId = '98a782d2-e042-47d7-9659-03b218121a1a'
const grantId = '35acd527-9539-44ad-aacf-9f8e45232267'
const bundleId = '345697a4-df0b-44e7-bf19-f10912c53a27'
const groupId = '81974469-fdfe-4327-9f87-1df6e23badc4'
const assignmentId = '7643fd73-6350-4307-b7cd-041b74c41ad6'
const blockId = 'bc83840d-47c2-4c76-aed4-94d3e51407f7'
const grant = {
  grantId,
  organizationVersion: 1,
  userId: targetUserId,
  role: 'hr_auditor',
  reason: 'HR coverage duty.',
  grantedByUserId: actorUserId,
  grantedAt: '2026-08-31T12:00:00.000Z',
  revokedAt: null,
  revokedByUserId: null,
  revocationReason: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.organizationSession.context = {
    organizationVersion: 1,
    state: 'compliant',
    evidenceFreshness: 'fresh',
    reviewDeadline: null,
    accessValidUntil: new Date('2027-09-01T12:00:00.000Z'),
    blocked: false,
  }
  mocks.findSession.mockResolvedValue({
    userId: actorUserId,
    mainCharacter: {
      characterId: 1_404_328_063,
      name: 'Owner',
      corporationId: 98_000_001,
      allianceId: null,
      isMain: true,
    },
  })
  mocks.hasCurrentOrganizationOwnerAuthority.mockResolvedValue(true)
  mocks.hasCurrentOrganizationManagerAuthority.mockResolvedValue(true)
  mocks.hasCurrentOrganizationHrAuthority.mockResolvedValue(true)
  mocks.listCurrentOrganizationGroups.mockResolvedValue({ groups: [] })
  mocks.listCurrentOrganizationMemberBlocks.mockResolvedValue({ blocks: [] })
  mocks.getOrganizationAccessContext.mockResolvedValue({
    organization: {
      organizationType: 'corporation',
      organizationId: 98_000_001,
      organizationName: 'Example Corporation',
      organizationTicker: 'EX',
      organizationVersion: 1,
    },
    isOrganizationOwner: true,
    isBlocked: false,
    capabilities: { reviewRegistration: true, viewRosterCoverage: true },
    claimAvailable: false,
    ownerStatus: 'fresh',
    reviewDeadline: null,
    authorityCharacter: {
      characterId: 1_404_328_063,
      name: 'Owner',
      corporationId: 98_000_001,
      verifiedAt: '2026-08-31T12:00:00.000Z',
      lastCheckedAt: '2026-08-31T12:00:00.000Z',
    },
  })
  mocks.listCurrentOrganizationRoles.mockResolvedValue({ grants: [grant] })
  mocks.getOrganizationAccountComplianceDetails.mockResolvedValue({
    organizationVersion: 1,
    state: 'compliant',
    evidenceFreshness: 'fresh',
    reviewDeadline: null,
    characters: [],
  })
  mocks.aggregateOrganizationActivities.mockResolvedValue({
    organizationVersion: 1,
    generatedAt: '2026-09-02T12:00:00.000Z',
    activities: [],
    sources: [],
  })
  mocks.listCurrentOrganizationCharacterExceptions.mockResolvedValue([])
  mocks.listCurrentOrganizationCharacterExceptionCandidates.mockResolvedValue([])
  mocks.listCurrentOrganizationAuditHistory.mockResolvedValue({
    events: [],
    nextBeforeAuditSequence: null,
  })
  mocks.grantOrganizationRole.mockResolvedValue(grant)
  mocks.revokeOrganizationRole.mockResolvedValue({
    ...grant,
    revokedAt: '2026-08-31T13:00:00.000Z',
    revokedByUserId: actorUserId,
    revocationReason: 'Duty ended.',
  })
  mocks.createOrganizationPermissionBundle.mockResolvedValue({
    bundleId,
    organizationVersion: 1,
    name: 'Operations',
    permissions: [{ type: 'module', key: 'organization-activity.manage' }],
  })
  mocks.createOrganizationGroup.mockResolvedValue({
    groupId,
    organizationVersion: 1,
    name: 'Operations',
    restricted: false,
    managementMode: 'manual',
    complianceSource: null,
    bundleIds: [bundleId],
  })
  const assignment = {
    assignmentId,
    groupId,
    organizationVersion: 1,
    userId: targetUserId,
    assignmentSource: 'manual',
    assignedActorType: 'user',
    assignedByUserId: actorUserId,
    reason: 'Operations duty.',
    assignedAt: '2026-09-01T12:00:00.000Z',
    expiresAt: '2026-10-01T12:00:00.000Z',
    revokedAt: null,
    revokedActorType: null,
    revokedByUserId: null,
    revocationReason: null,
  }
  mocks.assignOrganizationGroup.mockResolvedValue(assignment)
  mocks.revokeOrganizationGroupAssignment.mockResolvedValue({
    ...assignment,
    revokedAt: '2026-09-02T12:00:00.000Z',
    revokedActorType: 'user',
    revokedByUserId: actorUserId,
    revocationReason: 'Duty ended.',
  })
  const block = {
    blockId,
    organizationVersion: 1,
    userId: targetUserId,
    blockedByUserId: actorUserId,
    reason: 'Repeated policy abuse.',
    blockedAt: '2026-09-01T12:00:00.000Z',
    unblockedAt: null,
    unblockedByUserId: null,
    unblockReason: null,
  }
  mocks.blockOrganizationMember.mockResolvedValue(block)
  mocks.unblockOrganizationMember.mockResolvedValue({
    ...block,
    unblockedAt: '2026-09-02T12:00:00.000Z',
    unblockedByUserId: actorUserId,
    unblockReason: 'Review completed.',
  })
  mocks.listOrganizationRosterCoverage.mockResolvedValue({
    managedCorporations: {
      status: 'current',
      validatedAt: '2026-09-01T12:00:00.000Z',
      attemptedAt: '2026-09-01T12:00:00.000Z',
      lastFailureClass: null,
    },
    corporations: [],
  })
  mocks.registerOrganizationCorporationSource.mockResolvedValue({
    replaced: false,
    source: {
      sourceId: 'cc83840d-47c2-4c76-aed4-94d3e51407f7',
      organizationVersion: 1,
      corporationId: 98_000_001,
      characterId: 1_404_328_063,
      registeredByUserId: actorUserId,
      registeredAt: '2026-09-01T12:00:00.000Z',
    },
  })
  mocks.updateOrganizationRegistrationPolicy.mockResolvedValue({
    organizationVersion: 1,
    policyVersion: 2,
    requiredScopes: ['esi-skills.read_skills.v1'],
    strictRemediationDurationSeconds: 0,
    staleEvidenceGraceDurationSeconds: 3600,
  })
  const exception = {
    exceptionId: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
    organizationVersion: 1,
    userId: targetUserId,
    characterId: 90_000_001,
    approverUserId: actorUserId,
    reason: 'Approved external character.',
    approvedAt: new Date('2026-09-01T12:00:00.000Z'),
    expiresAt: null,
    expiredAt: null,
    revokedAt: null,
    revokedByUserId: null,
    revocationReason: null,
  }
  mocks.approveOrganizationCharacterException.mockResolvedValue(exception)
  mocks.expireOrganizationCharacterException.mockResolvedValue({
    ...exception,
    expiresAt: new Date('2026-09-02T12:00:00.000Z'),
    expiredAt: new Date('2026-09-02T12:00:00.000Z'),
  })
  mocks.revokeOrganizationCharacterException.mockResolvedValue({
    ...exception,
    revokedAt: new Date('2026-09-02T12:00:00.000Z'),
    revokedByUserId: actorUserId,
    revocationReason: 'No longer required.',
  })
})

describe('organization compliance routes', () => {
  test('applies the canonical private response policy to every outcome class', async () => {
    const anonymous = await organizationRoutes.request('/context')
    const success = await get('/context')
    const invalid = await get('/audit?beforeAuditSequence=invalid')
    mocks.hasCurrentOrganizationOwnerAuthority.mockResolvedValueOnce(false)
    const unauthorized = await get('/roles')

    expect([anonymous.status, success.status, invalid.status, unauthorized.status]).toEqual([
      401, 200, 400, 403,
    ])
    for (const response of [anonymous, success, invalid, unauthorized]) {
      expectPrivateResponsePolicy(response)
    }
  })

  test.each(['pending', 'review_required', 'suspended'] as const)(
    'keeps self compliance details available while the account is %s',
    async (state) => {
      mocks.organizationSession.context.state = state
      mocks.organizationSession.context.accessValidUntil = null

      const response = await get('/compliance')

      expect(response.status).toBe(200)
      expect(mocks.getOrganizationAccountComplianceDetails).toHaveBeenCalledWith(actorUserId)
    },
  )

  test('keeps self compliance details available to a blocked account', async () => {
    mocks.organizationSession.context.blocked = true

    const response = await get('/compliance')

    expect(response.status).toBe(200)
    expect(mocks.getOrganizationAccountComplianceDetails).toHaveBeenCalledOnce()
  })

  test.each(['pending', 'review_required', 'suspended'] as const)(
    'refuses protected data before role or private store reads while %s',
    async (state) => {
      mocks.organizationSession.context.state = state
      mocks.organizationSession.context.accessValidUntil = null

      const response = await get('/roles')

      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        code: 'ORGANIZATION_COMPLIANCE_REQUIRED',
        state,
      })
      expect(mocks.hasCurrentOrganizationOwnerAuthority).not.toHaveBeenCalled()
      expect(mocks.listCurrentOrganizationRoles).not.toHaveBeenCalled()
    },
  )

  test('refuses expired compliance and explicit blocks before private reads', async () => {
    mocks.organizationSession.context.accessValidUntil = new Date('2026-01-01T00:00:00.000Z')
    const expired = await get('/roles')
    expect(expired.status).toBe(403)

    mocks.organizationSession.context.accessValidUntil = new Date('2027-09-01T12:00:00.000Z')
    mocks.organizationSession.context.blocked = true
    const blocked = await get('/roles')
    expect(blocked.status).toBe(403)
    expect(await blocked.json()).toMatchObject({ code: 'ORGANIZATION_MEMBER_BLOCKED' })
    expect(mocks.listCurrentOrganizationRoles).not.toHaveBeenCalled()
  })

  test('does not extend governance access during a member review period', async () => {
    const deadline = new Date(Date.now() + 60_000)
    mocks.organizationSession.context.state = 'review_required'
    mocks.organizationSession.context.reviewDeadline = deadline
    mocks.organizationSession.context.accessValidUntil = deadline

    const response = await get('/roles')

    expect(response.status).toBe(403)
    expect(mocks.hasCurrentOrganizationOwnerAuthority).not.toHaveBeenCalled()
    expect(mocks.listCurrentOrganizationRoles).not.toHaveBeenCalled()
  })

  test('returns bounded member activity for compliant and review-period accounts', async () => {
    const compliant = await get('/activities')
    expect(compliant.status).toBe(200)
    expect(compliant.headers.get('cache-control')).toBe('private, no-store')

    const deadline = new Date(Date.now() + 60_000)
    mocks.organizationSession.context.state = 'review_required'
    mocks.organizationSession.context.reviewDeadline = deadline
    mocks.organizationSession.context.accessValidUntil = deadline
    const review = await get('/activities')

    expect(review.status).toBe(200)
    expect(mocks.aggregateOrganizationActivities).toHaveBeenCalledTimes(2)
  })

  test('refuses blocked or suspended activity requests before providers are selected', async () => {
    mocks.organizationSession.context.blocked = true
    const blocked = await get('/activities')
    expect(blocked.status).toBe(403)
    expect(await blocked.json()).toMatchObject({ code: 'ORGANIZATION_MEMBER_BLOCKED' })

    mocks.organizationSession.context.blocked = false
    mocks.organizationSession.context.state = 'suspended'
    mocks.organizationSession.context.accessValidUntil = null
    const suspended = await get('/activities')
    expect(suspended.status).toBe(403)
    expect(await suspended.json()).toMatchObject({ code: 'ORGANIZATION_COMPLIANCE_REQUIRED' })
    expect(mocks.aggregateOrganizationActivities).not.toHaveBeenCalled()
  })
})

describe('organization compliance management routes', () => {
  test('updates registration policy through an audited owner mutation', async () => {
    const response = await mutate('PUT', '/registration-policy', {
      requiredScopes: ['esi-skills.read_skills.v1'],
      strictRemediationDurationSeconds: 0,
      staleEvidenceGraceDurationSeconds: 3600,
      reason: 'Require current skills authorization.',
    })

    expect(response.status).toBe(200)
    expect(mocks.updateOrganizationRegistrationPolicy).toHaveBeenCalledWith({
      actorUserId,
      requiredScopes: ['esi-skills.read_skills.v1'],
      strictRemediationDurationSeconds: 0,
      staleEvidenceGraceDurationSeconds: 3600,
      reason: 'Require current skills authorization.',
    })
  })

  test('allows a suspended verified owner to submit a recovery policy', async () => {
    mocks.organizationSession.context.state = 'suspended'
    mocks.organizationSession.context.accessValidUntil = null

    const response = await mutate('PUT', '/registration-policy', {
      requiredScopes: [],
      strictRemediationDurationSeconds: 0,
      staleEvidenceGraceDurationSeconds: 3600,
      reason: 'Remove the policy that suspended the owner.',
    })

    expect(response.status).toBe(200)
    expect(mocks.updateOrganizationRegistrationPolicy).toHaveBeenCalledOnce()
  })

  test('still requires verified owner authority for policy recovery', async () => {
    mocks.organizationSession.context.state = 'suspended'
    mocks.organizationSession.context.accessValidUntil = null
    mocks.hasCurrentOrganizationOwnerAuthority.mockResolvedValueOnce(false)

    const response = await mutate('PUT', '/registration-policy', {
      requiredScopes: [],
      strictRemediationDurationSeconds: 0,
      staleEvidenceGraceDurationSeconds: 3600,
      reason: 'Unauthorized recovery attempt.',
    })

    expect(response.status).toBe(403)
    expect(mocks.updateOrganizationRegistrationPolicy).not.toHaveBeenCalled()
  })

  test('maps a policy that would suspend its owner to a conflict', async () => {
    mocks.updateOrganizationRegistrationPolicy.mockRejectedValueOnce(
      new mocks.RegistrationPolicyMutationError('owner-policy-noncompliant'),
    )

    const response = await mutate('PUT', '/registration-policy', {
      requiredScopes: ['esi-wallet.read_character_wallet.v1'],
      strictRemediationDurationSeconds: 0,
      staleEvidenceGraceDurationSeconds: 3600,
      reason: 'Unsafe owner policy.',
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: 'REGISTRATION_POLICY_OWNER_NONCOMPLIANT',
    })
  })

  test('lists, approves, expires, and revokes external-character exceptions for HR', async () => {
    mocks.listCurrentOrganizationCharacterExceptionCandidates.mockResolvedValueOnce([
      {
        userId: targetUserId,
        characterId: 90_000_001,
        characterName: 'External Pilot',
        reasonCode: 'character-outside-managed-organization',
        state: 'review_required',
        evidenceFreshness: 'fresh',
        reviewDeadline: new Date('2026-09-10T12:00:00.000Z'),
        affiliationCheckedAt: new Date('2026-09-08T12:00:00.000Z'),
      },
    ])
    const listed = await get('/exceptions')
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({
      exceptions: [],
      reviewCandidates: [
        expect.objectContaining({
          userId: targetUserId,
          characterId: 90_000_001,
          state: 'review_required',
        }),
      ],
    })

    const approved = await request(`/members/${targetUserId}/characters/90000001/exception`, {
      reason: 'Approved external character.',
      expiresAt: null,
    })
    expect(approved.status).toBe(201)
    expect(mocks.approveOrganizationCharacterException).toHaveBeenCalledWith({
      actorUserId,
      userId: targetUserId,
      characterId: 90_000_001,
      reason: 'Approved external character.',
      expiresAt: null,
    })

    const expired = await request('/exceptions/22c7e94c-9cd3-4dc0-a3af-43117426ebec/expire', {
      reason: 'Approval window ended.',
    })
    expect(expired.status).toBe(200)
    expect(mocks.expireOrganizationCharacterException).toHaveBeenCalledWith({
      actorUserId,
      exceptionId: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
      reason: 'Approval window ended.',
    })

    const revoked = await request('/exceptions/22c7e94c-9cd3-4dc0-a3af-43117426ebec/revoke', {
      reason: 'No longer required.',
    })
    expect(revoked.status).toBe(200)
    expect(mocks.revokeOrganizationCharacterException).toHaveBeenCalledWith({
      actorUserId,
      exceptionId: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
      reason: 'No longer required.',
    })
  })

  test('refuses exception reads before their store and maps stale managed evidence', async () => {
    mocks.hasCurrentOrganizationHrAuthority.mockResolvedValueOnce(false)
    const unauthorized = await get('/exceptions')
    expect(unauthorized.status).toBe(403)
    expect(mocks.listCurrentOrganizationCharacterExceptions).not.toHaveBeenCalled()
    expect(mocks.listCurrentOrganizationCharacterExceptionCandidates).not.toHaveBeenCalled()

    mocks.approveOrganizationCharacterException.mockRejectedValueOnce(
      new mocks.CharacterExceptionMutationError('managed-corporation-evidence-stale'),
    )
    const stale = await request(`/members/${targetUserId}/characters/90000001/exception`, {
      reason: 'Cannot rely on stale evidence.',
      expiresAt: null,
    })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: 'MANAGED_CORPORATION_EVIDENCE_STALE' })
  })

  test.each([
    ['HR authority', 'hr-authority-required', 403, 'ORGANIZATION_HR_REQUIRED'],
    ['missing character', 'character-not-found', 404, 'CHARACTER_NOT_FOUND'],
    [
      'stale character affiliation',
      'character-affiliation-stale',
      409,
      'CHARACTER_AFFILIATION_STALE',
    ],
    ['managed character', 'character-not-external', 409, 'CHARACTER_NOT_EXTERNAL'],
    ['active exception', 'exception-already-active', 409, 'CHARACTER_EXCEPTION_EXISTS'],
    ['invalid expiry', 'invalid-expiry', 400, 'INVALID_EXCEPTION_EXPIRY'],
  ])('maps %s exception approval failures', async (_name, errorCode, status, responseCode) => {
    mocks.approveOrganizationCharacterException.mockRejectedValueOnce(
      new mocks.CharacterExceptionMutationError(errorCode),
    )

    const response = await request(`/members/${targetUserId}/characters/90000001/exception`, {
      reason: 'Reviewed external character.',
      expiresAt: null,
    })

    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ code: responseCode })
  })

  test.each([
    ['expire', mocks.expireOrganizationCharacterException, '/expire'],
    ['revoke', mocks.revokeOrganizationCharacterException, '/revoke'],
  ])('maps a missing exception during %s', async (_name, mock, suffix) => {
    mock.mockRejectedValueOnce(new mocks.CharacterExceptionMutationError('exception-not-found'))

    const response = await request(`/exceptions/22c7e94c-9cd3-4dc0-a3af-43117426ebec${suffix}`, {
      reason: 'Reviewed exception.',
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'CHARACTER_EXCEPTION_NOT_FOUND' })
  })

  test.each([
    ['owner authority', 'owner-authority-required', 403, 'ORGANIZATION_OWNER_REQUIRED'],
    ['invalid policy', 'invalid-policy', 400, 'INVALID_REGISTRATION_POLICY'],
  ])('maps %s policy-store failures', async (_name, errorCode, status, responseCode) => {
    mocks.updateOrganizationRegistrationPolicy.mockRejectedValueOnce(
      new mocks.RegistrationPolicyMutationError(errorCode),
    )

    const response = await mutate('PUT', '/registration-policy', {
      requiredScopes: [],
      strictRemediationDurationSeconds: 0,
      staleEvidenceGraceDurationSeconds: 3600,
      reason: 'Reviewed policy update.',
    })

    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ code: responseCode })
  })
})

describe('organization role routes', () => {
  test('returns claim context to authenticated users without requiring owner authority', async () => {
    const response = await get('/context')

    expect(response.status).toBe(200)
    expect(mocks.getOrganizationAccessContext).toHaveBeenCalledWith(actorUserId)
    expect(mocks.hasCurrentOrganizationOwnerAuthority).not.toHaveBeenCalled()
  })

  test('exposes member query access only for an unblocked current entitlement', async () => {
    expect(await (await get('/context')).json()).toMatchObject({ memberAccess: true })
    mocks.organizationSession.context.blocked = true
    expect(await (await get('/context')).json()).toMatchObject({ memberAccess: false })
    mocks.organizationSession.context.blocked = false
    mocks.organizationSession.context.state = 'suspended'
    expect(await (await get('/context')).json()).toMatchObject({ memberAccess: false })
    mocks.organizationSession.context.state = 'compliant'
    mocks.organizationSession.context.organizationVersion = 2
    expect(await (await get('/context')).json()).toMatchObject({ memberAccess: false })
  })

  test('returns active role grants only to the current organization owner', async () => {
    const authorized = await get('/roles')
    expect(authorized.status).toBe(200)
    expect(await authorized.json()).toEqual({ grants: [grant] })

    mocks.hasCurrentOrganizationOwnerAuthority.mockResolvedValueOnce(false)
    const unauthorized = await get('/roles')
    expect(unauthorized.status).toBe(403)
    expect(mocks.listCurrentOrganizationRoles).toHaveBeenCalledTimes(1)
  })

  test('requires an authenticated current organization owner', async () => {
    mocks.findSession.mockResolvedValueOnce(null)
    const unauthenticated = await request('/roles', {
      userId: targetUserId,
      role: 'director',
      reason: 'Needed.',
    })
    expect(unauthenticated.status).toBe(401)
    expect(mocks.hasCurrentOrganizationOwnerAuthority).not.toHaveBeenCalled()

    mocks.hasCurrentOrganizationOwnerAuthority.mockResolvedValueOnce(false)
    const unauthorized = await request('/roles', {
      userId: targetUserId,
      role: 'director',
      reason: 'Needed.',
    })
    expect(unauthorized.status).toBe(403)
    expect(mocks.grantOrganizationRole).not.toHaveBeenCalled()
  })

  test('rejects untrusted origins and roles outside the delegated set', async () => {
    const untrusted = await request(
      '/roles',
      { userId: targetUserId, role: 'director', reason: 'Needed.' },
      'https://attacker.invalid',
    )
    expect(untrusted.status).toBe(403)

    const ownerRole = await request('/roles', {
      userId: targetUserId,
      role: 'organization_owner',
      reason: 'Bypass.',
    })
    expect(ownerRole.status).toBe(400)
    expect(mocks.grantOrganizationRole).not.toHaveBeenCalled()
  })

  test('grants and revokes delegated roles with required reasons', async () => {
    const created = await request('/roles', {
      userId: targetUserId,
      role: 'hr_auditor',
      reason: 'HR coverage duty.',
    })
    expect(created.status).toBe(201)
    expect(await created.json()).toEqual({ grant })
    expect(mocks.grantOrganizationRole).toHaveBeenCalledWith({
      actorUserId,
      targetUserId,
      role: 'hr_auditor',
      reason: 'HR coverage duty.',
    })

    const revoked = await request(`/roles/${grantId}/revoke`, { reason: 'Duty ended.' })
    expect(revoked.status).toBe(200)
    expect(mocks.revokeOrganizationRole).toHaveBeenCalledWith({
      actorUserId,
      grantId,
      reason: 'Duty ended.',
    })
  })

  test('maps current-version store conflicts without leaking unrelated records', async () => {
    mocks.grantOrganizationRole.mockRejectedValueOnce(
      new mocks.RoleMutationError('role-already-granted'),
    )
    const response = await request('/roles', {
      userId: targetUserId,
      role: 'director',
      reason: 'Leadership duty.',
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: 'ORGANIZATION_ROLE_EXISTS',
      message: 'This role is already active.',
    })
  })

  test.each([
    ['owner authority', 'owner-authority-required', 403, 'ORGANIZATION_OWNER_REQUIRED'],
    ['missing target', 'target-not-found', 404, 'USER_NOT_FOUND'],
  ])('maps %s grant failures', async (_name, errorCode, status, responseCode) => {
    mocks.grantOrganizationRole.mockRejectedValueOnce(new mocks.RoleMutationError(errorCode))

    const response = await request('/roles', {
      userId: targetUserId,
      role: 'director',
      reason: 'Leadership duty.',
    })

    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ code: responseCode })
  })

  test('maps a missing role grant during revocation', async () => {
    mocks.revokeOrganizationRole.mockRejectedValueOnce(
      new mocks.RoleMutationError('grant-not-found'),
    )

    const response = await request(`/roles/${grantId}/revoke`, { reason: 'Duty ended.' })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'ROLE_GRANT_NOT_FOUND' })
  })
})

describe('organization group routes', () => {
  test('lists current groups and assignments for organization managers', async () => {
    const response = await get('/groups')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ groups: [] })
    expect(mocks.listCurrentOrganizationGroups).toHaveBeenCalledOnce()
  })

  test('creates permission bundles, groups, and expiring manual assignments', async () => {
    const bundle = await request('/permission-bundles', {
      name: 'Operations',
      permissions: [{ type: 'module', key: 'organization-activity.manage' }],
    })
    expect(bundle.status).toBe(201)
    expect(mocks.createOrganizationPermissionBundle).toHaveBeenCalledWith({
      actorUserId,
      name: 'Operations',
      permissions: [{ type: 'module', key: 'organization-activity.manage' }],
    })

    const group = await request('/groups', {
      name: 'Operations',
      restricted: false,
      managementMode: 'manual',
      complianceSource: null,
      bundleIds: [bundleId],
    })
    expect(group.status).toBe(201)

    const assignment = await request(`/groups/${groupId}/assignments`, {
      userId: targetUserId,
      reason: 'Operations duty.',
      expiresAt: '2026-10-01T12:00:00.000Z',
    })
    expect(assignment.status).toBe(201)
    expect(mocks.assignOrganizationGroup).toHaveBeenCalledWith({
      actorUserId,
      groupId,
      targetUserId,
      reason: 'Operations duty.',
      expiresAt: new Date('2026-10-01T12:00:00.000Z'),
    })

    const revoked = await request(`/groups/${groupId}/assignments/${assignmentId}/revoke`, {
      reason: 'Duty ended.',
    })
    expect(revoked.status).toBe(200)
    expect(mocks.revokeOrganizationGroupAssignment).toHaveBeenCalledWith({
      actorUserId,
      groupId,
      assignmentId,
      reason: 'Duty ended.',
    })
  })

  test('requires owner authority for definitions and maps restricted and compliance refusals', async () => {
    mocks.hasCurrentOrganizationOwnerAuthority.mockResolvedValueOnce(false)
    const unauthorized = await request('/permission-bundles', {
      name: 'Operations',
      permissions: [{ type: 'service', key: 'discord.access' }],
    })
    expect(unauthorized.status).toBe(403)
    expect(mocks.createOrganizationPermissionBundle).not.toHaveBeenCalled()

    mocks.createOrganizationGroup.mockRejectedValueOnce(
      new mocks.GroupMutationError('owner-authority-required'),
    )
    const restricted = await request('/groups', {
      name: 'Leadership',
      restricted: true,
      managementMode: 'manual',
      complianceSource: null,
      bundleIds: [bundleId],
    })
    expect(restricted.status).toBe(403)

    mocks.assignOrganizationGroup.mockRejectedValueOnce(
      new mocks.GroupMutationError('compliance-group-manual-change'),
    )
    const compliance = await request(`/groups/${groupId}/assignments`, {
      userId: targetUserId,
      reason: 'Manual override.',
      expiresAt: null,
    })
    expect(compliance.status).toBe(409)
    expect(await compliance.json()).toMatchObject({ code: 'COMPLIANCE_GROUP_MANAGED' })
  })

  test('validates compliance source invariants before the store executes', async () => {
    const response = await request('/groups', {
      name: 'Compliance',
      restricted: false,
      managementMode: 'compliance',
      complianceSource: null,
      bundleIds: [bundleId],
    })

    expect(response.status).toBe(400)
    expect(mocks.createOrganizationGroup).not.toHaveBeenCalled()
  })

  test.each(['organization-activity.manage', 'discord:operations', 'service-name', 'a'])(
    'accepts linear-time permission key %s',
    async (key) => {
      const response = await request('/permission-bundles', {
        name: 'Operations',
        permissions: [{ type: 'module', key }],
      })

      expect(response.status).toBe(201)
    },
  )

  test.each(['-invalid', 'invalid-', 'invalid..key', 'invalid_key'])(
    'rejects malformed permission key %s',
    async (key) => {
      const response = await request('/permission-bundles', {
        name: 'Operations',
        permissions: [{ type: 'module', key }],
      })

      expect(response.status).toBe(400)
    },
  )

  test.each([
    {
      name: 'manager authority',
      mock: mocks.assignOrganizationGroup,
      errorCode: 'manager-authority-required',
      path: `/groups/${groupId}/assignments`,
      body: { userId: targetUserId, reason: 'Operations duty.', expiresAt: null },
      status: 403,
      responseCode: 'ORGANIZATION_MANAGER_REQUIRED',
    },
    {
      name: 'owner authority',
      mock: mocks.createOrganizationPermissionBundle,
      errorCode: 'owner-authority-required',
      path: '/permission-bundles',
      body: {
        name: 'Operations',
        permissions: [{ type: 'module', key: 'organization-activity.manage' }],
      },
      status: 403,
      responseCode: 'ORGANIZATION_OWNER_REQUIRED',
    },
    {
      name: 'bundle name conflict',
      mock: mocks.createOrganizationPermissionBundle,
      errorCode: 'bundle-name-conflict',
      path: '/permission-bundles',
      body: {
        name: 'Operations',
        permissions: [{ type: 'module', key: 'organization-activity.manage' }],
      },
      status: 409,
      responseCode: 'PERMISSION_BUNDLE_EXISTS',
    },
    {
      name: 'missing bundle',
      mock: mocks.createOrganizationGroup,
      errorCode: 'bundle-not-found',
      path: '/groups',
      body: {
        name: 'Operations',
        restricted: false,
        managementMode: 'manual',
        complianceSource: null,
        bundleIds: [bundleId],
      },
      status: 404,
      responseCode: 'PERMISSION_BUNDLE_NOT_FOUND',
    },
    {
      name: 'group name conflict',
      mock: mocks.createOrganizationGroup,
      errorCode: 'group-name-conflict',
      path: '/groups',
      body: {
        name: 'Operations',
        restricted: false,
        managementMode: 'manual',
        complianceSource: null,
        bundleIds: [bundleId],
      },
      status: 409,
      responseCode: 'ORGANIZATION_GROUP_EXISTS',
    },
    {
      name: 'missing group',
      mock: mocks.assignOrganizationGroup,
      errorCode: 'group-not-found',
      path: `/groups/${groupId}/assignments`,
      body: { userId: targetUserId, reason: 'Operations duty.', expiresAt: null },
      status: 404,
      responseCode: 'ORGANIZATION_GROUP_NOT_FOUND',
    },
    {
      name: 'missing target',
      mock: mocks.assignOrganizationGroup,
      errorCode: 'target-not-found',
      path: `/groups/${groupId}/assignments`,
      body: { userId: targetUserId, reason: 'Operations duty.', expiresAt: null },
      status: 404,
      responseCode: 'USER_NOT_FOUND',
    },
    {
      name: 'compliance source mismatch',
      mock: mocks.createOrganizationGroup,
      errorCode: 'compliance-source-mismatch',
      path: '/groups',
      body: {
        name: 'Compliance',
        restricted: false,
        managementMode: 'compliance',
        complianceSource: 'core.registration',
        bundleIds: [bundleId],
      },
      status: 409,
      responseCode: 'COMPLIANCE_SOURCE_MISMATCH',
    },
    {
      name: 'active assignment',
      mock: mocks.assignOrganizationGroup,
      errorCode: 'assignment-already-active',
      path: `/groups/${groupId}/assignments`,
      body: { userId: targetUserId, reason: 'Operations duty.', expiresAt: null },
      status: 409,
      responseCode: 'GROUP_ASSIGNMENT_EXISTS',
    },
    {
      name: 'missing assignment',
      mock: mocks.revokeOrganizationGroupAssignment,
      errorCode: 'assignment-not-found',
      path: `/groups/${groupId}/assignments/${assignmentId}/revoke`,
      body: { reason: 'Duty ended.' },
      status: 404,
      responseCode: 'GROUP_ASSIGNMENT_NOT_FOUND',
    },
    {
      name: 'invalid assignment expiry',
      mock: mocks.assignOrganizationGroup,
      errorCode: 'invalid-expiry',
      path: `/groups/${groupId}/assignments`,
      body: { userId: targetUserId, reason: 'Operations duty.', expiresAt: null },
      status: 400,
      responseCode: 'INVALID_GROUP_EXPIRY',
    },
  ])(
    'maps $name group-store failures',
    async ({ mock, errorCode, path, body, status, responseCode }) => {
      mock.mockRejectedValueOnce(new mocks.GroupMutationError(errorCode))

      const response = await request(path, body)

      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ code: responseCode })
    },
  )
})

describe('organization member block routes', () => {
  test('lists current member blocks for organization managers', async () => {
    const response = await get('/member-blocks')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ blocks: [] })
    expect(mocks.listCurrentOrganizationMemberBlocks).toHaveBeenCalledOnce()
  })

  test('blocks and unblocks a member through authenticated manager decisions', async () => {
    const blocked = await request(`/members/${targetUserId}/block`, {
      reason: 'Repeated policy abuse.',
    })
    expect(blocked.status).toBe(201)
    expect(mocks.blockOrganizationMember).toHaveBeenCalledWith({
      actorUserId,
      targetUserId,
      reason: 'Repeated policy abuse.',
    })

    const unblocked = await request(`/members/${targetUserId}/unblock`, {
      reason: 'Review completed.',
    })
    expect(unblocked.status).toBe(200)
    expect(mocks.unblockOrganizationMember).toHaveBeenCalledWith({
      actorUserId,
      targetUserId,
      reason: 'Review completed.',
    })
  })

  test('preserves authenticated context while refusing block mutations without manager authority', async () => {
    mocks.hasCurrentOrganizationManagerAuthority.mockResolvedValue(false)

    const context = await get('/context')
    const blocked = await request(`/members/${targetUserId}/block`, { reason: 'Denied.' })

    expect(context.status).toBe(200)
    expect(blocked.status).toBe(403)
    expect(mocks.getOrganizationAccessContext).toHaveBeenCalledWith(actorUserId)
    expect(mocks.blockOrganizationMember).not.toHaveBeenCalled()
  })

  test('requires a reason and maps current-version block conflicts', async () => {
    const invalid = await request(`/members/${targetUserId}/block`, { reason: ' ' })
    expect(invalid.status).toBe(400)
    expect(mocks.blockOrganizationMember).not.toHaveBeenCalled()

    mocks.blockOrganizationMember.mockRejectedValueOnce(
      new mocks.MemberBlockMutationError('block-already-active'),
    )
    const conflict = await request(`/members/${targetUserId}/block`, { reason: 'Duplicate.' })
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ code: 'MEMBER_BLOCK_EXISTS' })

    mocks.blockOrganizationMember.mockRejectedValueOnce(
      new mocks.MemberBlockMutationError('owner-block-not-allowed'),
    )
    const owner = await request(`/members/${targetUserId}/block`, { reason: 'Lockout.' })
    expect(owner.status).toBe(409)
    expect(await owner.json()).toMatchObject({ code: 'ORGANIZATION_OWNER_BLOCK_NOT_ALLOWED' })

    mocks.blockOrganizationMember.mockRejectedValueOnce(
      new mocks.MemberBlockMutationError('self-block-not-allowed'),
    )
    const self = await request(`/members/${actorUserId}/block`, { reason: 'Lockout.' })
    expect(self.status).toBe(409)
    expect(await self.json()).toMatchObject({ code: 'MEMBER_SELF_BLOCK_NOT_ALLOWED' })

    mocks.unblockOrganizationMember.mockRejectedValueOnce(
      new mocks.MemberBlockMutationError('block-not-found'),
    )
    const missing = await request(`/members/${targetUserId}/unblock`, { reason: 'Missing.' })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ code: 'MEMBER_BLOCK_NOT_FOUND' })
  })

  test.each([
    ['manager authority', 'manager-authority-required', 403, 'ORGANIZATION_MANAGER_REQUIRED'],
    ['missing target', 'target-not-found', 404, 'USER_NOT_FOUND'],
  ])('maps %s block-store failures', async (_name, errorCode, status, responseCode) => {
    mocks.blockOrganizationMember.mockRejectedValueOnce(
      new mocks.MemberBlockMutationError(errorCode),
    )

    const response = await request(`/members/${targetUserId}/block`, { reason: 'Reviewed.' })

    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ code: responseCode })
  })
})

describe('organization corporation roster routes', () => {
  test('refuses a deployment-admin session before reading private roster data', async () => {
    const response = await organizationRoutes.request('/roster-coverage', {
      headers: { Cookie: 'eve_space_admin_session=deployment-admin-session' },
    })

    expect(response.status).toBe(401)
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.loadOrganizationSession).not.toHaveBeenCalled()
    expect(mocks.listOrganizationRosterCoverage).not.toHaveBeenCalled()
  })

  test('registers an owned eligible corporation data source', async () => {
    const response = await organizationRoutes.request('/corporations/98000001/source', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'eve_space_session=session-token',
        Origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ characterId: 1_404_328_063 }),
    })

    expect(response.status).toBe(201)
    expect(mocks.registerOrganizationCorporationSource).toHaveBeenCalledWith({
      actorUserId,
      corporationId: 98_000_001,
      characterId: 1_404_328_063,
    })
  })

  test('reports stale source affiliation as a transient conflict', async () => {
    mocks.registerOrganizationCorporationSource.mockRejectedValueOnce(
      new mocks.CorporationSourceMutationError('source-character-affiliation-stale'),
    )

    const response = await organizationRoutes.request('/corporations/98000001/source', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'eve_space_session=session-token',
        Origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ characterId: 1_404_328_063 }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'CORPORATION_SOURCE_AFFILIATION_STALE',
    })
  })

  test.each([
    ['manager authority', 'manager-authority-required', 403, 'ORGANIZATION_MANAGER_REQUIRED'],
    ['missing corporation', 'corporation-not-managed', 404, 'MANAGED_CORPORATION_NOT_FOUND'],
    ['ineligible character', 'source-character-ineligible', 409, 'CORPORATION_SOURCE_INELIGIBLE'],
  ])('maps %s corporation-source failures', async (_name, errorCode, status, responseCode) => {
    mocks.registerOrganizationCorporationSource.mockRejectedValueOnce(
      new mocks.CorporationSourceMutationError(errorCode),
    )

    const response = await mutate('PUT', '/corporations/98000001/source', {
      characterId: 1_404_328_063,
    })

    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ code: responseCode })
  })

  test('refuses roster reads before touching private coverage data without HR authority', async () => {
    mocks.hasCurrentOrganizationHrAuthority.mockResolvedValueOnce(false)

    const response = await get('/roster-coverage')

    expect(response.status).toBe(403)
    expect(mocks.listOrganizationRosterCoverage).not.toHaveBeenCalled()
  })

  test('returns roster coverage to an explicit HR grant', async () => {
    const response = await get('/roster-coverage')

    expect(response.status).toBe(200)
    expect(mocks.listOrganizationRosterCoverage).toHaveBeenCalledOnce()
  })

  test('returns bounded audit history to an explicit HR grant', async () => {
    const response = await get('/audit?limit=25&beforeAuditSequence=90')

    expect(response.status).toBe(200)
    expect(mocks.listCurrentOrganizationAuditHistory).toHaveBeenCalledWith({
      limit: 25,
      beforeAuditSequence: 90n,
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('refuses invalid or unauthorized audit reads before loading history', async () => {
    const invalid = await get('/audit?beforeAuditSequence=not-a-sequence')
    expect(invalid.status).toBe(400)
    expect(mocks.listCurrentOrganizationAuditHistory).not.toHaveBeenCalled()

    mocks.hasCurrentOrganizationHrAuthority.mockResolvedValueOnce(false)
    const unauthorized = await get('/audit')
    expect(unauthorized.status).toBe(403)
    expect(mocks.listCurrentOrganizationAuditHistory).not.toHaveBeenCalled()
  })

  test('rejects audit cursors beyond the PostgreSQL bigint range', async () => {
    const response = await get('/audit?beforeAuditSequence=9223372036854775808')

    expect(response.status).toBe(400)
    expect(mocks.listCurrentOrganizationAuditHistory).not.toHaveBeenCalled()
  })
})

function request(path: string, body: unknown, origin = 'http://localhost:3000') {
  return mutate('POST', path, body, origin)
}

function mutate(
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
  origin = 'http://localhost:3000',
) {
  return organizationRoutes.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'eve_space_session=session-token',
      Origin: origin,
    },
    body: JSON.stringify(body),
  })
}

function get(path: string) {
  return organizationRoutes.request(path, {
    headers: { Cookie: 'eve_space_session=session-token' },
  })
}

function expectPrivateResponsePolicy(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Cookie')
}

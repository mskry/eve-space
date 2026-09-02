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
vi.mock('../../src/auth/store.js', () => ({ findSession: mocks.findSession }))
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
  OrganizationGroupMutationError: mocks.GroupMutationError,
  assignOrganizationGroup: mocks.assignOrganizationGroup,
  createOrganizationGroup: mocks.createOrganizationGroup,
  createOrganizationPermissionBundle: mocks.createOrganizationPermissionBundle,
  hasCurrentOrganizationManagerAuthority: mocks.hasCurrentOrganizationManagerAuthority,
  listCurrentOrganizationGroups: mocks.listCurrentOrganizationGroups,
  revokeOrganizationGroupAssignment: mocks.revokeOrganizationGroupAssignment,
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
  listCurrentOrganizationCharacterExceptions: mocks.listCurrentOrganizationCharacterExceptions,
  revokeOrganizationCharacterException: mocks.revokeOrganizationCharacterException,
}))
vi.mock('../../src/organization/roster-coverage.js', () => ({
  listOrganizationRosterCoverage: mocks.listOrganizationRosterCoverage,
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
    capabilities: { viewRosterCoverage: true },
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
    const listed = await get('/exceptions')
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({ exceptions: [] })

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
})

describe('organization role routes', () => {
  test('returns claim context to authenticated users without requiring owner authority', async () => {
    const response = await get('/context')

    expect(response.status).toBe(200)
    expect(mocks.getOrganizationAccessContext).toHaveBeenCalledWith(actorUserId)
    expect(mocks.hasCurrentOrganizationOwnerAuthority).not.toHaveBeenCalled()
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
})

describe('organization corporation roster routes', () => {
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

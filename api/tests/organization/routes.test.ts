import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { OrganizationSessionContext } from '../../src/organization/access-policy.js'

interface OrganizationSessionFixture {
  context: OrganizationSessionContext
}

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
  class OwnerSourceReplacementError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  class PermissionCatalogError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  const organizationSession: OrganizationSessionFixture = {
    context: {
      accessValidUntil: new Date('2027-09-01T12:00:00.000Z'),
      blocked: false,
      evidenceFreshness: 'fresh' as const,
      organizationVersion: 1,
      reviewDeadline: null,
      state: 'compliant' as const,
    },
  }
  return {
    CharacterExceptionMutationError,
    CorporationSourceMutationError,
    GroupMutationError,
    MemberBlockMutationError,
    OwnerSourceReplacementError,
    PermissionCatalogError,
    RegistrationPolicyMutationError,
    RoleMutationError,
    aggregateOrganizationActivities: vi.fn(),
    approveOrganizationCharacterException: vi.fn(),
    assignOrganizationGroup: vi.fn(),
    blockOrganizationMember: vi.fn(),
    createOrganizationGroup: vi.fn(),
    createOrganizationGroupRule: vi.fn(),
    getOrganizationRuleMemberSummary: vi.fn(),
    listOrganizationRuleAuditPermissions: vi.fn(),
    createOrganizationPermissionBundle: vi.fn(),
    expireOrganizationCharacterException: vi.fn(),
    findSession: vi.fn(),
    getOrganizationAccessContext: vi.fn(),
    getOrganizationAccountComplianceDetails: vi.fn(),
    grantOrganizationRole: vi.fn(),
    hasCurrentOrganizationHrAuthority: vi.fn(),
    hasCurrentOrganizationManagerAuthority: vi.fn(),
    hasCurrentOrganizationOwnerAuthority: vi.fn(),
    listCurrentOrganizationAuditHistory: vi.fn(),
    listCurrentOrganizationCharacterExceptionCandidates: vi.fn(),
    listCurrentOrganizationCharacterExceptions: vi.fn(),
    listCurrentOrganizationGroups: vi.fn(),
    listOrganizationGroupRules: vi.fn(),
    listCurrentOrganizationMemberBlocks: vi.fn(),
    listCurrentOrganizationPermissionBundles: vi.fn(),
    listCurrentOrganizationRoles: vi.fn(),
    listEnabledPermissionCatalog: vi.fn(),
    listOrganizationRosterCoverage: vi.fn(),
    loadCurrentOrganizationAuthorityForUser: vi.fn(),
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
    previewEnabledPermissionProfile: vi.fn(),
    previewOrganizationGroupRule: vi.fn(),
    reviseOrganizationGroupRule: vi.fn(),
    disableOrganizationGroupRule: vi.fn(),
    organizationRuleConditionCatalog: vi.fn(),
    registerOrganizationCorporationSource: vi.fn(),
    replaceOrganizationOwnerSource: vi.fn(),
    revokeOrganizationCharacterException: vi.fn(),
    revokeOrganizationGroupAssignment: vi.fn(),
    revokeOrganizationRole: vi.fn(),
    unblockOrganizationMember: vi.fn(),
    updateOrganizationPermissionBundle: vi.fn(),
    updateOrganizationRegistrationPolicy: vi.fn(),
  }
})

vi.mock('../../src/env.js', () => ({
  env: {
    EVE_CALLBACK_URL: 'http://localhost:8788/auth/eve/callback',
    WEB_ORIGIN: 'http://localhost:3000',
  },
}))
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
  listCurrentOrganizationPermissionBundles: mocks.listCurrentOrganizationPermissionBundles,
  revokeOrganizationGroupAssignment: mocks.revokeOrganizationGroupAssignment,
  updateOrganizationPermissionBundle: mocks.updateOrganizationPermissionBundle,
}))
vi.mock('../../src/organization/group-rule-store.js', () => ({
  createOrganizationGroupRule: mocks.createOrganizationGroupRule,
  disableOrganizationGroupRule: mocks.disableOrganizationGroupRule,
  getOrganizationRuleMemberSummary: mocks.getOrganizationRuleMemberSummary,
  listOrganizationRuleAuditPermissions: mocks.listOrganizationRuleAuditPermissions,
  listOrganizationGroupRules: mocks.listOrganizationGroupRules,
  organizationRuleConditionCatalog: mocks.organizationRuleConditionCatalog,
  previewOrganizationGroupRule: mocks.previewOrganizationGroupRule,
  reviseOrganizationGroupRule: mocks.reviseOrganizationGroupRule,
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
  hasCurrentOrganizationHrAuthority: mocks.hasCurrentOrganizationHrAuthority,
  hasCurrentOrganizationOwnerAuthority: mocks.hasCurrentOrganizationOwnerAuthority,
  listCurrentOrganizationRoles: mocks.listCurrentOrganizationRoles,
  loadCurrentOrganizationAuthorityForUser: mocks.loadCurrentOrganizationAuthorityForUser,
  revokeOrganizationRole: mocks.revokeOrganizationRole,
}))
vi.mock('../../src/organization/owner-source-replacement.js', () => ({
  OrganizationOwnerSourceReplacementError: mocks.OwnerSourceReplacementError,
  replaceOrganizationOwnerSource: mocks.replaceOrganizationOwnerSource,
}))
vi.mock('../../src/organization/policy-store.js', () => ({
  OrganizationRegistrationPolicyMutationError: mocks.RegistrationPolicyMutationError,
  updateOrganizationRegistrationPolicy: mocks.updateOrganizationRegistrationPolicy,
}))
vi.mock('../../src/organization/permission-catalog-store.js', () => ({
  OrganizationPermissionCatalogError: mocks.PermissionCatalogError,
  listEnabledPermissionCatalog: mocks.listEnabledPermissionCatalog,
  previewEnabledPermissionProfile: mocks.previewEnabledPermissionProfile,
}))

import { organizationRoutes } from '../../src/organization/routes.js'

const actorUserId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const targetUserId = '98a782d2-e042-47d7-9659-03b218121a1a'
const grantId = '35acd527-9539-44ad-aacf-9f8e45232267'
const bundleId = '345697a4-df0b-44e7-bf19-f10912c53a27'
const retainedEntryId = 'e7d875d7-21be-4bf2-a92c-c5bc95b8e2bb'
const groupId = '81974469-fdfe-4327-9f87-1df6e23badc4'
const assignmentId = '7643fd73-6350-4307-b7cd-041b74c41ad6'
const blockId = 'bc83840d-47c2-4c76-aed4-94d3e51407f7'
const organizationActivityPermission = {
  key: 'organization-activity.view',
  moduleId: 'organization-activity',
  publisherPackage: '@eve-space/organization-activity-manifest',
  type: 'module' as const,
}
const grant = {
  grantId,
  grantedAt: '2026-08-31T12:00:00.000Z',
  grantedByUserId: actorUserId,
  organizationVersion: 1,
  reason: 'HR coverage duty.',
  revocationReason: null,
  revokedAt: null,
  revokedByUserId: null,
  role: 'hr_auditor',
  userId: targetUserId,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.organizationSession.context = {
    accessValidUntil: new Date('2027-09-01T12:00:00.000Z'),
    blocked: false,
    evidenceFreshness: 'fresh',
    organizationVersion: 1,
    reviewDeadline: null,
    state: 'compliant',
  }
  mocks.findSession.mockResolvedValue({
    mainCharacter: {
      allianceId: null,
      characterId: 1_404_328_063,
      corporationId: 98_000_001,
      isMain: true,
      name: 'Owner',
    },
    userId: actorUserId,
  })
  mocks.hasCurrentOrganizationOwnerAuthority.mockResolvedValue(true)
  mocks.hasCurrentOrganizationManagerAuthority.mockResolvedValue(true)
  mocks.hasCurrentOrganizationHrAuthority.mockResolvedValue(true)
  mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValue({
    degraded: false,
    derivedDirector: false,
    derivedSources: [],
    director: false,
    explicitDirector: false,
    organizationOwner: true,
    ownerSource: {
      characterId: 1_404_328_063,
      sourceId: 'cc83840d-47c2-4c76-aed4-94d3e51407f7',
      state: 'fresh',
    },
  })
  mocks.listCurrentOrganizationGroups.mockResolvedValue({ groups: [] })
  mocks.listOrganizationGroupRules.mockResolvedValue({ organizationVersion: 1, rules: [] })
  mocks.organizationRuleConditionCatalog.mockReturnValue({
    conditions: ['registration-compliant', 'director-audience', 'corporation-role'],
    corporationRoles: [{ predicate: 'accountant', location: 'roles' }],
  })
  mocks.createOrganizationGroupRule.mockResolvedValue({
    groupId,
    organizationVersion: 1,
    revision: 1,
  })
  mocks.reviseOrganizationGroupRule.mockResolvedValue({
    groupId,
    organizationVersion: 1,
    revision: 2,
  })
  mocks.disableOrganizationGroupRule.mockResolvedValue({
    groupId,
    organizationVersion: 1,
    revision: 3,
  })
  mocks.previewOrganizationGroupRule.mockResolvedValue({
    outcome: 'eligible',
    sourceCount: 1,
    sources: [],
    sourcesTruncated: false,
    permissions: [],
  })
  mocks.getOrganizationRuleMemberSummary.mockResolvedValue({
    assignment: null,
    sourceMetadata: [],
    sourcesTruncated: false,
    effectivePermissions: [],
  })
  mocks.listOrganizationRuleAuditPermissions.mockResolvedValue({
    permissions: [],
    nextAfterPermissionId: null,
  })
  mocks.listCurrentOrganizationPermissionBundles.mockResolvedValue({ bundles: [] })
  mocks.listEnabledPermissionCatalog.mockResolvedValue({ permissions: [], profiles: [] })
  mocks.listCurrentOrganizationMemberBlocks.mockResolvedValue({ blocks: [] })
  mocks.getOrganizationAccessContext.mockResolvedValue({
    authorityCharacter: {
      characterId: 1_404_328_063,
      corporationId: 98_000_001,
      freshUntil: '2026-08-31T13:00:00.000Z',
      graceUntil: null,
      lastCheckedAt: '2026-08-31T12:00:00.000Z',
      name: 'Owner',
      observedAt: '2026-08-31T12:00:00.000Z',
      sourceType: 'designated-owner',
    },
    capabilities: { reviewRegistration: true, viewRosterCoverage: true },
    claimAvailable: false,
    freshUntil: '2026-08-31T13:00:00.000Z',
    graceUntil: null,
    isBlocked: false,
    isOrganizationOwner: true,
    organization: {
      organizationId: 98_000_001,
      organizationName: 'Example Corporation',
      organizationTicker: 'EX',
      organizationType: 'corporation',
      organizationVersion: 1,
    },
    ownerFailureClass: null,
    ownerStatus: 'fresh',
    reviewDeadline: null,
  })
  mocks.listCurrentOrganizationRoles.mockResolvedValue({
    corporationSources: [],
    derivedSources: [],
    grants: [grant],
    ownerSources: [],
  })
  mocks.getOrganizationAccountComplianceDetails.mockResolvedValue({
    characters: [],
    evidenceFreshness: 'fresh',
    organizationVersion: 1,
    reviewDeadline: null,
    state: 'compliant',
  })
  mocks.aggregateOrganizationActivities.mockResolvedValue({
    activities: [],
    generatedAt: '2026-09-02T12:00:00.000Z',
    organizationVersion: 1,
    sources: [],
    stale: false,
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
    revocationReason: 'Duty ended.',
    revokedAt: '2026-08-31T13:00:00.000Z',
    revokedByUserId: actorUserId,
  })
  mocks.createOrganizationPermissionBundle.mockResolvedValue({
    bundleId,
    name: 'Operations',
    organizationVersion: 1,
    permissions: [organizationActivityPermission],
  })
  mocks.updateOrganizationPermissionBundle.mockResolvedValue({
    bundleId,
    name: 'Operations',
    organizationVersion: 1,
    permissions: [],
  })
  mocks.createOrganizationGroup.mockResolvedValue({
    bundleIds: [bundleId],
    complianceSource: null,
    groupId,
    managementMode: 'manual',
    name: 'Operations',
    organizationVersion: 1,
    restricted: false,
  })
  const assignment = {
    assignedActorType: 'user',
    assignedAt: '2026-09-01T12:00:00.000Z',
    assignedByUserId: actorUserId,
    assignmentId,
    assignmentSource: 'manual',
    expiresAt: '2026-10-01T12:00:00.000Z',
    groupId,
    organizationVersion: 1,
    reason: 'Operations duty.',
    revocationReason: null,
    revokedActorType: null,
    revokedAt: null,
    revokedByUserId: null,
    userId: targetUserId,
  }
  mocks.assignOrganizationGroup.mockResolvedValue(assignment)
  mocks.revokeOrganizationGroupAssignment.mockResolvedValue({
    ...assignment,
    revocationReason: 'Duty ended.',
    revokedActorType: 'user',
    revokedAt: '2026-09-02T12:00:00.000Z',
    revokedByUserId: actorUserId,
  })
  const block = {
    blockId,
    blockedAt: '2026-09-01T12:00:00.000Z',
    blockedByUserId: actorUserId,
    organizationVersion: 1,
    reason: 'Repeated policy abuse.',
    unblockReason: null,
    unblockedAt: null,
    unblockedByUserId: null,
    userId: targetUserId,
  }
  mocks.blockOrganizationMember.mockResolvedValue(block)
  mocks.unblockOrganizationMember.mockResolvedValue({
    ...block,
    unblockReason: 'Review completed.',
    unblockedAt: '2026-09-02T12:00:00.000Z',
    unblockedByUserId: actorUserId,
  })
  mocks.listOrganizationRosterCoverage.mockResolvedValue({
    corporations: [],
    managedCorporations: {
      attemptedAt: '2026-09-01T12:00:00.000Z',
      lastFailureClass: null,
      status: 'current',
      validatedAt: '2026-09-01T12:00:00.000Z',
    },
    stale: false,
  })
  mocks.registerOrganizationCorporationSource.mockResolvedValue({
    replaced: false,
    source: {
      characterId: 1_404_328_063,
      corporationId: 98_000_001,
      organizationVersion: 1,
      registeredAt: '2026-09-01T12:00:00.000Z',
      registeredByUserId: actorUserId,
      sourceId: 'cc83840d-47c2-4c76-aed4-94d3e51407f7',
    },
  })
  mocks.replaceOrganizationOwnerSource.mockResolvedValue({
    freshUntil: '2026-09-01T13:00:00.000Z',
    grantId,
    sourceCharacterId: 1_404_328_063,
    sourceSubjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
    status: 'fresh',
  })
  mocks.updateOrganizationRegistrationPolicy.mockResolvedValue({
    authorityEvidenceFreshDurationSeconds: 3600,
    derivedDirectorAuthorityEnabled: true,
    organizationVersion: 1,
    policyVersion: 2,
    requiredScopes: ['esi-skills.read_skills.v1'],
    staleEvidenceGraceDurationSeconds: 3600,
    strictRemediationDurationSeconds: 0,
  })
  const exception = {
    approvedAt: new Date('2026-09-01T12:00:00.000Z'),
    approverUserId: actorUserId,
    characterId: 90_000_001,
    exceptionId: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
    expiredAt: null,
    expiresAt: null,
    organizationVersion: 1,
    reason: 'Approved external character.',
    revocationReason: null,
    revokedAt: null,
    revokedByUserId: null,
    userId: targetUserId,
  }
  mocks.approveOrganizationCharacterException.mockResolvedValue(exception)
  mocks.expireOrganizationCharacterException.mockResolvedValue({
    ...exception,
    expiredAt: new Date('2026-09-02T12:00:00.000Z'),
    expiresAt: new Date('2026-09-02T12:00:00.000Z'),
  })
  mocks.revokeOrganizationCharacterException.mockResolvedValue({
    ...exception,
    revocationReason: 'No longer required.',
    revokedAt: new Date('2026-09-02T12:00:00.000Z'),
    revokedByUserId: actorUserId,
  })
})

describe('organization compliance routes', () => {
  test('applies the canonical private response policy to every outcome class', async () => {
    const anonymous = await organizationRoutes.request('/context')
    const success = await get('/context')
    const invalid = await get('/audit?beforeAuditSequence=invalid')
    mocks.hasCurrentOrganizationOwnerAuthority.mockResolvedValueOnce(false)
    const unauthorized = await get('/roles')

    expect([anonymous.status, success.status, invalid.status, unauthorized.status]).toStrictEqual([
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

  test('returns authoritative stale activity metadata at the response root', async () => {
    mocks.aggregateOrganizationActivities.mockResolvedValueOnce({
      activities: [],
      generatedAt: '2026-09-02T12:00:00.000Z',
      organizationVersion: 1,
      sources: [
        {
          sourceId: 'organization-activity:activity',
          moduleId: 'organization-activity',
          providerId: 'activity',
          freshness: { state: 'stale', collectedAt: '2026-09-02T11:40:00.000Z' },
        },
      ],
      stale: true,
      validatedAt: '2026-09-02T11:40:00.000Z',
    })

    const response = await get('/activities')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      stale: true,
      validatedAt: '2026-09-02T11:40:00.000Z',
    })
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
      authorityEvidenceFreshDurationSeconds: 3600,
      derivedDirectorAuthorityEnabled: true,
      reason: 'Require current skills authorization.',
      requiredScopes: ['esi-skills.read_skills.v1'],
      staleEvidenceGraceDurationSeconds: 3600,
      strictRemediationDurationSeconds: 0,
    })

    expect(response.status).toBe(200)
    expect(mocks.updateOrganizationRegistrationPolicy).toHaveBeenCalledWith({
      actorUserId,
      authorityEvidenceFreshDurationSeconds: 3600,
      derivedDirectorAuthorityEnabled: true,
      reason: 'Require current skills authorization.',
      requiredScopes: ['esi-skills.read_skills.v1'],
      staleEvidenceGraceDurationSeconds: 3600,
      strictRemediationDurationSeconds: 0,
    })
  })

  test('allows a suspended verified owner to submit a recovery policy', async () => {
    mocks.organizationSession.context.state = 'suspended'
    mocks.organizationSession.context.accessValidUntil = null

    const response = await mutate('PUT', '/registration-policy', {
      authorityEvidenceFreshDurationSeconds: 3600,
      derivedDirectorAuthorityEnabled: true,
      reason: 'Remove the policy that suspended the owner.',
      requiredScopes: [],
      staleEvidenceGraceDurationSeconds: 3600,
      strictRemediationDurationSeconds: 0,
    })

    expect(response.status).toBe(200)
    expect(mocks.updateOrganizationRegistrationPolicy).toHaveBeenCalledOnce()
  })

  test('still requires verified owner authority for policy recovery', async () => {
    mocks.organizationSession.context.state = 'suspended'
    mocks.organizationSession.context.accessValidUntil = null
    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(null)

    const response = await mutate('PUT', '/registration-policy', {
      authorityEvidenceFreshDurationSeconds: 3600,
      derivedDirectorAuthorityEnabled: true,
      reason: 'Unauthorized recovery attempt.',
      requiredScopes: [],
      staleEvidenceGraceDurationSeconds: 3600,
      strictRemediationDurationSeconds: 0,
    })

    expect(response.status).toBe(403)
    expect(mocks.updateOrganizationRegistrationPolicy).not.toHaveBeenCalled()
  })

  test('maps a policy that would suspend its owner to a conflict', async () => {
    mocks.updateOrganizationRegistrationPolicy.mockRejectedValueOnce(
      new mocks.RegistrationPolicyMutationError('owner-policy-noncompliant'),
    )

    const response = await mutate('PUT', '/registration-policy', {
      authorityEvidenceFreshDurationSeconds: 3600,
      derivedDirectorAuthorityEnabled: true,
      reason: 'Unsafe owner policy.',
      requiredScopes: ['esi-wallet.read_character_wallet.v1'],
      staleEvidenceGraceDurationSeconds: 3600,
      strictRemediationDurationSeconds: 0,
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: 'REGISTRATION_POLICY_OWNER_NONCOMPLIANT',
    })
  })

  test('lists, approves, expires, and revokes external-character exceptions for HR', async () => {
    mocks.listCurrentOrganizationCharacterExceptionCandidates.mockResolvedValueOnce([
      {
        affiliationCheckedAt: new Date('2026-09-08T12:00:00.000Z'),
        characterId: 90_000_001,
        characterName: 'External Pilot',
        evidenceFreshness: 'fresh',
        reasonCode: 'character-outside-managed-organization',
        reviewDeadline: new Date('2026-09-10T12:00:00.000Z'),
        state: 'review_required',
        userId: targetUserId,
      },
    ])
    const listed = await get('/exceptions')
    expect(listed.status).toBe(200)
    expect(await listed.json()).toStrictEqual({
      exceptions: [],
      reviewCandidates: [
        expect.objectContaining({
          characterId: 90_000_001,
          state: 'review_required',
          userId: targetUserId,
        }),
      ],
    })

    const approved = await request(`/members/${targetUserId}/characters/90000001/exception`, {
      expiresAt: null,
      reason: 'Approved external character.',
    })
    expect(approved.status).toBe(201)
    expect(mocks.approveOrganizationCharacterException).toHaveBeenCalledWith({
      actorUserId,
      characterId: 90_000_001,
      expiresAt: null,
      reason: 'Approved external character.',
      userId: targetUserId,
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
      expiresAt: null,
      reason: 'Cannot rely on stale evidence.',
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
      expiresAt: null,
      reason: 'Reviewed external character.',
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
      authorityEvidenceFreshDurationSeconds: 3600,
      derivedDirectorAuthorityEnabled: true,
      reason: 'Reviewed policy update.',
      requiredScopes: [],
      staleEvidenceGraceDurationSeconds: 3600,
      strictRemediationDurationSeconds: 0,
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
    expect(await authorized.json()).toStrictEqual({
      corporationSources: [],
      derivedSources: [],
      grants: [grant],
      ownerSources: [],
    })

    mocks.hasCurrentOrganizationOwnerAuthority.mockResolvedValueOnce(false)
    const unauthorized = await get('/roles')
    expect(unauthorized.status).toBe(403)
    expect(mocks.listCurrentOrganizationRoles).toHaveBeenCalledTimes(1)
  })

  test('requires an authenticated current organization owner', async () => {
    mocks.findSession.mockResolvedValueOnce(null)
    const unauthenticated = await request('/roles', {
      reason: 'Needed.',
      role: 'director',
      userId: targetUserId,
    })
    expect(unauthenticated.status).toBe(401)
    expect(mocks.hasCurrentOrganizationOwnerAuthority).not.toHaveBeenCalled()

    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(null)
    const unauthorized = await request('/roles', {
      reason: 'Needed.',
      role: 'director',
      userId: targetUserId,
    })
    expect(unauthorized.status).toBe(403)
    expect(mocks.grantOrganizationRole).not.toHaveBeenCalled()
  })

  test('rejects untrusted origins and roles outside the delegated set', async () => {
    const untrusted = await request(
      '/roles',
      { reason: 'Needed.', role: 'director', userId: targetUserId },
      'https://attacker.invalid',
    )
    expect(untrusted.status).toBe(403)

    const ownerRole = await request('/roles', {
      reason: 'Bypass.',
      role: 'organization_owner',
      userId: targetUserId,
    })
    expect(ownerRole.status).toBe(400)
    expect(mocks.grantOrganizationRole).not.toHaveBeenCalled()
  })

  test('grants and revokes delegated roles with required reasons', async () => {
    const created = await request('/roles', {
      reason: 'HR coverage duty.',
      role: 'hr_auditor',
      userId: targetUserId,
    })
    expect(created.status).toBe(201)
    expect(await created.json()).toStrictEqual({ grant })
    expect(mocks.grantOrganizationRole).toHaveBeenCalledWith({
      actorUserId,
      reason: 'HR coverage duty.',
      role: 'hr_auditor',
      targetUserId,
    })

    const revoked = await request(`/roles/${grantId}/revoke`, { reason: 'Duty ended.' })
    expect(revoked.status).toBe(200)
    expect(mocks.revokeOrganizationRole).toHaveBeenCalledWith({
      actorUserId,
      grantId,
      reason: 'Duty ended.',
    })
  })

  test.each([
    ['degraded', 'ORGANIZATION_AUTHORITY_DEGRADED'],
    ['invalid', 'ORGANIZATION_AUTHORITY_SOURCE_INVALID'],
  ] as const)(
    'returns a stable %s authority refusal for privilege expansion',
    async (state, code) => {
      mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(
        effectiveOwnerAuthority(state),
      )

      const response = await request('/roles', {
        reason: 'Leadership duty.',
        role: 'director',
        userId: targetUserId,
      })

      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ code })
      expect(mocks.grantOrganizationRole).not.toHaveBeenCalled()
    },
  )

  test('replaces an owner source through the remediation-only mutation', async () => {
    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(
      effectiveOwnerAuthority('degraded'),
    )

    const response = await mutate('PUT', '/owner-source', {
      characterId: 1_404_328_063,
      reason: 'Move authority to a current source.',
    })

    expect(response.status).toBe(200)
    expect(mocks.replaceOrganizationOwnerSource).toHaveBeenCalledWith({
      actorUserId,
      characterId: 1_404_328_063,
      reason: 'Move authority to a current source.',
    })
  })

  test.each([
    ['owner-authority-required', 409, 'ORGANIZATION_OWNER_REPLACEMENT_REQUIRED'],
    ['replacement-not-owned', 404, 'CHARACTER_NOT_FOUND'],
    ['replacement-ineligible', 409, 'ORGANIZATION_AUTHORITY_SOURCE_INVALID'],
    ['replacement-stale', 409, 'ORGANIZATION_AUTHORITY_SOURCE_STALE'],
  ] as const)(
    'maps owner-source replacement failure %s',
    async (errorCode, status, responseCode) => {
      mocks.replaceOrganizationOwnerSource.mockRejectedValueOnce(
        new mocks.OwnerSourceReplacementError(errorCode),
      )

      const response = await mutate('PUT', '/owner-source', {
        characterId: 1_404_328_063,
        reason: 'Move authority to a current source.',
      })

      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ code: responseCode })
    },
  )

  test('maps current-version store conflicts without leaking unrelated records', async () => {
    mocks.grantOrganizationRole.mockRejectedValueOnce(
      new mocks.RoleMutationError('role-already-granted'),
    )
    const response = await request('/roles', {
      reason: 'Leadership duty.',
      role: 'director',
      userId: targetUserId,
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toStrictEqual({
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
      reason: 'Leadership duty.',
      role: 'director',
      userId: targetUserId,
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

describe('unexpected organization mutation failures', () => {
  test.each([
    [
      'role grant',
      mocks.grantOrganizationRole,
      'POST',
      '/roles',
      { reason: 'Leadership duty.', role: 'director', userId: targetUserId },
    ],
    [
      'registration policy',
      mocks.updateOrganizationRegistrationPolicy,
      'PUT',
      '/registration-policy',
      {
        authorityEvidenceFreshDurationSeconds: 3600,
        derivedDirectorAuthorityEnabled: true,
        reason: 'Review current policy.',
        requiredScopes: [],
        staleEvidenceGraceDurationSeconds: 3600,
        strictRemediationDurationSeconds: 0,
      },
    ],
    [
      'owner source replacement',
      mocks.replaceOrganizationOwnerSource,
      'PUT',
      '/owner-source',
      { characterId: 1_404_328_063, reason: 'Move authority to a current source.' },
    ],
  ] as const)(
    'does not translate unexpected %s errors into a domain refusal',
    async (_name, mutation, method, path, body) => {
      mutation.mockRejectedValueOnce(new Error('Unexpected store failure'))

      const response = await mutate(method, path, body)

      expect(response.status).toBe(500)
    },
  )
})

describe('organization rule-managed group routes', () => {
  const condition = { kind: 'corporation-role', predicate: 'accountant' } as const
  const ruleInput = {
    name: 'Accountants',
    bundleIds: [bundleId],
    condition,
    enabled: true,
    reason: 'Reviewed access policy.',
  }

  test('keeps the catalog and rule list behind a current owner session', async () => {
    expect((await organizationRoutes.request('/group-rules')).status).toBe(401)
    expect((await get('/group-rules/conditions')).status).toBe(200)
    expect((await get('/group-rules')).status).toBe(200)
    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(
      effectiveOwnerAuthority('invalid'),
    )
    expect((await get('/group-rules')).status).toBe(409)
    expect(mocks.listOrganizationGroupRules).toHaveBeenCalledOnce()
  })

  test('validates reviewed conditions and trusted owner mutations', async () => {
    const response = await request('/group-rules', ruleInput)
    expect(response.status).toBe(201)
    expect(await response.json()).toStrictEqual({
      rule: { groupId, organizationVersion: 1, revision: 1 },
    })
    expect(mocks.createOrganizationGroupRule).toHaveBeenCalledWith({
      actorUserId,
      ...ruleInput,
    })
    expect(
      (
        await request('/group-rules', {
          ...ruleInput,
          condition: { kind: 'corporation-role', predicate: 'unreviewed' },
        })
      ).status,
    ).toBe(400)
    expect((await request('/group-rules', ruleInput, 'https://wrong.example')).status).toBe(403)
    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(
      effectiveOwnerAuthority('invalid'),
    )
    expect((await request('/group-rules', ruleInput)).status).toBe(409)
    expect(mocks.createOrganizationGroupRule).toHaveBeenCalledOnce()
  })

  test.each(['station-manager', 'project-manager'] as const)(
    'rejects operation-only %s roles before organization-rule persistence',
    async (predicate) => {
      const unsupported = { kind: 'corporation-role', predicate }
      expect((await request('/group-rules', { ...ruleInput, condition: unsupported })).status).toBe(
        400,
      )
      expect(
        (
          await request('/group-rules/preview', {
            bundleIds: [bundleId],
            condition: unsupported,
            targetUserId,
          })
        ).status,
      ).toBe(400)
      expect(
        (
          await mutate('PUT', `/group-rules/${groupId}`, {
            bundleIds: [bundleId],
            condition: unsupported,
            enabled: true,
            expectedRevision: 1,
            reason: 'Review update.',
          })
        ).status,
      ).toBe(400)
      expect(mocks.createOrganizationGroupRule).not.toHaveBeenCalled()
      expect(mocks.reviseOrganizationGroupRule).not.toHaveBeenCalled()
    },
  )

  test('previews without granting and versions rule updates and disablement', async () => {
    const preview = await request('/group-rules/preview', {
      bundleIds: [bundleId],
      condition,
      targetUserId,
    })
    expect(preview.status).toBe(200)
    expect(mocks.previewOrganizationGroupRule).toHaveBeenCalledOnce()
    expect(mocks.createOrganizationGroupRule).not.toHaveBeenCalled()

    const updated = await mutate('PUT', `/group-rules/${groupId}`, {
      bundleIds: [bundleId],
      condition,
      enabled: true,
      expectedRevision: 1,
      reason: 'Review update.',
    })
    expect(updated.status).toBe(200)
    expect(mocks.reviseOrganizationGroupRule).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId,
        expectedRevision: 1,
      }),
    )
    mocks.disableOrganizationGroupRule.mockRejectedValueOnce(
      new mocks.GroupMutationError('rule-revision-conflict'),
    )
    const stale = await request(`/group-rules/${groupId}/disable`, {
      expectedRevision: 1,
      reason: 'Close access.',
    })
    expect(stale.status).toBe(409)
    const disabled = await request(`/group-rules/${groupId}/disable`, {
      expectedRevision: 2,
      reason: 'Close access.',
    })
    expect(disabled.status).toBe(200)
  })

  test('keeps member provenance and paged audit permissions owner-scoped', async () => {
    const member = await get(`/group-rules/${groupId}/members/${targetUserId}`)
    expect(member.status).toBe(200)
    expect(mocks.getOrganizationRuleMemberSummary).toHaveBeenCalledWith({
      actorUserId,
      groupId,
      userId: targetUserId,
    })
    expect((await get(`/group-rules/${groupId}/members/not-a-user`)).status).toBe(400)
    const audit = await get(`/group-rules/audit/${grantId}/permissions`)
    expect(audit.status).toBe(200)
    expect(mocks.listOrganizationRuleAuditPermissions).toHaveBeenCalledWith({
      actorUserId,
      auditId: grantId,
    })
  })

  test('refuses owner attempts to edit rule-managed membership', async () => {
    mocks.assignOrganizationGroup.mockRejectedValueOnce(
      new mocks.GroupMutationError('rule-group-manual-change'),
    )
    const response = await request(`/groups/${groupId}/assignments`, {
      expiresAt: null,
      reason: 'Attempt manual override.',
      userId: targetUserId,
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'RULE_GROUP_MANAGED' })
  })
})

describe('organization group routes', () => {
  test('lists current groups and assignments for organization managers', async () => {
    const response = await get('/groups')

    expect(response.status).toBe(200)
    expect(await response.json()).toStrictEqual({ groups: [] })
    expect(mocks.listCurrentOrganizationGroups).toHaveBeenCalledOnce()
  })

  test('limits permission catalog and retained bundle reads to organization owners', async () => {
    mocks.listEnabledPermissionCatalog.mockResolvedValueOnce({
      permissions: [
        {
          ...organizationActivityPermission,
          audiences: ['member'],
          label: 'View organization activity',
          purpose: 'View member-safe organization activity and participation.',
          reviewAllowed: false,
          sensitivity: 'standard',
        },
      ],
      profiles: [],
    })

    const catalog = await get('/permission-catalog')
    const bundles = await get('/permission-bundles')

    expect(catalog.status).toBe(200)
    expect(await catalog.json()).toMatchObject({
      permissions: [organizationActivityPermission],
      profiles: [],
    })
    expect(bundles.status).toBe(200)
    expect(mocks.listCurrentOrganizationPermissionBundles).toHaveBeenCalledWith(actorUserId)

    mocks.hasCurrentOrganizationOwnerAuthority.mockResolvedValue(false)
    expect((await get('/permission-catalog')).status).toBe(403)
    expect((await get('/permission-bundles')).status).toBe(403)
  })

  test('previews an exact profile without mutating a bundle', async () => {
    mocks.previewEnabledPermissionProfile.mockResolvedValueOnce({
      permissions: [],
      profile: {
        audiences: ['hr'],
        description: 'Reviewer permissions.',
        id: 'reviewer',
        label: 'Reviewer',
        moduleId: 'alpha',
        permissions: ['alpha.view'],
        publisherPackage: '@example/alpha-manifest',
      },
    })

    const response = await request('/permission-profile-preview', {
      moduleId: 'alpha',
      profileId: 'reviewer',
      publisherPackage: '@example/alpha-manifest',
    })

    expect(response.status).toBe(200)
    expect(mocks.previewEnabledPermissionProfile).toHaveBeenCalledWith({
      moduleId: 'alpha',
      profileId: 'reviewer',
      publisherPackage: '@example/alpha-manifest',
    })
    expect(mocks.createOrganizationPermissionBundle).not.toHaveBeenCalled()
    expect(mocks.updateOrganizationPermissionBundle).not.toHaveBeenCalled()
  })

  test('reports an unavailable permission profile without masking unexpected failures', async () => {
    const body = {
      moduleId: 'alpha',
      profileId: 'reviewer',
      publisherPackage: '@example/alpha-manifest',
    }
    mocks.previewEnabledPermissionProfile.mockRejectedValueOnce(
      new mocks.PermissionCatalogError('profile-unavailable'),
    )
    const unavailable = await request('/permission-profile-preview', body)
    expect(unavailable.status).toBe(404)
    expect(await unavailable.json()).toMatchObject({ code: 'PERMISSION_PROFILE_UNAVAILABLE' })

    mocks.previewEnabledPermissionProfile.mockRejectedValueOnce(
      new Error('Unexpected store failure'),
    )
    const unexpected = await request('/permission-profile-preview', body)
    expect(unexpected.status).toBe(500)
  })

  test('keeps adopted bundle keys explicit when a later profile preview changes', async () => {
    const adoptedPermission = {
      key: 'alpha.read',
      moduleId: 'alpha',
      publisherPackage: '@example/alpha-manifest',
      type: 'module' as const,
    }
    mocks.previewEnabledPermissionProfile
      .mockResolvedValueOnce({
        permissions: [],
        profile: {
          audiences: ['hr'],
          description: 'Original reviewer permissions.',
          id: 'reviewer',
          label: 'Reviewer',
          moduleId: 'alpha',
          permissions: ['alpha.read'],
          publisherPackage: '@example/alpha-manifest',
        },
      })
      .mockResolvedValueOnce({
        permissions: [],
        profile: {
          audiences: ['hr'],
          description: 'Changed reviewer permissions.',
          id: 'reviewer',
          label: 'Reviewer',
          moduleId: 'alpha',
          permissions: ['alpha.manage'],
          publisherPackage: '@example/alpha-manifest',
        },
      })
    mocks.createOrganizationPermissionBundle.mockResolvedValueOnce({
      bundleId,
      name: 'Adopted reviewer',
      organizationVersion: 1,
      permissions: [{ ...adoptedPermission, reviewAllowed: false }],
    })
    mocks.listCurrentOrganizationPermissionBundles.mockResolvedValueOnce({
      bundles: [
        {
          bundleId,
          name: 'Adopted reviewer',
          organizationVersion: 1,
          permissions: [{ ...adoptedPermission, reviewAllowed: false, available: true }],
        },
      ],
    })

    await request('/permission-profile-preview', {
      moduleId: 'alpha',
      profileId: 'reviewer',
      publisherPackage: '@example/alpha-manifest',
    })
    const adopted = await request('/permission-bundles', {
      name: 'Adopted reviewer',
      permissions: [adoptedPermission],
      reason: 'Adopt the reviewed exact keys.',
    })
    await request('/permission-profile-preview', {
      moduleId: 'alpha',
      profileId: 'reviewer',
      publisherPackage: '@example/alpha-manifest',
    })
    const retained = await get('/permission-bundles')

    expect(adopted.status).toBe(201)
    expect(mocks.createOrganizationPermissionBundle).toHaveBeenCalledWith({
      actorUserId,
      name: 'Adopted reviewer',
      permissions: [adoptedPermission],
      reason: 'Adopt the reviewed exact keys.',
    })
    expect(await retained.json()).toMatchObject({
      bundles: [{ permissions: [{ key: 'alpha.read' }] }],
    })
    expect(await mocks.previewEnabledPermissionProfile.mock.results[1]!.value).toMatchObject({
      profile: { permissions: ['alpha.manage'] },
    })
  })

  test('rejects caller-forged module review policy', async () => {
    const response = await request('/permission-bundles', {
      name: 'Operations',
      permissions: [{ ...organizationActivityPermission, reviewAllowed: true }],
      reason: 'Create operations access.',
    })

    expect(response.status).toBe(400)
    expect(mocks.createOrganizationPermissionBundle).not.toHaveBeenCalled()
  })

  test('updates a bundle with an empty selection for explicit cleanup', async () => {
    const response = await mutate('PUT', `/permission-bundles/${bundleId}`, {
      name: 'Operations',
      permissions: [],
      reason: 'Remove unavailable permissions.',
      retainedUnavailableEntryIds: [],
    })

    expect(response.status).toBe(200)
    expect(mocks.updateOrganizationPermissionBundle).toHaveBeenCalledWith({
      actorUserId,
      bundleId,
      name: 'Operations',
      permissions: [],
      reason: 'Remove unavailable permissions.',
      retainedUnavailableEntryIds: [],
    })
  })

  test('rejects duplicate retained permission entry IDs before bundle mutation', async () => {
    const response = await mutate('PUT', `/permission-bundles/${bundleId}`, {
      name: 'Operations',
      permissions: [],
      reason: 'Retain unavailable permissions.',
      retainedUnavailableEntryIds: [retainedEntryId, retainedEntryId],
    })

    expect(response.status).toBe(400)
    expect(mocks.updateOrganizationPermissionBundle).not.toHaveBeenCalled()
  })

  test('maps invalid retained entries without disclosing their ownership', async () => {
    mocks.updateOrganizationPermissionBundle.mockRejectedValueOnce(
      new mocks.GroupMutationError('retained-permission-invalid'),
    )

    const response = await mutate('PUT', `/permission-bundles/${bundleId}`, {
      name: 'Operations',
      permissions: [],
      reason: 'Retain unavailable permissions.',
      retainedUnavailableEntryIds: [retainedEntryId],
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toStrictEqual({
      code: 'RETAINED_PERMISSION_INVALID',
      message: 'A retained permission entry is invalid or no longer unavailable.',
    })
  })

  test('maps unavailable current module selections without accepting a typo', async () => {
    mocks.createOrganizationPermissionBundle.mockRejectedValueOnce(
      new mocks.GroupMutationError('permission-unavailable'),
    )

    const response = await request('/permission-bundles', {
      name: 'Operations',
      permissions: [{ ...organizationActivityPermission, key: 'organization-activity.typo' }],
      reason: 'Create operations access.',
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'MODULE_PERMISSION_UNAVAILABLE' })
  })

  test('creates permission bundles, groups, and expiring manual assignments', async () => {
    const bundle = await request('/permission-bundles', {
      name: 'Operations',
      permissions: [organizationActivityPermission],
      reason: 'Create operations access.',
    })
    expect(bundle.status).toBe(201)
    expect(mocks.createOrganizationPermissionBundle).toHaveBeenCalledWith({
      actorUserId,
      name: 'Operations',
      permissions: [organizationActivityPermission],
      reason: 'Create operations access.',
    })

    const group = await request('/groups', {
      bundleIds: [bundleId],
      complianceSource: null,
      managementMode: 'manual',
      name: 'Operations',
      restricted: false,
    })
    expect(group.status).toBe(201)

    const assignment = await request(`/groups/${groupId}/assignments`, {
      expiresAt: '2026-10-01T12:00:00.000Z',
      reason: 'Operations duty.',
      userId: targetUserId,
    })
    expect(assignment.status).toBe(201)
    expect(mocks.assignOrganizationGroup).toHaveBeenCalledWith({
      actorUserId,
      expiresAt: new Date('2026-10-01T12:00:00.000Z'),
      groupId,
      reason: 'Operations duty.',
      targetUserId,
    })

    const revoked = await request(`/groups/${groupId}/assignments/${assignmentId}/revoke`, {
      reason: 'Duty ended.',
    })
    expect(revoked.status).toBe(200)
    expect(mocks.revokeOrganizationGroupAssignment).toHaveBeenCalledWith({
      actorUserId,
      assignmentId,
      groupId,
      reason: 'Duty ended.',
    })
  })

  test('requires owner authority for definitions and maps restricted and compliance refusals', async () => {
    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(null)
    const unauthorized = await request('/permission-bundles', {
      name: 'Operations',
      permissions: [{ type: 'service', key: 'discord.access' }],
      reason: 'Create operations access.',
    })
    expect(unauthorized.status).toBe(403)
    expect(mocks.createOrganizationPermissionBundle).not.toHaveBeenCalled()

    mocks.createOrganizationGroup.mockRejectedValueOnce(
      new mocks.GroupMutationError('owner-authority-required'),
    )
    const restricted = await request('/groups', {
      bundleIds: [bundleId],
      complianceSource: null,
      managementMode: 'manual',
      name: 'Leadership',
      restricted: true,
    })
    expect(restricted.status).toBe(403)

    mocks.assignOrganizationGroup.mockRejectedValueOnce(
      new mocks.GroupMutationError('compliance-group-manual-change'),
    )
    const compliance = await request(`/groups/${groupId}/assignments`, {
      expiresAt: null,
      reason: 'Manual override.',
      userId: targetUserId,
    })
    expect(compliance.status).toBe(409)
    expect(await compliance.json()).toMatchObject({ code: 'COMPLIANCE_GROUP_MANAGED' })
  })

  test('validates compliance source invariants before the store executes', async () => {
    const response = await request('/groups', {
      bundleIds: [bundleId],
      complianceSource: null,
      managementMode: 'compliance',
      name: 'Compliance',
      restricted: false,
    })

    expect(response.status).toBe(400)
    expect(mocks.createOrganizationGroup).not.toHaveBeenCalled()
  })

  test.each(['organization-activity.manage', 'discord:operations', 'service-name', 'a'])(
    'accepts linear-time permission key %s',
    async (key) => {
      const response = await request('/permission-bundles', {
        name: 'Operations',
        permissions: [{ ...organizationActivityPermission, key }],
        reason: 'Create operations access.',
      })

      expect(response.status).toBe(201)
    },
  )

  test.each(['-invalid', 'invalid-', 'invalid..key', 'invalid_key'])(
    'rejects malformed permission key %s',
    async (key) => {
      const response = await request('/permission-bundles', {
        name: 'Operations',
        permissions: [{ ...organizationActivityPermission, key }],
        reason: 'Create operations access.',
      })

      expect(response.status).toBe(400)
    },
  )

  test.each([
    {
      body: { expiresAt: null, reason: 'Operations duty.', userId: targetUserId },
      errorCode: 'manager-authority-required',
      mock: mocks.assignOrganizationGroup,
      name: 'manager authority',
      path: `/groups/${groupId}/assignments`,
      responseCode: 'ORGANIZATION_MANAGER_REQUIRED',
      status: 403,
    },
    {
      body: {
        name: 'Operations',
        permissions: [organizationActivityPermission],
        reason: 'Create operations access.',
      },
      errorCode: 'owner-authority-required',
      mock: mocks.createOrganizationPermissionBundle,
      name: 'owner authority',
      path: '/permission-bundles',
      responseCode: 'ORGANIZATION_OWNER_REQUIRED',
      status: 403,
    },
    {
      body: {
        name: 'Operations',
        permissions: [organizationActivityPermission],
        reason: 'Create operations access.',
      },
      errorCode: 'bundle-name-conflict',
      mock: mocks.createOrganizationPermissionBundle,
      name: 'bundle name conflict',
      path: '/permission-bundles',
      responseCode: 'PERMISSION_BUNDLE_EXISTS',
      status: 409,
    },
    {
      body: {
        bundleIds: [bundleId],
        complianceSource: null,
        managementMode: 'manual',
        name: 'Operations',
        restricted: false,
      },
      errorCode: 'bundle-not-found',
      mock: mocks.createOrganizationGroup,
      name: 'missing bundle',
      path: '/groups',
      responseCode: 'PERMISSION_BUNDLE_NOT_FOUND',
      status: 404,
    },
    {
      body: {
        bundleIds: [bundleId],
        complianceSource: null,
        managementMode: 'manual',
        name: 'Operations',
        restricted: false,
      },
      errorCode: 'group-name-conflict',
      mock: mocks.createOrganizationGroup,
      name: 'group name conflict',
      path: '/groups',
      responseCode: 'ORGANIZATION_GROUP_EXISTS',
      status: 409,
    },
    {
      body: { expiresAt: null, reason: 'Operations duty.', userId: targetUserId },
      errorCode: 'group-not-found',
      mock: mocks.assignOrganizationGroup,
      name: 'missing group',
      path: `/groups/${groupId}/assignments`,
      responseCode: 'ORGANIZATION_GROUP_NOT_FOUND',
      status: 404,
    },
    {
      body: { expiresAt: null, reason: 'Operations duty.', userId: targetUserId },
      errorCode: 'target-not-found',
      mock: mocks.assignOrganizationGroup,
      name: 'missing target',
      path: `/groups/${groupId}/assignments`,
      responseCode: 'USER_NOT_FOUND',
      status: 404,
    },
    {
      body: {
        bundleIds: [bundleId],
        complianceSource: 'core.registration',
        managementMode: 'compliance',
        name: 'Compliance',
        restricted: false,
      },
      errorCode: 'compliance-source-mismatch',
      mock: mocks.createOrganizationGroup,
      name: 'compliance source mismatch',
      path: '/groups',
      responseCode: 'COMPLIANCE_SOURCE_MISMATCH',
      status: 409,
    },
    {
      body: { expiresAt: null, reason: 'Operations duty.', userId: targetUserId },
      errorCode: 'assignment-already-active',
      mock: mocks.assignOrganizationGroup,
      name: 'active assignment',
      path: `/groups/${groupId}/assignments`,
      responseCode: 'GROUP_ASSIGNMENT_EXISTS',
      status: 409,
    },
    {
      body: { reason: 'Duty ended.' },
      errorCode: 'assignment-not-found',
      mock: mocks.revokeOrganizationGroupAssignment,
      name: 'missing assignment',
      path: `/groups/${groupId}/assignments/${assignmentId}/revoke`,
      responseCode: 'GROUP_ASSIGNMENT_NOT_FOUND',
      status: 404,
    },
    {
      body: { expiresAt: null, reason: 'Operations duty.', userId: targetUserId },
      errorCode: 'invalid-expiry',
      mock: mocks.assignOrganizationGroup,
      name: 'invalid assignment expiry',
      path: `/groups/${groupId}/assignments`,
      responseCode: 'INVALID_GROUP_EXPIRY',
      status: 400,
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
    expect(await response.json()).toStrictEqual({ blocks: [] })
    expect(mocks.listCurrentOrganizationMemberBlocks).toHaveBeenCalledOnce()
  })

  test('blocks and unblocks a member through authenticated manager decisions', async () => {
    const blocked = await request(`/members/${targetUserId}/block`, {
      reason: 'Repeated policy abuse.',
    })
    expect(blocked.status).toBe(201)
    expect(mocks.blockOrganizationMember).toHaveBeenCalledWith({
      actorUserId,
      reason: 'Repeated policy abuse.',
      targetUserId,
    })

    const unblocked = await request(`/members/${targetUserId}/unblock`, {
      reason: 'Review completed.',
    })
    expect(unblocked.status).toBe(200)
    expect(mocks.unblockOrganizationMember).toHaveBeenCalledWith({
      actorUserId,
      reason: 'Review completed.',
      targetUserId,
    })
  })

  test('preserves authenticated context while refusing block mutations without manager authority', async () => {
    mocks.hasCurrentOrganizationManagerAuthority.mockResolvedValue(false)
    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValue(null)

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
      body: JSON.stringify({ characterId: 1_404_328_063 }),
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'eve_space_session=session-token',
        Origin: 'http://localhost:3000',
      },
      method: 'PUT',
    })

    expect(response.status).toBe(201)
    expect(mocks.registerOrganizationCorporationSource).toHaveBeenCalledWith({
      actorUserId,
      characterId: 1_404_328_063,
      corporationId: 98_000_001,
    })
  })

  test('reports replacement of an existing corporation data source', async () => {
    mocks.registerOrganizationCorporationSource.mockResolvedValueOnce({
      characterId: 1_404_328_063,
      corporationId: 98_000_001,
      replaced: true,
    })

    const response = await mutate('PUT', '/corporations/98000001/source', {
      characterId: 1_404_328_063,
    })

    expect(response.status).toBe(200)
  })

  test('requires fresh authority before registering or replacing a corporation source', async () => {
    mocks.loadCurrentOrganizationAuthorityForUser.mockResolvedValueOnce(
      effectiveOwnerAuthority('degraded'),
    )

    const response = await mutate('PUT', '/corporations/98000001/source', {
      characterId: 1_404_328_063,
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'ORGANIZATION_AUTHORITY_DEGRADED',
    })
    expect(mocks.registerOrganizationCorporationSource).not.toHaveBeenCalled()
  })

  test('reports stale source affiliation as a transient conflict', async () => {
    mocks.registerOrganizationCorporationSource.mockRejectedValueOnce(
      new mocks.CorporationSourceMutationError('source-character-affiliation-stale'),
    )

    const response = await organizationRoutes.request('/corporations/98000001/source', {
      body: JSON.stringify({ characterId: 1_404_328_063 }),
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'eve_space_session=session-token',
        Origin: 'http://localhost:3000',
      },
      method: 'PUT',
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'CORPORATION_SOURCE_AFFILIATION_STALE',
    })
  })

  test.each([
    ['manager authority', 'manager-authority-required', 403, 'ORGANIZATION_MANAGER_REQUIRED'],
    [
      'degraded manager authority',
      'manager-authority-degraded',
      409,
      'ORGANIZATION_AUTHORITY_DEGRADED',
    ],
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

  test('returns authoritative stale roster metadata at the response root', async () => {
    mocks.listOrganizationRosterCoverage.mockResolvedValueOnce({
      corporations: [],
      managedCorporations: {
        attemptedAt: '2026-09-01T12:00:00.000Z',
        lastFailureClass: 'esi-unavailable',
        status: 'stale',
        validatedAt: '2026-09-01T11:30:00.000Z',
      },
      refreshFailureClass: 'esi-unavailable',
      stale: true,
      validatedAt: '2026-09-01T11:30:00.000Z',
    })

    const response = await get('/roster-coverage')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      refreshFailureClass: 'esi-unavailable',
      stale: true,
      validatedAt: '2026-09-01T11:30:00.000Z',
    })
  })

  test('returns bounded audit history to an explicit HR grant', async () => {
    const response = await get('/audit?limit=25&beforeAuditSequence=90')

    expect(response.status).toBe(200)
    expect(mocks.listCurrentOrganizationAuditHistory).toHaveBeenCalledWith({
      beforeAuditSequence: 90n,
      limit: 25,
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
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'eve_space_session=session-token',
      Origin: origin,
    },
    method,
  })
}

function get(path: string) {
  return organizationRoutes.request(path, {
    headers: { Cookie: 'eve_space_session=session-token' },
  })
}

function effectiveOwnerAuthority(state: 'fresh' | 'degraded' | 'invalid') {
  return {
    degraded: state === 'degraded',
    derivedDirector: false,
    derivedSources: [],
    director: false,
    explicitDirector: false,
    organizationOwner: state !== 'invalid',
    ownerSource: {
      characterId: 1_404_328_063,
      sourceId: 'cc83840d-47c2-4c76-aed4-94d3e51407f7',
      state,
    },
  }
}

function expectPrivateResponsePolicy(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Cookie')
}

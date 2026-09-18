import type {
  PlatformAuthenticatedSessionRouteEnv,
  PlatformOwnedCharacterRouteEnv,
  PlatformReviewerSearchRouteEnv,
  PlatformReviewerTargetContext,
  PlatformReviewerTargetRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { Hono } from 'hono'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorizeOrganizationContribution: vi.fn(),
  authorizeOrganizationReviewerContribution: vi.fn(),
  findOwnedCharacter: vi.fn(),
  findSession: vi.fn(),
  isInstalledModuleContributionEnabled: vi.fn(),
  createPlatformModuleCollectionStatusReads: vi.fn(() => ({ read: vi.fn() })),
  createPlatformOrganizationCommandCapabilities: vi.fn(() => ({ blockMember: vi.fn() })),
  createPlatformReviewerCollectionStatusReads: vi.fn(() => ({ read: vi.fn() })),
  createPlatformReviewerEvidenceReads: vi.fn(() => ({ read: vi.fn() })),
  createPlatformReviewerAccountSearch: vi.fn(() => ({ search: vi.fn() })),
  recordModuleSensitiveAccessDecision: vi.fn(),
  resolveOrganizationReviewerTarget: vi.fn(),
}))

vi.mock('../../src/auth/character-lifecycle.js', () => ({
  findOwnedCharacter: mocks.findOwnedCharacter,
}))
vi.mock('../../src/auth/session-store.js', () => ({
  findSession: mocks.findSession,
}))
vi.mock('../../src/platform/module-settings.js', () => ({
  isInstalledModuleContributionEnabled: mocks.isInstalledModuleContributionEnabled,
}))
vi.mock('../../src/platform/module-collection-status-capabilities.js', () => ({
  createPlatformModuleCollectionStatusReads: mocks.createPlatformModuleCollectionStatusReads,
}))
vi.mock('../../src/platform/module-reviewer-collection-status-capabilities.js', () => ({
  createPlatformReviewerCollectionStatusReads: mocks.createPlatformReviewerCollectionStatusReads,
}))
vi.mock('../../src/platform/module-reviewer-evidence-capabilities.js', () => ({
  createPlatformReviewerEvidenceReads: mocks.createPlatformReviewerEvidenceReads,
}))
vi.mock('../../src/platform/module-sensitive-access-audit.js', () => ({
  recordModuleSensitiveAccessDecision: mocks.recordModuleSensitiveAccessDecision,
}))
vi.mock('../../src/platform/module-organization-command-capabilities.js', () => ({
  createPlatformOrganizationCommandCapabilities:
    mocks.createPlatformOrganizationCommandCapabilities,
}))
vi.mock('../../src/platform/reviewer-search-capabilities.js', () => ({
  createPlatformReviewerAccountSearch: mocks.createPlatformReviewerAccountSearch,
}))
vi.mock('../../src/middleware/organization-session.js', () => ({
  loadOrganizationSession: async (
    context: { set(key: string, value: unknown): void },
    next: () => Promise<void>,
  ) => {
    context.set('organization', organizationContext)
    await next()
  },
}))
vi.mock('../../src/organization/module-authorization.js', () => ({
  authorizeOrganizationContribution: mocks.authorizeOrganizationContribution,
  authorizeOrganizationReviewerContribution: mocks.authorizeOrganizationReviewerContribution,
}))
vi.mock('../../src/organization/reviewer-target.js', () => ({
  resolveOrganizationReviewerTarget: mocks.resolveOrganizationReviewerTarget,
}))

import { platformModuleRouteComposers } from '../../src/platform/module-route-composition.js'

const organizationDeclaration = { audience: 'member', requiredPermission: 'alpha.view' } as const
const reviewerAccountDeclaration = {
  audience: 'hr',
  requiredPermission: 'member-audit.skills.read',
  sectionId: 'skills',
  target: 'managed-organization-account',
  exposure: 'sensitive-evidence',
} as const
const reviewerSearchDeclaration = {
  audience: 'hr',
  requiredPermission: 'member-audit.search',
  additionalRequiredPermissions: ['member-audit.summary.read'],
  target: 'managed-organization-account-search',
  exposure: 'standard',
} as const
const reviewerCharacterDeclaration = {
  ...reviewerAccountDeclaration,
  target: 'managed-organization-character',
} as const
const reviewerEvidenceDeclaration = {
  ...reviewerCharacterDeclaration,
  reviewerEvidence: {
    routeId: 'skills-detail',
    resourceId: 'trained-skills',
    operationId: 'read-skill-evidence',
  },
} as const
const reviewerBlockDeclaration = {
  audience: 'hr',
  requiredPermission: 'member-audit.members.block',
  sectionId: 'access-management',
  target: 'managed-organization-account',
  exposure: 'standard',
  organizationCommands: ['block-member'] as const,
} as const
const targetUserId = '00000000-0000-4000-8000-000000000002'
const reviewerTargetContext = {
  organizationVersion: 7,
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  selection: { kind: 'account' },
  account: {
    userId: targetUserId,
    mainCharacter: { characterId: 90_000_001, name: 'Target Main' },
  },
  characters: [
    {
      characterId: 90_000_001,
      subjectLifecycleId: 'lifecycle-2',
      authorizationGeneration: 3,
      name: 'Target Main',
      isMain: true,
      affiliation: {
        corporationId: 98_000_001,
        allianceId: null,
        membership: 'managed',
        freshness: 'fresh',
        checkedAt: '2026-09-16T12:00:00.000Z',
      },
    },
  ],
  compliance: {
    state: 'compliant',
    evidenceFreshness: 'fresh',
    evidenceAt: '2026-09-16T12:00:00.000Z',
    reviewDeadline: null,
    accessValidUntil: '2026-09-17T12:00:00.000Z',
    evaluatedAt: '2026-09-16T12:00:00.000Z',
  },
  groups: [],
  block: { blocked: false },
} as const satisfies PlatformReviewerTargetContext
const organizationContext = {
  organizationVersion: 7,
  state: 'compliant' as const,
  evidenceFreshness: 'fresh' as const,
  reviewDeadline: null,
  accessValidUntil: new Date(Date.now() + 60_000),
  blocked: false,
}

describe('platform module route composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isInstalledModuleContributionEnabled.mockResolvedValue(true)
    mocks.findSession.mockResolvedValue({
      userId: 'user-1',
      mainCharacter: {
        characterId: 9001,
        name: 'Main',
        corporationId: 98000001,
        allianceId: null,
        isMain: true,
      },
    })
    mocks.findOwnedCharacter.mockResolvedValue({
      characterId: 9001,
      name: 'Main',
      corporationId: 98000001,
      allianceId: null,
      isMain: true,
      subjectLifecycleId: 'lifecycle-1',
    })
    mocks.authorizeOrganizationContribution.mockResolvedValue({
      authorized: true,
      context: {
        organizationVersion: 7,
        audience: 'member',
        requiredPermission: 'alpha.view',
        entitlementScope: 'all',
      },
    })
    mocks.authorizeOrganizationReviewerContribution.mockResolvedValue({
      authorized: true,
      context: {
        organizationVersion: 7,
        audience: 'hr',
        requiredPermission: 'member-audit.skills.read',
        entitlementScope: 'all',
      },
    })
    mocks.resolveOrganizationReviewerTarget.mockResolvedValue(reviewerTargetContext)
  })

  test('exposes only the bounded account-search capability after reviewer authorization', async () => {
    const feature = new Hono<PlatformReviewerSearchRouteEnv>().get('/', (context) => {
      const platform = context.var.platform
      return context.json({
        userId: platform.authorization.userId,
        organizationVersion: platform.organization.organizationVersion,
        hasSearch: typeof platform.reviewerSearch.search === 'function',
      })
    })
    const app = new Hono().route(
      '/alpha/accounts',
      platformModuleRouteComposers['managed-organization-account-search'](
        'alpha',
        reviewerSearchDeclaration,
        feature,
      ),
    )

    const response = await app.request('/alpha/accounts', {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(200)
    expectPrivateResponsePolicy(response)
    await expect(response.json()).resolves.toEqual({
      userId: 'user-1',
      organizationVersion: 7,
      hasSearch: true,
    })
    expect(mocks.createPlatformReviewerAccountSearch).toHaveBeenCalledWith(7)
    expect(mocks.resolveOrganizationReviewerTarget).not.toHaveBeenCalled()
  })

  test('binds only declared organization commands after reviewer target resolution', async () => {
    mocks.authorizeOrganizationReviewerContribution.mockResolvedValue({
      authorized: true,
      context: {
        organizationVersion: 7,
        audience: 'hr',
        requiredPermission: 'member-audit.members.block',
        entitlementScope: 'all',
      },
    })
    const feature = new Hono<PlatformReviewerTargetRouteEnv<readonly ['block-member']>>().post(
      '/',
      (context) =>
        context.json({
          commands: Object.keys(context.var.platform.organizationCommands),
        }),
    )
    const app = new Hono().route(
      '/alpha/accounts/:userId/block',
      platformModuleRouteComposers['managed-organization-account'](
        'alpha',
        reviewerBlockDeclaration,
        feature,
      ),
    )

    const response = await app.request(`/alpha/accounts/${targetUserId}/block`, {
      method: 'POST',
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ commands: ['blockMember'] })
    expect(mocks.createPlatformOrganizationCommandCapabilities).toHaveBeenCalledWith(
      ['block-member'],
      {
        actorUserId: 'user-1',
        organization: expect.objectContaining({
          organizationVersion: 7,
          requiredPermission: 'member-audit.members.block',
        }),
        target: reviewerTargetContext,
      },
    )
    expect(mocks.resolveOrganizationReviewerTarget.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createPlatformOrganizationCommandCapabilities.mock.invocationCallOrder[0]!,
    )
  })

  test('composes authenticated-session context behind enablement and session guards', async () => {
    const feature = new Hono<PlatformAuthenticatedSessionRouteEnv>().get('/', (context) =>
      context.json(context.var.platform.authorization),
    )
    const app = new Hono().route(
      '/alpha',
      platformModuleRouteComposers['authenticated-session'](
        'alpha',
        organizationDeclaration,
        feature,
      ),
    )

    const response = await app.request('/alpha', {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(200)
    expectPrivateResponsePolicy(response)
    await expect(response.json()).resolves.toEqual({
      strategy: 'authenticated-session',
      userId: 'user-1',
    })
  })

  test('composes owned-character validation and ownership context', async () => {
    const feature = new Hono<PlatformOwnedCharacterRouteEnv>().get('/', (context) =>
      context.json(context.var.platform.authorization),
    )
    const app = new Hono().route(
      '/alpha/characters/:characterId',
      platformModuleRouteComposers['owned-character']('alpha', organizationDeclaration, feature),
    )

    const response = await app.request('/alpha/characters/9001', {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(200)
    expectPrivateResponsePolicy(response)
    await expect(response.json()).resolves.toEqual({
      strategy: 'owned-character',
      userId: 'user-1',
      characterId: 9001,
      subjectLifecycleId: 'lifecycle-1',
    })
  })

  test('hides routes for disabled modules before loading a session', async () => {
    mocks.isInstalledModuleContributionEnabled.mockResolvedValue(false)
    const feature = new Hono<PlatformAuthenticatedSessionRouteEnv>().get('/', (context) =>
      context.json(context.var.platform.authorization),
    )
    const app = new Hono().route(
      '/alpha',
      platformModuleRouteComposers['authenticated-session'](
        'alpha',
        organizationDeclaration,
        feature,
      ),
    )

    const response = await app.request('/alpha')

    expect(response.status).toBe(404)
    expectPrivateResponsePolicy(response)
    expect(mocks.findSession).not.toHaveBeenCalled()
  })

  test('retains private response policy when authentication fails', async () => {
    const handler = vi.fn()
    const feature = new Hono<PlatformAuthenticatedSessionRouteEnv>().get('/', (context) => {
      handler()
      return context.json(context.var.platform.authorization)
    })
    const app = new Hono().route(
      '/alpha',
      platformModuleRouteComposers['authenticated-session'](
        'alpha',
        organizationDeclaration,
        feature,
      ),
    )

    const response = await app.request('/alpha')

    expect(response.status).toBe(401)
    expectPrivateResponsePolicy(response)
    expect(handler).not.toHaveBeenCalled()
  })

  test('retains private response policy when owned-character parameters are invalid', async () => {
    const handler = vi.fn()
    const feature = new Hono<PlatformOwnedCharacterRouteEnv>().get('/', (context) => {
      handler()
      return context.json(context.var.platform.authorization)
    })
    const app = new Hono().route(
      '/alpha/characters/:characterId',
      platformModuleRouteComposers['owned-character']('alpha', organizationDeclaration, feature),
    )

    const response = await app.request('/alpha/characters/not-a-character', {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(400)
    expectPrivateResponsePolicy(response)
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  test('refuses organization access before owned-character lookup and module code', async () => {
    mocks.authorizeOrganizationContribution.mockResolvedValue({
      authorized: false,
      reason: 'permission',
    })
    const handler = vi.fn()
    const feature = new Hono<PlatformOwnedCharacterRouteEnv>().get('/', (context) => {
      handler()
      return context.json(context.var.platform.authorization)
    })
    const app = new Hono().route(
      '/alpha/characters/:characterId',
      platformModuleRouteComposers['owned-character']('alpha', organizationDeclaration, feature),
    )

    const response = await app.request('/alpha/characters/9001', {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(403)
    expectPrivateResponsePolicy(response)
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  test('retains private response policy when character ownership fails', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(null)
    const handler = vi.fn()
    const feature = new Hono<PlatformOwnedCharacterRouteEnv>().get('/', (context) => {
      handler()
      return context.json(context.var.platform.authorization)
    })
    const app = new Hono().route(
      '/alpha/characters/:characterId',
      platformModuleRouteComposers['owned-character']('alpha', organizationDeclaration, feature),
    )

    const response = await app.request('/alpha/characters/9002', {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(404)
    expectPrivateResponsePolicy(response)
    expect(handler).not.toHaveBeenCalled()
  })

  test('binds a managed account after reviewer authorization and before private reads', async () => {
    const privateRead = vi.fn()
    const feature = new Hono<PlatformReviewerTargetRouteEnv>().get('/', (context) => {
      privateRead()
      return context.json(context.var.platform.reviewerTarget)
    })
    const app = new Hono().route(
      '/member-audit/accounts/:userId',
      platformModuleRouteComposers['managed-organization-account'](
        'member-audit',
        reviewerAccountDeclaration,
        feature,
      ),
    )

    const response = await app.request(`/member-audit/accounts/${targetUserId}`, {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(200)
    expectPrivateResponsePolicy(response)
    expect(mocks.authorizeOrganizationReviewerContribution).toHaveBeenCalledWith(
      'user-1',
      organizationContext,
      reviewerAccountDeclaration,
    )
    expect(mocks.resolveOrganizationReviewerTarget).toHaveBeenCalledWith({
      organizationVersion: 7,
      targetUserId,
    })
    expect(mocks.createPlatformReviewerCollectionStatusReads).toHaveBeenCalledWith({
      moduleId: 'member-audit',
      sectionId: 'skills',
      target: reviewerTargetContext,
    })
    await expect(response.json()).resolves.toEqual(reviewerTargetContext)
    expect(mocks.createPlatformModuleCollectionStatusReads).not.toHaveBeenCalled()
    expect(privateRead).toHaveBeenCalledOnce()
  })

  test('binds an optional managed target character lifecycle before private reads', async () => {
    mocks.resolveOrganizationReviewerTarget.mockResolvedValue({
      ...reviewerTargetContext,
      selection: {
        kind: 'character',
        characterId: 90_000_001,
        subjectLifecycleId: 'lifecycle-2',
      },
    })
    const privateRead = vi.fn()
    const feature = new Hono<PlatformReviewerTargetRouteEnv>().get('/', (context) => {
      privateRead()
      return context.json(context.var.platform.reviewerTarget.selection)
    })
    const app = new Hono().route(
      '/member-audit/accounts/:userId/characters/:characterId',
      platformModuleRouteComposers['managed-organization-character'](
        'member-audit',
        reviewerCharacterDeclaration,
        feature,
      ),
    )

    const response = await app.request(
      `/member-audit/accounts/${targetUserId}/characters/90000001`,
      { headers: { cookie: 'eve_space_session=session-token' } },
    )

    expect(response.status).toBe(200)
    expect(mocks.resolveOrganizationReviewerTarget).toHaveBeenCalledWith({
      organizationVersion: 7,
      targetUserId,
      characterId: 90_000_001,
    })
    expect(privateRead).toHaveBeenCalledOnce()
  })

  test('records an allowed sensitive evidence request after target resolution', async () => {
    mocks.resolveOrganizationReviewerTarget.mockResolvedValue({
      ...reviewerTargetContext,
      selection: {
        kind: 'character',
        characterId: 90_000_001,
        subjectLifecycleId: 'lifecycle-2',
      },
    })
    const privateRead = vi.fn()
    const feature = new Hono<PlatformReviewerTargetRouteEnv>().get('/', (context) => {
      privateRead()
      return context.json({ available: Boolean(context.var.platform.evidence) })
    })
    const app = new Hono().route(
      '/member-audit/accounts/:userId/characters/:characterId/skills',
      platformModuleRouteComposers['managed-organization-character'](
        'member-audit',
        reviewerEvidenceDeclaration,
        feature,
      ),
    )

    const response = await app.request(
      `/member-audit/accounts/${targetUserId}/characters/90000001/skills`,
      { headers: { cookie: 'eve_space_session=session-token' } },
    )

    expect(response.status).toBe(200)
    expect(mocks.recordModuleSensitiveAccessDecision).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      moduleId: 'member-audit',
      sectionId: 'skills',
      organizationVersion: 7,
      decision: 'allowed',
      reason: 'authorized',
      targetUserId,
      targetCharacterId: 90_000_001,
    })
    expect(mocks.resolveOrganizationReviewerTarget.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordModuleSensitiveAccessDecision.mock.invocationCallOrder[0]!,
    )
    expect(mocks.recordModuleSensitiveAccessDecision.mock.invocationCallOrder[0]).toBeLessThan(
      privateRead.mock.invocationCallOrder[0]!,
    )
  })

  test('records controlled sensitive evidence denials without retaining an unverified target', async () => {
    mocks.authorizeOrganizationReviewerContribution.mockResolvedValue({
      authorized: false,
      reason: 'permission',
    })
    const feature = new Hono<PlatformReviewerTargetRouteEnv>().get('/', (context) =>
      context.json(context.var.platform.reviewerTarget),
    )
    const app = new Hono().route(
      '/member-audit/accounts/:userId/characters/:characterId/skills',
      platformModuleRouteComposers['managed-organization-character'](
        'member-audit',
        reviewerEvidenceDeclaration,
        feature,
      ),
    )

    const response = await app.request(
      `/member-audit/accounts/${targetUserId}/characters/90000001/skills`,
      { headers: { cookie: 'eve_space_session=session-token' } },
    )

    expect(response.status).toBe(403)
    expect(mocks.recordModuleSensitiveAccessDecision).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      moduleId: 'member-audit',
      sectionId: 'skills',
      organizationVersion: 7,
      decision: 'denied',
      reason: 'reviewer-permission-required',
      targetUserId: null,
      targetCharacterId: null,
    })
    expect(mocks.resolveOrganizationReviewerTarget).not.toHaveBeenCalled()
  })

  test('records a sensitive evidence denial when target resolution refuses the subject', async () => {
    mocks.resolveOrganizationReviewerTarget.mockResolvedValue(null)
    const feature = new Hono<PlatformReviewerTargetRouteEnv>().get('/', (context) =>
      context.json(context.var.platform.reviewerTarget),
    )
    const app = new Hono().route(
      '/member-audit/accounts/:userId/characters/:characterId/skills',
      platformModuleRouteComposers['managed-organization-character'](
        'member-audit',
        reviewerEvidenceDeclaration,
        feature,
      ),
    )

    const response = await app.request(
      `/member-audit/accounts/${targetUserId}/characters/90000001/skills`,
      { headers: { cookie: 'eve_space_session=session-token' } },
    )

    expect(response.status).toBe(404)
    expect(mocks.recordModuleSensitiveAccessDecision).toHaveBeenCalledWith({
      actorUserId: 'user-1',
      moduleId: 'member-audit',
      sectionId: 'skills',
      organizationVersion: 7,
      decision: 'denied',
      reason: 'target-not-authorized',
      targetUserId: null,
      targetCharacterId: null,
    })
  })

  test('fails a sensitive evidence response closed when audit recording fails', async () => {
    mocks.resolveOrganizationReviewerTarget.mockResolvedValue({
      ...reviewerTargetContext,
      selection: {
        kind: 'character',
        characterId: 90_000_001,
        subjectLifecycleId: 'lifecycle-2',
      },
    })
    mocks.recordModuleSensitiveAccessDecision.mockRejectedValueOnce(new Error('audit unavailable'))
    const privateRead = vi.fn()
    const feature = new Hono<PlatformReviewerTargetRouteEnv>().get('/', (context) => {
      privateRead()
      return context.json(context.var.platform.reviewerTarget.selection)
    })
    const app = new Hono().route(
      '/member-audit/accounts/:userId/characters/:characterId/skills',
      platformModuleRouteComposers['managed-organization-character'](
        'member-audit',
        reviewerEvidenceDeclaration,
        feature,
      ),
    )

    const response = await app.request(
      `/member-audit/accounts/${targetUserId}/characters/90000001/skills`,
      { headers: { cookie: 'eve_space_session=session-token' } },
    )

    expect(response.status).toBe(500)
    expect(privateRead).not.toHaveBeenCalled()
  })

  test('refuses missing reviewer authority before target lookup or private reads', async () => {
    mocks.authorizeOrganizationReviewerContribution.mockResolvedValue({
      authorized: false,
      reason: 'audience',
    })
    const privateRead = vi.fn()
    const feature = new Hono<PlatformReviewerTargetRouteEnv>().get('/', (context) => {
      privateRead()
      return context.json(context.var.platform.organization)
    })
    const app = new Hono().route(
      '/member-audit/accounts/:userId',
      platformModuleRouteComposers['managed-organization-account'](
        'member-audit',
        reviewerAccountDeclaration,
        feature,
      ),
    )

    const response = await app.request(`/member-audit/accounts/${targetUserId}`, {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(403)
    expectPrivateResponsePolicy(response)
    await expect(response.json()).resolves.toMatchObject({ code: 'ORGANIZATION_REVIEWER_REQUIRED' })
    expect(mocks.resolveOrganizationReviewerTarget).not.toHaveBeenCalled()
    expect(privateRead).not.toHaveBeenCalled()
  })

  test('does not treat a deployment administrator cookie as a reviewer session', async () => {
    const privateRead = vi.fn()
    const feature = new Hono<PlatformReviewerTargetRouteEnv>().get('/', (context) => {
      privateRead()
      return context.json(context.var.platform.organization)
    })
    const app = new Hono().route(
      '/member-audit/accounts/:userId',
      platformModuleRouteComposers['managed-organization-account'](
        'member-audit',
        reviewerAccountDeclaration,
        feature,
      ),
    )

    const response = await app.request(`/member-audit/accounts/${targetUserId}`, {
      headers: { cookie: 'eve_space_admin_session=administrator-token' },
    })

    expect(response.status).toBe(401)
    expectPrivateResponsePolicy(response)
    expect(mocks.authorizeOrganizationReviewerContribution).not.toHaveBeenCalled()
    expect(mocks.resolveOrganizationReviewerTarget).not.toHaveBeenCalled()
    expect(privateRead).not.toHaveBeenCalled()
  })

  test('does not combine owner and deployment administrator authority into reviewer access', async () => {
    mocks.authorizeOrganizationReviewerContribution.mockResolvedValue({
      authorized: false,
      reason: 'audience',
    })
    const privateRead = vi.fn()
    const feature = new Hono<PlatformReviewerTargetRouteEnv>().get('/', (context) => {
      privateRead()
      return context.json(context.var.platform.organization)
    })
    const app = new Hono().route(
      '/member-audit/accounts/:userId',
      platformModuleRouteComposers['managed-organization-account'](
        'member-audit',
        reviewerAccountDeclaration,
        feature,
      ),
    )

    const response = await app.request(`/member-audit/accounts/${targetUserId}`, {
      headers: {
        cookie:
          'eve_space_session=organization-owner-token; eve_space_admin_session=administrator-token',
      },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: 'ORGANIZATION_REVIEWER_REQUIRED' })
    expect(mocks.resolveOrganizationReviewerTarget).not.toHaveBeenCalled()
    expect(privateRead).not.toHaveBeenCalled()
  })

  test('keeps a blocked target reviewable without treating it as a blocked reviewer', async () => {
    mocks.resolveOrganizationReviewerTarget.mockResolvedValue({
      ...reviewerTargetContext,
      block: {
        blocked: true,
        reason: 'Access review',
        expiresAt: null,
      },
    })
    const feature = new Hono<PlatformReviewerTargetRouteEnv>().get('/', (context) =>
      context.json(context.var.platform.reviewerTarget.block),
    )
    const app = new Hono().route(
      '/member-audit/accounts/:userId',
      platformModuleRouteComposers['managed-organization-account'](
        'member-audit',
        reviewerAccountDeclaration,
        feature,
      ),
    )

    const response = await app.request(`/member-audit/accounts/${targetUserId}`, {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      blocked: true,
      reason: 'Access review',
      expiresAt: null,
    })
  })

  test('returns one refusal for an unknown or out-of-scope target before private reads', async () => {
    mocks.resolveOrganizationReviewerTarget.mockResolvedValue(null)
    const privateRead = vi.fn()
    const feature = new Hono<PlatformReviewerTargetRouteEnv>().get('/', (context) => {
      privateRead()
      return context.json(context.var.platform.organization)
    })
    const app = new Hono().route(
      '/member-audit/accounts/:userId',
      platformModuleRouteComposers['managed-organization-account'](
        'member-audit',
        reviewerAccountDeclaration,
        feature,
      ),
    )

    const response = await app.request(`/member-audit/accounts/${targetUserId}`, {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(404)
    expectPrivateResponsePolicy(response)
    await expect(response.json()).resolves.toEqual({
      code: 'REVIEW_TARGET_NOT_FOUND',
      message: 'Review target not found.',
    })
    expect(privateRead).not.toHaveBeenCalled()
  })

  test('validates reviewer target parameters before target lookup', async () => {
    const feature = new Hono<PlatformReviewerTargetRouteEnv>().get('/', (context) =>
      context.json(context.var.platform.organization),
    )
    const app = new Hono().route(
      '/member-audit/accounts/:userId/characters/:characterId',
      platformModuleRouteComposers['managed-organization-character'](
        'member-audit',
        reviewerCharacterDeclaration,
        feature,
      ),
    )

    const response = await app.request('/member-audit/accounts/not-an-account/characters/invalid', {
      headers: { cookie: 'eve_space_session=session-token' },
    })

    expect(response.status).toBe(400)
    expectPrivateResponsePolicy(response)
    expect(mocks.resolveOrganizationReviewerTarget).not.toHaveBeenCalled()
  })

  test('checks module and exact section enablement before reviewer authorization', async () => {
    mocks.isInstalledModuleContributionEnabled.mockResolvedValue(false)
    const feature = new Hono<PlatformReviewerTargetRouteEnv>().get('/', (context) =>
      context.json(context.var.platform.organization),
    )
    const app = new Hono().route(
      '/member-audit/accounts/:userId',
      platformModuleRouteComposers['managed-organization-account'](
        'member-audit',
        reviewerAccountDeclaration,
        feature,
      ),
    )

    const response = await app.request(`/member-audit/accounts/${targetUserId}`)

    expect(response.status).toBe(404)
    expect(mocks.isInstalledModuleContributionEnabled).toHaveBeenCalledWith(
      'member-audit',
      'skills',
    )
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.authorizeOrganizationReviewerContribution).not.toHaveBeenCalled()
    expect(mocks.resolveOrganizationReviewerTarget).not.toHaveBeenCalled()
  })
})

function expectPrivateResponsePolicy(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Cookie')
}

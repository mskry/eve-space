import { PlatformModuleHttpError } from '@eve-space/platform-module-server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assignGroup: vi.fn(),
  blockMember: vi.fn(),
  revokeGroup: vi.fn(),
  unblockMember: vi.fn(),
}))

vi.mock('../../src/organization/reviewer-commands.js', () => {
  class OrganizationReviewerCommandError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  return {
    assignOrganizationReviewerOrdinaryGroup: mocks.assignGroup,
    blockOrganizationReviewerMember: mocks.blockMember,
    OrganizationReviewerCommandError,
    revokeOrganizationReviewerOrdinaryGroup: mocks.revokeGroup,
    unblockOrganizationReviewerMember: mocks.unblockMember,
  }
})

import { OrganizationReviewerCommandError } from '../../src/organization/reviewer-commands.js'
import { OrganizationMemberBlockMutationError } from '../../src/organization/block-store.js'
import { OrganizationGroupMutationError } from '../../src/organization/group-mutation-error.js'
import { createPlatformOrganizationCommandCapabilities } from '../../src/platform/module-organization-command-capabilities.js'

const target = {
  organizationVersion: 7,
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  selection: { kind: 'account' as const },
  account: {
    userId: '00000000-0000-4000-8000-000000000002',
    mainCharacter: null,
  },
  characters: [],
  compliance: {
    state: 'compliant' as const,
    evidenceFreshness: 'fresh' as const,
    evidenceAt: null,
    reviewDeadline: null,
    accessValidUntil: null,
    evaluatedAt: null,
  },
  groups: [],
  block: { blocked: false as const },
}

describe('platform organization command capabilities', () => {
  beforeEach(() => vi.clearAllMocks())

  test('exposes only declared named methods and binds protected identities internally', async () => {
    mocks.assignGroup.mockResolvedValue({
      decision: 'assigned',
      organizationVersion: 7,
      targetUserId: target.account.userId,
      groupId: 'group-1',
      assignmentId: 'assignment-1',
      expiresAt: '2026-10-01T12:00:00.000Z',
    })
    const commands = createPlatformOrganizationCommandCapabilities(
      ['assign-ordinary-group'] as const,
      binding('member-audit.groups.manage'),
    )

    await expect(
      commands.assignOrdinaryGroup({
        groupId: 'group-1',
        reason: 'Approved access',
        expiresAt: '2026-10-01T12:00:00.000Z',
      }),
    ).resolves.toEqual({
      decision: 'assigned',
      groupId: 'group-1',
      assignmentId: 'assignment-1',
      expiresAt: '2026-10-01T12:00:00.000Z',
    })
    expect(Object.keys(commands)).toEqual(['assignOrdinaryGroup'])
    expect(Object.isFrozen(commands)).toBe(true)
    expect(mocks.assignGroup).toHaveBeenCalledWith({
      organizationDeploymentId: 1,
      organizationVersion: 7,
      actorUserId: '00000000-0000-4000-8000-000000000001',
      targetUserId: target.account.userId,
      managedMemberLifecycleId: target.managedMemberLifecycleId,
      requiredPermission: 'member-audit.groups.manage',
      groupId: 'group-1',
      reason: 'Approved access',
      expiresAt: new Date('2026-10-01T12:00:00.000Z'),
    })
  })

  test('rejects invalid expiry before invoking core', async () => {
    const commands = createPlatformOrganizationCommandCapabilities(
      ['assign-ordinary-group'] as const,
      binding('member-audit.groups.manage'),
    )

    await expect(
      commands.assignOrdinaryGroup({ groupId: 'group-1', reason: 'Approved', expiresAt: 'never' }),
    ).rejects.toMatchObject({
      status: 422,
      body: { code: 'INVALID_GROUP_EXPIRY' },
    })
    expect(mocks.assignGroup).not.toHaveBeenCalled()
  })

  test('binds the remaining declared commands and preserves their safe results', async () => {
    mocks.revokeGroup.mockResolvedValue({
      decision: 'revoked',
      groupId: 'group-1',
      assignmentId: 'assignment-1',
      revokedAt: '2026-09-18T12:00:00.000Z',
    })
    mocks.unblockMember.mockResolvedValue({
      decision: 'unblocked',
      blockId: 'block-1',
      unblockedAt: '2026-09-18T12:01:00.000Z',
    })

    const groupCommands = createPlatformOrganizationCommandCapabilities(
      ['revoke-ordinary-group'] as const,
      binding('member-audit.groups.manage'),
    )
    const memberCommands = createPlatformOrganizationCommandCapabilities(
      ['unblock-member'] as const,
      binding('member-audit.members.block'),
    )

    await expect(
      groupCommands.revokeOrdinaryGroup({
        groupId: 'group-1',
        assignmentId: 'assignment-1',
        reason: 'Access no longer required',
      }),
    ).resolves.toEqual({
      decision: 'revoked',
      groupId: 'group-1',
      assignmentId: 'assignment-1',
      revokedAt: '2026-09-18T12:00:00.000Z',
    })
    await expect(memberCommands.unblockMember({ reason: 'Review completed' })).resolves.toEqual({
      decision: 'unblocked',
      blockId: 'block-1',
      unblockedAt: '2026-09-18T12:01:00.000Z',
    })
  })

  test('passes an explicit null assignment expiry through unchanged', async () => {
    mocks.assignGroup.mockResolvedValue({
      decision: 'assigned',
      groupId: 'group-1',
      assignmentId: 'assignment-1',
      expiresAt: null,
    })
    const commands = createPlatformOrganizationCommandCapabilities(
      ['assign-ordinary-group'] as const,
      binding('member-audit.groups.manage'),
    )

    await commands.assignOrdinaryGroup({
      groupId: 'group-1',
      reason: 'Permanent access',
      expiresAt: null,
    })

    expect(mocks.assignGroup).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: null }))
  })

  test('snapshots the authorized target before feature code can mutate its context', async () => {
    const mutableTarget = { ...target, account: { ...target.account } }
    mocks.blockMember.mockResolvedValue({
      decision: 'blocked',
      blockId: 'block-1',
      blockedAt: '2026-09-18T12:00:00.000Z',
    })
    const commands = createPlatformOrganizationCommandCapabilities(['block-member'] as const, {
      ...binding('member-audit.members.block'),
      target: mutableTarget,
    })
    mutableTarget.account.userId = '00000000-0000-4000-8000-000000000099'
    mutableTarget.managedMemberLifecycleId = '00000000-0000-4000-8000-000000000099'

    await commands.blockMember({ reason: 'Immediate deny' })

    expect(mocks.blockMember).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserId: target.account.userId,
        managedMemberLifecycleId: target.managedMemberLifecycleId,
      }),
    )
  })

  test('rejects secret-bearing reasons as intentional validation errors', async () => {
    mocks.assignGroup.mockRejectedValue(new OrganizationReviewerCommandError('invalid-reason'))
    const commands = createPlatformOrganizationCommandCapabilities(
      ['assign-ordinary-group'] as const,
      binding('member-audit.groups.manage'),
    )

    await expect(
      commands.assignOrdinaryGroup({ groupId: 'group-1', reason: 'password=hunter2' }),
    ).rejects.toMatchObject({
      status: 422,
      body: { code: 'INVALID_ACTION_REASON' },
    })
    expect(mocks.assignGroup).toHaveBeenCalledOnce()
  })

  test('translates stale bindings without exposing core details', async () => {
    mocks.blockMember.mockRejectedValue(
      new OrganizationReviewerCommandError('reviewer-authority-required'),
    )
    const commands = createPlatformOrganizationCommandCapabilities(
      ['block-member'] as const,
      binding('member-audit.members.block'),
    )

    const error = await commands.blockMember({ reason: 'Immediate deny' }).catch((caught) => caught)
    expect(error).toBeInstanceOf(PlatformModuleHttpError)
    expect(error).toMatchObject({
      status: 403,
      body: {
        code: 'ORGANIZATION_COMMAND_AUTHORITY_REQUIRED',
        message: 'Current organization reviewer authority is required.',
      },
    })
    expect(JSON.stringify(error)).not.toContain(target.account.userId)
  })

  test.each([
    ['assignment-binding-invalid', 404, 'GROUP_ASSIGNMENT_NOT_FOUND'],
    ['restricted-group-not-allowed', 403, 'GROUP_MANAGEMENT_RESTRICTED'],
    ['compliance-group-not-allowed', 403, 'GROUP_MANAGEMENT_RESTRICTED'],
    ['reviewer-permission-group-not-allowed', 403, 'REVIEWER_PERMISSION_GROUP_RESTRICTED'],
    ['self-target-not-allowed', 403, 'REVIEWER_TARGET_RESTRICTED'],
    ['reviewer-target-not-allowed', 403, 'REVIEWER_TARGET_RESTRICTED'],
  ] as const)('translates reviewer command error %s', async (code, status, publicCode) => {
    mocks.assignGroup.mockRejectedValue(new OrganizationReviewerCommandError(code))
    const commands = createPlatformOrganizationCommandCapabilities(
      ['assign-ordinary-group'] as const,
      binding('member-audit.groups.manage'),
    )

    await expect(
      commands.assignOrdinaryGroup({ groupId: 'group-1', reason: 'Reviewed change' }),
    ).rejects.toMatchObject({ status, body: { code: publicCode } })
  })

  test.each([
    ['invalid-expiry', 422, 'INVALID_GROUP_EXPIRY'],
    ['group-not-found', 404, 'ORGANIZATION_GROUP_TARGET_NOT_FOUND'],
    ['assignment-not-found', 404, 'ORGANIZATION_GROUP_TARGET_NOT_FOUND'],
    ['target-not-found', 404, 'ORGANIZATION_GROUP_TARGET_NOT_FOUND'],
    ['assignment-already-active', 409, 'GROUP_ASSIGNMENT_ALREADY_ACTIVE'],
    ['manager-authority-required', 403, 'GROUP_MANAGEMENT_RESTRICTED'],
  ] as const)('translates group mutation error %s', async (code, status, publicCode) => {
    mocks.assignGroup.mockRejectedValue(new OrganizationGroupMutationError(code))
    const commands = createPlatformOrganizationCommandCapabilities(
      ['assign-ordinary-group'] as const,
      binding('member-audit.groups.manage'),
    )

    await expect(
      commands.assignOrdinaryGroup({ groupId: 'group-1', reason: 'Reviewed change' }),
    ).rejects.toMatchObject({ status, body: { code: publicCode } })
  })

  test.each([
    ['target-not-found', 404, 'MEMBER_BLOCK_NOT_FOUND'],
    ['block-not-found', 404, 'MEMBER_BLOCK_NOT_FOUND'],
    ['block-already-active', 409, 'MEMBER_BLOCK_ALREADY_ACTIVE'],
    ['self-block-not-allowed', 403, 'MEMBER_BLOCK_RESTRICTED'],
  ] as const)('translates member block mutation error %s', async (code, status, publicCode) => {
    mocks.blockMember.mockRejectedValue(new OrganizationMemberBlockMutationError(code))
    const commands = createPlatformOrganizationCommandCapabilities(
      ['block-member'] as const,
      binding('member-audit.members.block'),
    )

    await expect(commands.blockMember({ reason: 'Reviewed change' })).rejects.toMatchObject({
      status,
      body: { code: publicCode },
    })
  })

  test('preserves unexpected command failures', async () => {
    const failure = new Error('Database unavailable')
    mocks.blockMember.mockRejectedValue(failure)
    const commands = createPlatformOrganizationCommandCapabilities(
      ['block-member'] as const,
      binding('member-audit.members.block'),
    )

    await expect(commands.blockMember({ reason: 'Reviewed change' })).rejects.toBe(failure)
  })

  test('refuses a command whose route permission does not match', () => {
    expect(() =>
      createPlatformOrganizationCommandCapabilities(
        ['unblock-member'] as const,
        binding('member-audit.groups.manage'),
      ),
    ).toThrow('Organization command requires route permission member-audit.members.block')
  })
})

function binding(requiredPermission: string) {
  return {
    actorUserId: '00000000-0000-4000-8000-000000000001',
    organization: {
      organizationVersion: 7,
      audience: 'hr' as const,
      requiredPermission,
      entitlementScope: 'all' as const,
    },
    target,
  }
}

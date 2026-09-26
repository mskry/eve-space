import type {
  PlatformAssignOrdinaryGroupCapability,
  PlatformAuthorizedOrganizationContext,
  PlatformBlockMemberCapability,
  PlatformOrganizationCommandCapabilities,
  PlatformOrganizationCommandId,
  PlatformRevokeOrdinaryGroupCapability,
  PlatformReviewerTargetContext,
  PlatformUnblockMemberCapability,
} from '@eve-space/platform-module-contract/server'
import { platformModuleError } from '@eve-space/platform-module-server'
import { OrganizationMemberBlockMutationError } from '../organization/block-store.js'
import { OrganizationGroupMutationError } from '../organization/group-mutation-error.js'
import {
  assignOrganizationReviewerOrdinaryGroup,
  blockOrganizationReviewerMember,
  OrganizationReviewerCommandError,
  revokeOrganizationReviewerOrdinaryGroup,
  unblockOrganizationReviewerMember,
} from '../organization/reviewer-commands.js'

interface OrganizationCommandBinding {
  readonly actorUserId: string
  readonly publisherPackage: string
  readonly moduleId: string
  readonly organization: PlatformAuthorizedOrganizationContext
  readonly target: PlatformReviewerTargetContext
}

interface BoundOrganizationCommand {
  readonly actorUserId: string
  readonly publisherPackage: string
  readonly moduleId: string
  readonly organizationVersion: number
  readonly requiredPermission: string
  readonly targetUserId: string
  readonly managedMemberLifecycleId: string
}

type OrganizationCommandCapabilityMethods = PlatformAssignOrdinaryGroupCapability &
  PlatformRevokeOrdinaryGroupCapability &
  PlatformBlockMemberCapability &
  PlatformUnblockMemberCapability

type AvailableOrganizationCommandCapabilities = {
  -readonly [
    Method in keyof OrganizationCommandCapabilityMethods
  ]?: OrganizationCommandCapabilityMethods[Method]
}

export function createPlatformOrganizationCommandCapabilities<
  const CommandIds extends readonly PlatformOrganizationCommandId[],
>(
  commandIds: CommandIds,
  binding: OrganizationCommandBinding,
): PlatformOrganizationCommandCapabilities<CommandIds> {
  const bound = Object.freeze({
    actorUserId: binding.actorUserId,
    managedMemberLifecycleId: binding.target.managedMemberLifecycleId,
    moduleId: binding.moduleId,
    organizationVersion: binding.organization.organizationVersion,
    publisherPackage: binding.publisherPackage,
    requiredPermission: binding.organization.requiredPermission,
    targetUserId: binding.target.account.userId,
  })
  const capabilities: AvailableOrganizationCommandCapabilities = {}
  for (const commandId of commandIds) {
    addCommandCapability(capabilities, commandId, bound)
  }
  return Object.freeze(capabilities) as PlatformOrganizationCommandCapabilities<CommandIds>
}

function addCommandCapability(
  capabilities: AvailableOrganizationCommandCapabilities,
  commandId: PlatformOrganizationCommandId,
  binding: BoundOrganizationCommand,
) {
  if (commandId === 'assign-ordinary-group') {
    capabilities.assignOrdinaryGroup = async (input: {
      groupId: string
      reason: string
      expiresAt?: string | null
    }) => {
      const expiresAt = parseOptionalDate(input.expiresAt)
      const result = await translateCommandError(() =>
        assignOrganizationReviewerOrdinaryGroup({
          ...commandBinding(binding),
          expiresAt,
          groupId: input.groupId,
          reason: input.reason,
        }),
      )
      return {
        assignmentId: result.assignmentId,
        decision: result.decision,
        expiresAt: result.expiresAt,
        groupId: result.groupId,
      }
    }
    return
  }
  if (commandId === 'revoke-ordinary-group') {
    capabilities.revokeOrdinaryGroup = async (input: {
      groupId: string
      assignmentId: string
      reason: string
    }) => {
      const result = await translateCommandError(() =>
        revokeOrganizationReviewerOrdinaryGroup({
          ...commandBinding(binding),
          assignmentId: input.assignmentId,
          groupId: input.groupId,
          reason: input.reason,
        }),
      )
      return {
        assignmentId: result.assignmentId,
        decision: result.decision,
        groupId: result.groupId,
        revokedAt: result.revokedAt!,
      }
    }
    return
  }
  if (commandId === 'block-member') {
    capabilities.blockMember = async (input: { reason: string }) => {
      const result = await translateCommandError(() =>
        blockOrganizationReviewerMember({
          ...commandBinding(binding),
          reason: input.reason,
        }),
      )
      return {
        blockId: result.blockId,
        blockedAt: result.blockedAt,
        decision: result.decision,
      }
    }
    return
  }
  if (commandId !== 'unblock-member') {
    throw new Error(`Unsupported organization command ${commandId}`)
  }
  capabilities.unblockMember = async (input: { reason: string }) => {
    const result = await translateCommandError(() =>
      unblockOrganizationReviewerMember({
        ...commandBinding(binding),
        reason: input.reason,
      }),
    )
    return {
      blockId: result.blockId,
      decision: result.decision,
      unblockedAt: result.unblockedAt!,
    }
  }
}

function commandBinding(binding: BoundOrganizationCommand) {
  return {
    actorUserId: binding.actorUserId,
    managedMemberLifecycleId: binding.managedMemberLifecycleId,
    moduleId: binding.moduleId,
    organizationDeploymentId: 1 as const,
    organizationVersion: binding.organizationVersion,
    publisherPackage: binding.publisherPackage,
    requiredPermission: binding.requiredPermission,
    targetUserId: binding.targetUserId,
  }
}

function parseOptionalDate(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw platformModuleError(422, {
      code: 'INVALID_GROUP_EXPIRY',
      message: 'The group assignment expiry is invalid.',
    })
  }
  return date
}

async function translateCommandError<Result>(operation: () => Promise<Result>) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof OrganizationReviewerCommandError) {
      throw reviewerCommandError(error.code)
    }
    if (error instanceof OrganizationGroupMutationError) {
      throw groupCommandError(error.code)
    }
    if (error instanceof OrganizationMemberBlockMutationError) {
      throw blockCommandError(error.code)
    }
    throw error
  }
}

function reviewerCommandError(code: OrganizationReviewerCommandError['code']) {
  if (code === 'invalid-reason') {
    return platformModuleError(422, {
      code: 'INVALID_ACTION_REASON',
      message: 'A bounded non-secret reason is required.',
    })
  }
  if (code === 'assignment-binding-invalid') {
    return platformModuleError(404, {
      code: 'GROUP_ASSIGNMENT_NOT_FOUND',
      message: 'The current target group assignment was not found.',
    })
  }
  if (
    code === 'restricted-group-not-allowed' ||
    code === 'compliance-group-not-allowed' ||
    code === 'rule-group-not-allowed'
  ) {
    return platformModuleError(403, {
      code: 'GROUP_MANAGEMENT_RESTRICTED',
      message: 'This group can only be managed through the core organization surface.',
    })
  }
  if (code === 'reviewer-permission-group-not-allowed') {
    return platformModuleError(403, {
      code: 'REVIEWER_PERMISSION_GROUP_RESTRICTED',
      message: 'Reviewer permission groups cannot be changed through this command.',
    })
  }
  if (code === 'self-target-not-allowed' || code === 'reviewer-target-not-allowed') {
    return platformModuleError(403, {
      code: 'REVIEWER_TARGET_RESTRICTED',
      message: 'This reviewer target cannot be changed through this command.',
    })
  }
  return platformModuleError(403, {
    code: 'ORGANIZATION_COMMAND_AUTHORITY_REQUIRED',
    message: 'Current organization reviewer authority is required.',
  })
}

function groupCommandError(code: OrganizationGroupMutationError['code']) {
  if (code === 'invalid-expiry') {
    return platformModuleError(422, {
      code: 'INVALID_GROUP_EXPIRY',
      message: 'The group assignment expiry must be in the future.',
    })
  }
  if (
    code === 'group-not-found' ||
    code === 'assignment-not-found' ||
    code === 'target-not-found'
  ) {
    return platformModuleError(404, {
      code: 'ORGANIZATION_GROUP_TARGET_NOT_FOUND',
      message: 'The requested organization group target was not found.',
    })
  }
  if (code === 'assignment-already-active') {
    return platformModuleError(409, {
      code: 'GROUP_ASSIGNMENT_ALREADY_ACTIVE',
      message: 'The group assignment is already active.',
    })
  }
  return platformModuleError(403, {
    code: 'GROUP_MANAGEMENT_RESTRICTED',
    message: 'This group cannot be changed through this command.',
  })
}

function blockCommandError(code: OrganizationMemberBlockMutationError['code']) {
  if (code === 'target-not-found' || code === 'block-not-found') {
    return platformModuleError(404, {
      code: 'MEMBER_BLOCK_NOT_FOUND',
      message: 'The current target member block was not found.',
    })
  }
  if (code === 'block-already-active') {
    return platformModuleError(409, {
      code: 'MEMBER_BLOCK_ALREADY_ACTIVE',
      message: 'The member block is already active.',
    })
  }
  return platformModuleError(403, {
    code: 'MEMBER_BLOCK_RESTRICTED',
    message: 'This member block change is not permitted.',
  })
}

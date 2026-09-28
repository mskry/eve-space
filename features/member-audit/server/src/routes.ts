import type {
  PlatformModuleRouteCapabilities,
  PlatformReviewerTargetRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  readAssetEvidenceOperation,
  readCurrentObservationOperation,
  readMailEvidenceOperation,
  readTrainedSkillsEvidenceOperation,
  readWalletEvidenceOperation,
} from './persistence.js'

const actionReason = z.string().trim().min(1).max(2000)
const groupParams = z.object({ groupId: z.uuid() })
const groupAssignmentParams = z.object({ assignmentId: z.uuid(), groupId: z.uuid() })
const assignGroupBody = z
  .object({
    expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
    reason: actionReason,
  })
  .strict()
const actionReasonBody = z.object({ reason: actionReason }).strict()
const blockActionBody = z
  .object({
    reason: actionReason,
    expectedOrganizationVersion: z.number().int().positive(),
    expectedManagedMemberLifecycleId: z.uuid(),
  })
  .strict()
const evidencePreviewLimit = 500

type GroupCommandIds = readonly ['assign-ordinary-group', 'revoke-ordinary-group']
type BlockCommandIds = readonly ['block-member', 'unblock-member']
type MemberAuditRouteCapabilities = Pick<PlatformModuleRouteCapabilities, 'coreData' | 'logger'>
type CharacterOverviewCapabilities = Pick<
  PlatformModuleRouteCapabilities<object, readonly ['public-character-profile']>,
  'coreData' | 'logger'
>
type OperationResult<Operation extends { readonly outputSchema: z.ZodType }> = z.output<
  Operation['outputSchema']
>
type SkillsResources = {
  'trained-skills': OperationResult<typeof readTrainedSkillsEvidenceOperation>['trainedSkills']
}
type AssetsResources = { assets: OperationResult<typeof readAssetEvidenceOperation> }
type WalletResources = {
  'wallet-balance': OperationResult<typeof readWalletEvidenceOperation>['balance']
  'wallet-journal': OperationResult<typeof readWalletEvidenceOperation>['journal']
  'wallet-transactions': OperationResult<typeof readWalletEvidenceOperation>['transactions']
}
type MailResources = {
  'mail-headers': OperationResult<typeof readMailEvidenceOperation>['headers']
  'mail-details': OperationResult<typeof readMailEvidenceOperation>['contents']
}
type ObservationResources = {
  'current-ship': OperationResult<typeof readCurrentObservationOperation>['currentShip']
  'current-location': OperationResult<typeof readCurrentObservationOperation>['currentLocation']
}
type EvidenceRouteBinding<Operation, Resources extends readonly unknown[]> = {
  readonly operation: Operation
  readonly resources: Resources
}

export function memberSummaryRoutes(_capabilities: MemberAuditRouteCapabilities) {
  return new Hono<PlatformReviewerTargetRouteEnv>().get('/', async (context) => {
    const target = context.var.platform.reviewerTarget
    return context.json(
      {
        account: target.account,
        block: target.block,
        characters: target.characters,
        compliance: target.compliance,
        evidence: await context.var.platform.evidenceSummary.read(),
        groups: target.groups,
        managedMemberLifecycleId: target.managedMemberLifecycleId,
        organizationVersion: target.organizationVersion,
      },
      200,
    )
  })
}

export const memberCharacterOverviewRoutes = (capabilities: CharacterOverviewCapabilities) =>
  new Hono<PlatformReviewerTargetRouteEnv>().get('/', async (context) => {
    const target = context.var.platform.reviewerTarget
    const selection = target.selection
    const character =
      selection.kind === 'character'
        ? target.characters.find(({ characterId }) => characterId === selection.characterId)
        : undefined
    if (
      !character ||
      selection.kind !== 'character' ||
      character.subjectLifecycleId !== selection.subjectLifecycleId
    ) {
      return context.json(
        { code: 'REVIEW_TARGET_NOT_FOUND', message: 'Review target not found.' },
        404,
      )
    }
    try {
      const profile = await capabilities.coreData.publicCharacterProfile({
        characterId: character.characterId,
        signal: context.req.raw.signal,
      })
      return context.json(
        {
          account: target.account,
          character,
          managedMemberLifecycleId: target.managedMemberLifecycleId,
          organizationVersion: target.organizationVersion,
          profile,
        },
        200,
      )
    } catch (error) {
      if (context.req.raw.signal.aborted) throw error
      return context.json(
        { code: 'PROFILE_UNAVAILABLE', message: 'Public profile is unavailable.' },
        503,
      )
    }
  })

export const memberCurrentObservationRoutes = (
  _capabilities: MemberAuditRouteCapabilities,
  _binding: EvidenceRouteBinding<
    typeof readCurrentObservationOperation,
    readonly [
      { readonly resourceId: 'current-ship'; readonly field: 'currentShip' },
      { readonly resourceId: 'current-location'; readonly field: 'currentLocation' },
    ]
  >,
) =>
  new Hono<PlatformReviewerTargetRouteEnv<[], ObservationResources>>().get('/', async (context) => {
    const resources = await readReviewerEvidence(context.var.platform)
    return context.json(
      {
        currentShip: resources['current-ship'],
        currentLocation: resources['current-location'],
      },
      200,
    )
  })

export const memberSkillsRoutes = (
  _capabilities: MemberAuditRouteCapabilities,
  _binding: EvidenceRouteBinding<
    typeof readTrainedSkillsEvidenceOperation,
    readonly [{ readonly resourceId: 'trained-skills'; readonly field: 'trainedSkills' }]
  >,
) => {
  return new Hono<PlatformReviewerTargetRouteEnv<[], SkillsResources>>().get(
    '/',
    async (context) => {
      const resources = await readReviewerEvidence(context.var.platform)
      return context.json(
        {
          trainedSkills: resources['trained-skills'],
        },
        200,
      )
    },
  )
}

export const memberAssetsRoutes = (
  _capabilities: MemberAuditRouteCapabilities,
  _binding: EvidenceRouteBinding<
    typeof readAssetEvidenceOperation,
    readonly [{ readonly resourceId: 'assets'; readonly field: null }]
  >,
) => {
  return new Hono<PlatformReviewerTargetRouteEnv<[], AssetsResources>>().get(
    '/',
    async (context) => {
      const resources = await readReviewerEvidence(context.var.platform)
      return context.json(
        {
          assets: resources.assets,
        },
        200,
      )
    },
  )
}

export const memberWalletRoutes = (
  _capabilities: MemberAuditRouteCapabilities,
  _binding: EvidenceRouteBinding<
    typeof readWalletEvidenceOperation,
    readonly [
      { readonly resourceId: 'wallet-balance'; readonly field: 'balance' },
      { readonly resourceId: 'wallet-journal'; readonly field: 'journal' },
      { readonly resourceId: 'wallet-transactions'; readonly field: 'transactions' },
    ]
  >,
) => {
  return new Hono<PlatformReviewerTargetRouteEnv<[], WalletResources>>().get(
    '/',
    async (context) => {
      const resources = await readReviewerEvidence(context.var.platform, evidencePreviewLimit)
      return context.json(
        {
          balance: resources['wallet-balance'],
          journal: resources['wallet-journal'],
          previewLimit: evidencePreviewLimit,
          transactions: resources['wallet-transactions'],
        },
        200,
      )
    },
  )
}

export const memberMailRoutes = (
  _capabilities: MemberAuditRouteCapabilities,
  _binding: EvidenceRouteBinding<
    typeof readMailEvidenceOperation,
    readonly [
      { readonly resourceId: 'mail-headers'; readonly field: 'headers' },
      { readonly resourceId: 'mail-details'; readonly field: 'contents' },
    ]
  >,
) => {
  return new Hono<PlatformReviewerTargetRouteEnv<[], MailResources>>().get('/', async (context) => {
    const resources = await readReviewerEvidence(context.var.platform, evidencePreviewLimit)
    return context.json(
      {
        details: resources['mail-details'],
        headers: resources['mail-headers'],
        previewLimit: evidencePreviewLimit,
      },
      200,
    )
  })
}

export function memberGroupRoutes(_capabilities: MemberAuditRouteCapabilities) {
  return new Hono<PlatformReviewerTargetRouteEnv<GroupCommandIds>>()
    .get('/', (context) =>
      context.json({ groups: context.var.platform.reviewerTarget.groups }, 200),
    )
    .post(
      '/:groupId',
      zValidator('param', groupParams),
      zValidator('json', assignGroupBody),
      async (context) =>
        context.json(
          await context.var.platform.organizationCommands.assignOrdinaryGroup({
            groupId: context.req.valid('param').groupId,
            ...context.req.valid('json'),
          }),
          201,
        ),
    )
    .delete(
      '/:groupId/assignments/:assignmentId',
      zValidator('param', groupAssignmentParams),
      zValidator('json', actionReasonBody),
      async (context) => {
        const params = context.req.valid('param')
        return context.json(
          await context.var.platform.organizationCommands.revokeOrdinaryGroup({
            assignmentId: params.assignmentId,
            groupId: params.groupId,
            reason: context.req.valid('json').reason,
          }),
          200,
        )
      },
    )
}

export function memberBlockRoutes(_capabilities: MemberAuditRouteCapabilities) {
  return new Hono<PlatformReviewerTargetRouteEnv<BlockCommandIds>>()
    .get('/', (context) => context.json({ block: context.var.platform.reviewerTarget.block }, 200))
    .post('/', zValidator('json', blockActionBody), async (context) =>
      context.json(
        await context.var.platform.organizationCommands.blockMember(context.req.valid('json')),
        201,
      ),
    )
    .delete('/', zValidator('json', blockActionBody), async (context) =>
      context.json(
        await context.var.platform.organizationCommands.unblockMember(context.req.valid('json')),
        200,
      ),
    )
}

const readReviewerEvidence = <Resources extends object>(
  platform: PlatformReviewerTargetRouteEnv<[], Resources>['Variables']['platform'],
  limit?: number,
) => {
  if (!platform.evidence) {
    throw new Error('Reviewer evidence capability is unavailable')
  }
  return platform.evidence.read(limit === undefined ? undefined : { limit })
}

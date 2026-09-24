import type { PlatformReviewerTargetRouteEnv } from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'
import type {
  MemberAuditAssetEvidence,
  MemberAuditMailEvidence,
  MemberAuditTrainedSkillsEvidence,
  MemberAuditWalletEvidence,
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

type GroupCommandIds = readonly ['assign-ordinary-group', 'revoke-ordinary-group']
type BlockCommandIds = readonly ['block-member', 'unblock-member']

export function memberSummaryRoutes(_capabilities: object) {
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

export function memberSkillsRoutes(_capabilities: object) {
  return new Hono<PlatformReviewerTargetRouteEnv>().get('/', async (context) => {
    const characterId = selectedCharacterId(context.var.platform.reviewerTarget)
    const trainedSkills = await context.var.platform.collectionStatus.read(
      'trained-skills',
      characterId,
    )
    return context.json(
      {
        evidence: await readReviewerEvidence<MemberAuditTrainedSkillsEvidence>(
          context.var.platform,
        ),
        trainedSkills,
      },
      200,
    )
  })
}

export function memberAssetsRoutes(_capabilities: object) {
  return new Hono<PlatformReviewerTargetRouteEnv>().get('/', async (context) => {
    const characterId = selectedCharacterId(context.var.platform.reviewerTarget)
    const status = await context.var.platform.collectionStatus.read('assets', characterId)
    return context.json(
      {
        evidence: await readReviewerEvidence<MemberAuditAssetEvidence>(context.var.platform),
        status,
      },
      200,
    )
  })
}

export function memberWalletRoutes(_capabilities: object) {
  return new Hono<PlatformReviewerTargetRouteEnv>().get('/', async (context) => {
    const characterId = selectedCharacterId(context.var.platform.reviewerTarget)
    const [balance, journal, transactions] = await Promise.all([
      context.var.platform.collectionStatus.read('wallet-balance', characterId),
      context.var.platform.collectionStatus.read('wallet-journal', characterId),
      context.var.platform.collectionStatus.read('wallet-transactions', characterId),
    ])
    return context.json(
      {
        balance,
        evidence: await readReviewerEvidence<MemberAuditWalletEvidence>(context.var.platform, 500),
        journal,
        transactions,
      },
      200,
    )
  })
}

export function memberMailRoutes(_capabilities: object) {
  return new Hono<PlatformReviewerTargetRouteEnv>().get('/', async (context) => {
    const characterId = selectedCharacterId(context.var.platform.reviewerTarget)
    const [headers, details] = await Promise.all([
      context.var.platform.collectionStatus.read('mail-headers', characterId),
      context.var.platform.collectionStatus.read('mail-details', characterId),
    ])
    return context.json(
      {
        details,
        evidence: await readReviewerEvidence<MemberAuditMailEvidence>(context.var.platform, 500),
        headers,
      },
      200,
    )
  })
}

export function memberGroupRoutes(_capabilities: object) {
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

export function memberBlockRoutes(_capabilities: object) {
  return new Hono<PlatformReviewerTargetRouteEnv<BlockCommandIds>>()
    .get('/', (context) => context.json({ block: context.var.platform.reviewerTarget.block }, 200))
    .post('/', zValidator('json', actionReasonBody), async (context) =>
      context.json(
        await context.var.platform.organizationCommands.blockMember(context.req.valid('json')),
        201,
      ),
    )
    .delete('/', zValidator('json', actionReasonBody), async (context) =>
      context.json(
        await context.var.platform.organizationCommands.unblockMember(context.req.valid('json')),
        200,
      ),
    )
}

function selectedCharacterId(
  target: PlatformReviewerTargetRouteEnv['Variables']['platform']['reviewerTarget'],
) {
  if (target.selection.kind !== 'character') {
    throw new Error('Member Audit character target is unavailable')
  }
  return target.selection.characterId
}

function readReviewerEvidence<Evidence>(
  platform: PlatformReviewerTargetRouteEnv['Variables']['platform'],
  limit?: number,
): Promise<Evidence> {
  if (!platform.evidence) {
    throw new Error('Reviewer evidence capability is unavailable')
  }
  return platform.evidence.read(limit === undefined ? undefined : { limit }) as Promise<Evidence>
}

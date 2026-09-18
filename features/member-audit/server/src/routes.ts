import {
  isPlatformReviewerAccountSearchCursor,
  isPlatformReviewerAccountSearchQuery,
  type PlatformReviewerSearchRouteEnv,
  type PlatformReviewerTargetRouteEnv,
} from '@eve-space/platform-module-contract/server'
import { zValidator } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'

const searchQuery = z.object({
  query: z.string().trim().refine(isPlatformReviewerAccountSearchQuery).optional(),
  corporationId: z.coerce.number().int().positive().optional(),
  complianceState: z.enum(['pending', 'compliant', 'review_required', 'suspended']).optional(),
  blocked: z.stringbool().optional(),
  cursor: z.string().refine(isPlatformReviewerAccountSearchCursor).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
})

export function memberSearchRoutes(_capabilities: object) {
  return new Hono<PlatformReviewerSearchRouteEnv>().get(
    '/',
    zValidator('query', searchQuery),
    async (context) =>
      context.json(
        await context.var.platform.reviewerSearch.search(context.req.valid('query')),
        200,
      ),
  )
}

export function memberSummaryRoutes(_capabilities: object) {
  return new Hono<PlatformReviewerTargetRouteEnv>().get('/', async (context) => {
    const target = context.var.platform.reviewerTarget
    return context.json(
      {
        organizationVersion: target.organizationVersion,
        managedMemberLifecycleId: target.managedMemberLifecycleId,
        account: target.account,
        characters: target.characters,
        compliance: target.compliance,
        groups: target.groups,
        block: target.block,
      },
      200,
    )
  })
}

export function memberSkillsRoutes(_capabilities: object) {
  return new Hono<PlatformReviewerTargetRouteEnv>().get('/', async (context) => {
    const characterId = selectedCharacterId(context.var.platform.reviewerTarget)
    const [trainedSkills, skillQueue] = await Promise.all([
      context.var.platform.collectionStatus.read('trained-skills', characterId),
      context.var.platform.collectionStatus.read('skill-queue', characterId),
    ])
    return context.json({
      trainedSkills,
      skillQueue,
      evidence: await readReviewerEvidence(context.var.platform),
    })
  })
}

export function memberAssetsRoutes(_capabilities: object) {
  return new Hono<PlatformReviewerTargetRouteEnv>().get('/', async (context) => {
    const characterId = selectedCharacterId(context.var.platform.reviewerTarget)
    const status = await context.var.platform.collectionStatus.read('assets', characterId)
    return context.json({
      status,
      evidence: await readReviewerEvidence(context.var.platform),
    })
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
    return context.json({
      balance,
      journal,
      transactions,
      evidence: await readReviewerEvidence(context.var.platform, 500),
    })
  })
}

export function memberMailRoutes(_capabilities: object) {
  return new Hono<PlatformReviewerTargetRouteEnv>().get('/', async (context) => {
    const characterId = selectedCharacterId(context.var.platform.reviewerTarget)
    const [headers, details] = await Promise.all([
      context.var.platform.collectionStatus.read('mail-headers', characterId),
      context.var.platform.collectionStatus.read('mail-details', characterId),
    ])
    return context.json({
      headers,
      details,
      evidence: await readReviewerEvidence(context.var.platform, 500),
    })
  })
}

function selectedCharacterId(
  target: PlatformReviewerTargetRouteEnv['Variables']['platform']['reviewerTarget'],
) {
  if (target.selection.kind !== 'character')
    throw new Error('Member Audit character target is unavailable')
  return target.selection.characterId
}

function readReviewerEvidence(
  platform: PlatformReviewerTargetRouteEnv['Variables']['platform'],
  limit?: number,
) {
  if (!platform.evidence) throw new Error('Reviewer evidence capability is unavailable')
  return platform.evidence.read(limit === undefined ? undefined : { limit })
}

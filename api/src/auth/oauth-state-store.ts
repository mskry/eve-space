import { and, eq, gt, lte } from 'drizzle-orm'
import { db } from '../db/client.js'
import { oauthStates } from '../db/schema.js'
import {
  parseReviewerUseDisclosures,
  type ReviewerUseDisclosure,
} from '../reviewer-use-disclosure.js'
import { hashToken } from './security.js'

const oauthStateTtlMs = 10 * 60 * 1_000

export type OAuthStateIntentContext =
  | { intent: 'login'; returnPath?: string }
  | { intent: 'attach'; userId: string }
  | { intent: 'reauthorize'; userId: string; characterId: number; returnPath?: string }
  | {
      intent: 'claim-organization-owner'
      userId: string
      characterId: number
      organizationId: number
      organizationVersion: number
    }
  | {
      intent: 'transfer'
      approvalId: string
      sourceUserId: string
      sourceSubjectLifecycleId: string
      userId: string
      characterId: number
    }

export type OAuthStateContext = OAuthStateIntentContext & {
  readonly reviewerUseDisclosures: readonly ReviewerUseDisclosure[]
}

export async function storeOAuthState(state: string, context: OAuthStateContext) {
  const reviewerUseDisclosures = parseReviewerUseDisclosures(context.reviewerUseDisclosures)
  await db.delete(oauthStates).where(lte(oauthStates.expiresAt, new Date()))
  await db.insert(oauthStates).values({
    stateHash: hashToken(state),
    intent: context.intent,
    userId: context.intent === 'login' ? null : context.userId,
    characterId:
      context.intent === 'reauthorize' ||
      context.intent === 'claim-organization-owner' ||
      context.intent === 'transfer'
        ? context.characterId
        : null,
    returnPath:
      context.intent === 'login' || context.intent === 'reauthorize'
        ? (context.returnPath ?? null)
        : null,
    organizationDeploymentId: context.intent === 'claim-organization-owner' ? 1 : null,
    organizationId: context.intent === 'claim-organization-owner' ? context.organizationId : null,
    organizationVersion:
      context.intent === 'claim-organization-owner' ? context.organizationVersion : null,
    transferApprovalId: context.intent === 'transfer' ? context.approvalId : null,
    transferSourceUserId: context.intent === 'transfer' ? context.sourceUserId : null,
    transferSourceSubjectLifecycleId:
      context.intent === 'transfer' ? context.sourceSubjectLifecycleId : null,
    reviewerUseDisclosures,
    expiresAt: new Date(Date.now() + oauthStateTtlMs),
  })
}

export async function consumeOAuthState(state: string): Promise<OAuthStateContext | null> {
  const [record] = await db
    .delete(oauthStates)
    .where(and(eq(oauthStates.stateHash, hashToken(state)), gt(oauthStates.expiresAt, new Date())))
    .returning({
      intent: oauthStates.intent,
      userId: oauthStates.userId,
      characterId: oauthStates.characterId,
      returnPath: oauthStates.returnPath,
      organizationId: oauthStates.organizationId,
      organizationVersion: oauthStates.organizationVersion,
      transferApprovalId: oauthStates.transferApprovalId,
      transferSourceUserId: oauthStates.transferSourceUserId,
      transferSourceSubjectLifecycleId: oauthStates.transferSourceSubjectLifecycleId,
      reviewerUseDisclosures: oauthStates.reviewerUseDisclosures,
    })

  return parseOAuthStateRecord(record)
}

export async function findOAuthState(state: string): Promise<OAuthStateContext | null> {
  const [record] = await db
    .select({
      intent: oauthStates.intent,
      userId: oauthStates.userId,
      characterId: oauthStates.characterId,
      returnPath: oauthStates.returnPath,
      organizationId: oauthStates.organizationId,
      organizationVersion: oauthStates.organizationVersion,
      transferApprovalId: oauthStates.transferApprovalId,
      transferSourceUserId: oauthStates.transferSourceUserId,
      transferSourceSubjectLifecycleId: oauthStates.transferSourceSubjectLifecycleId,
      reviewerUseDisclosures: oauthStates.reviewerUseDisclosures,
    })
    .from(oauthStates)
    .where(and(eq(oauthStates.stateHash, hashToken(state)), gt(oauthStates.expiresAt, new Date())))

  return parseOAuthStateRecord(record)
}

function parseOAuthStateRecord(
  record: StoredOAuthStateRecord | undefined,
): OAuthStateContext | null {
  if (!record) return null
  const reviewerUseDisclosures = parseReviewerUseDisclosures(record.reviewerUseDisclosures)
  if (record.intent === 'login')
    return {
      intent: 'login',
      reviewerUseDisclosures,
      ...(record.returnPath ? { returnPath: record.returnPath } : {}),
    }
  if (record.intent === 'attach' && record.userId)
    return { intent: 'attach', userId: record.userId, reviewerUseDisclosures }
  if (record.intent === 'reauthorize' && record.userId && record.characterId)
    return {
      intent: 'reauthorize',
      userId: record.userId,
      characterId: record.characterId,
      reviewerUseDisclosures,
      ...(record.returnPath ? { returnPath: record.returnPath } : {}),
    }
  if (
    record.intent === 'claim-organization-owner' &&
    record.userId &&
    record.characterId &&
    record.organizationId &&
    record.organizationVersion
  )
    return {
      intent: 'claim-organization-owner',
      userId: record.userId,
      characterId: record.characterId,
      organizationId: record.organizationId,
      organizationVersion: record.organizationVersion,
      reviewerUseDisclosures,
    }
  if (
    record.intent === 'transfer' &&
    record.transferApprovalId &&
    record.transferSourceUserId &&
    record.transferSourceSubjectLifecycleId &&
    record.userId &&
    record.characterId
  )
    return {
      intent: 'transfer',
      approvalId: record.transferApprovalId,
      sourceUserId: record.transferSourceUserId,
      sourceSubjectLifecycleId: record.transferSourceSubjectLifecycleId,
      userId: record.userId,
      characterId: record.characterId,
      reviewerUseDisclosures,
    }
  throw new Error('Stored OAuth state has invalid authorization context')
}

interface StoredOAuthStateRecord {
  readonly intent: string
  readonly userId: string | null
  readonly characterId: number | null
  readonly returnPath: string | null
  readonly organizationId: number | null
  readonly organizationVersion: number | null
  readonly transferApprovalId: string | null
  readonly transferSourceUserId: string | null
  readonly transferSourceSubjectLifecycleId: string | null
  readonly reviewerUseDisclosures: unknown
}

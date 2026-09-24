import { and, eq, gt, lte } from 'drizzle-orm'
import { db } from '../db/client.js'
import { oauthStates } from '../db/schema.js'
import {
  parseReviewerUseDisclosures,
  type ReviewerUseDisclosure,
} from '../reviewer-use-disclosure.js'
import { hashToken } from './security.js'

const oauthStateTtlMs = 10 * 60 * 1000

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
    characterId:
      context.intent === 'reauthorize' ||
      context.intent === 'claim-organization-owner' ||
      context.intent === 'transfer'
        ? context.characterId
        : null,
    expiresAt: new Date(Date.now() + oauthStateTtlMs),
    intent: context.intent,
    organizationDeploymentId: context.intent === 'claim-organization-owner' ? 1 : null,
    organizationId: context.intent === 'claim-organization-owner' ? context.organizationId : null,
    organizationVersion:
      context.intent === 'claim-organization-owner' ? context.organizationVersion : null,
    returnPath:
      context.intent === 'login' || context.intent === 'reauthorize'
        ? (context.returnPath ?? null)
        : null,
    reviewerUseDisclosures,
    stateHash: hashToken(state),
    transferApprovalId: context.intent === 'transfer' ? context.approvalId : null,
    transferSourceSubjectLifecycleId:
      context.intent === 'transfer' ? context.sourceSubjectLifecycleId : null,
    transferSourceUserId: context.intent === 'transfer' ? context.sourceUserId : null,
    userId: context.intent === 'login' ? null : context.userId,
  })
}

export async function consumeOAuthState(state: string): Promise<OAuthStateContext | null> {
  const [record] = await db
    .delete(oauthStates)
    .where(and(eq(oauthStates.stateHash, hashToken(state)), gt(oauthStates.expiresAt, new Date())))
    .returning({
      characterId: oauthStates.characterId,
      intent: oauthStates.intent,
      organizationId: oauthStates.organizationId,
      organizationVersion: oauthStates.organizationVersion,
      returnPath: oauthStates.returnPath,
      reviewerUseDisclosures: oauthStates.reviewerUseDisclosures,
      transferApprovalId: oauthStates.transferApprovalId,
      transferSourceSubjectLifecycleId: oauthStates.transferSourceSubjectLifecycleId,
      transferSourceUserId: oauthStates.transferSourceUserId,
      userId: oauthStates.userId,
    })

  return parseOAuthStateRecord(record)
}

export async function findOAuthState(state: string): Promise<OAuthStateContext | null> {
  const [record] = await db
    .select({
      characterId: oauthStates.characterId,
      intent: oauthStates.intent,
      organizationId: oauthStates.organizationId,
      organizationVersion: oauthStates.organizationVersion,
      returnPath: oauthStates.returnPath,
      reviewerUseDisclosures: oauthStates.reviewerUseDisclosures,
      transferApprovalId: oauthStates.transferApprovalId,
      transferSourceSubjectLifecycleId: oauthStates.transferSourceSubjectLifecycleId,
      transferSourceUserId: oauthStates.transferSourceUserId,
      userId: oauthStates.userId,
    })
    .from(oauthStates)
    .where(and(eq(oauthStates.stateHash, hashToken(state)), gt(oauthStates.expiresAt, new Date())))

  return parseOAuthStateRecord(record)
}

function parseOAuthStateRecord(
  record: StoredOAuthStateRecord | undefined,
): OAuthStateContext | null {
  if (!record) {
    return null
  }
  const reviewerUseDisclosures = parseReviewerUseDisclosures(record.reviewerUseDisclosures)
  if (record.intent === 'login') {
    return {
      intent: 'login',
      reviewerUseDisclosures,
      ...(record.returnPath ? { returnPath: record.returnPath } : {}),
    }
  }
  if (record.intent === 'attach' && record.userId) {
    return { intent: 'attach', reviewerUseDisclosures, userId: record.userId }
  }
  if (record.intent === 'reauthorize' && record.userId && record.characterId) {
    return {
      characterId: record.characterId,
      intent: 'reauthorize',
      reviewerUseDisclosures,
      userId: record.userId,
      ...(record.returnPath ? { returnPath: record.returnPath } : {}),
    }
  }
  if (record.intent === 'claim-organization-owner') {
    return parseOwnerClaimState(record, reviewerUseDisclosures)
  }
  if (record.intent === 'transfer') {
    return parseTransferState(record, reviewerUseDisclosures)
  }
  throw new Error('Stored OAuth state has invalid authorization context')
}

function parseOwnerClaimState(
  record: StoredOAuthStateRecord,
  reviewerUseDisclosures: readonly ReviewerUseDisclosure[],
): OAuthStateContext {
  if (
    !record.userId ||
    !record.characterId ||
    !record.organizationId ||
    !record.organizationVersion
  ) {
    throw new Error('Stored OAuth state has invalid authorization context')
  }
  return {
    characterId: record.characterId,
    intent: 'claim-organization-owner',
    organizationId: record.organizationId,
    organizationVersion: record.organizationVersion,
    reviewerUseDisclosures,
    userId: record.userId,
  }
}

function parseTransferState(
  record: StoredOAuthStateRecord,
  reviewerUseDisclosures: readonly ReviewerUseDisclosure[],
): OAuthStateContext {
  if (
    !record.transferApprovalId ||
    !record.transferSourceUserId ||
    !record.transferSourceSubjectLifecycleId ||
    !record.userId ||
    !record.characterId
  ) {
    throw new Error('Stored OAuth state has invalid authorization context')
  }
  return {
    approvalId: record.transferApprovalId,
    characterId: record.characterId,
    intent: 'transfer',
    reviewerUseDisclosures,
    sourceSubjectLifecycleId: record.transferSourceSubjectLifecycleId,
    sourceUserId: record.transferSourceUserId,
    userId: record.userId,
  }
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

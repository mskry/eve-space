import { and, eq, gt, lte } from 'drizzle-orm'
import { db } from '../db/client.js'
import { oauthStates } from '../db/schema.js'
import { hashToken } from './security.js'

const oauthStateTtlMs = 10 * 60 * 1_000

export type OAuthStateContext =
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

export async function storeOAuthState(state: string, context: OAuthStateContext) {
  await db.delete(oauthStates).where(lte(oauthStates.expiresAt, new Date()))
  await db.insert(oauthStates).values({
    stateHash: hashToken(state),
    intent: context.intent,
    userId: context.intent === 'login' ? null : context.userId,
    characterId:
      context.intent === 'reauthorize' || context.intent === 'claim-organization-owner'
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
    })

  if (!record) return null
  if (record.intent === 'login')
    return {
      intent: 'login',
      ...(record.returnPath ? { returnPath: record.returnPath } : {}),
    }
  if (record.intent === 'attach' && record.userId)
    return { intent: 'attach', userId: record.userId }
  if (record.intent === 'reauthorize' && record.userId && record.characterId)
    return {
      intent: 'reauthorize',
      userId: record.userId,
      characterId: record.characterId,
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
    }
  throw new Error('Stored OAuth state has invalid authorization context')
}

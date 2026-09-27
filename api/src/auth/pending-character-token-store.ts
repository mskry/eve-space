import { and, eq, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import { pendingCharacterTokens } from '../db/schema.js'

type PendingTokenReader = Pick<DatabaseTransaction, 'select'>

export interface PendingCharacterTokenBinding {
  readonly characterId: number
  readonly userId: string
  readonly subjectLifecycleId: string
  readonly baseTokenVersion: number
  readonly attemptId: string
}

export interface PendingCharacterToken extends PendingCharacterTokenBinding {
  readonly encryptedTokens: string
  readonly accessTokenExpiresAt: Date
}

export interface PendingCharacterTokenWrite extends Omit<PendingCharacterToken, 'attemptId'> {
  readonly attemptId: string
  readonly expectedAttemptId: string | null
}

export const findPendingCharacterToken = async (
  characterId: number,
  subjectLifecycleId: string,
  connection: PendingTokenReader = db,
): Promise<PendingCharacterToken | null> => {
  const [pending] = await connection
    .select({
      characterId: pendingCharacterTokens.characterId,
      userId: pendingCharacterTokens.userId,
      subjectLifecycleId: pendingCharacterTokens.subjectLifecycleId,
      baseTokenVersion: pendingCharacterTokens.baseTokenVersion,
      attemptId: pendingCharacterTokens.attemptId,
      encryptedTokens: pendingCharacterTokens.encryptedTokens,
      accessTokenExpiresAt: pendingCharacterTokens.accessTokenExpiresAt,
    })
    .from(pendingCharacterTokens)
    .where(
      and(
        eq(pendingCharacterTokens.characterId, characterId),
        eq(pendingCharacterTokens.subjectLifecycleId, subjectLifecycleId),
      ),
    )
  return pending ?? null
}

export const writePendingCharacterToken = async (
  transaction: DatabaseTransaction,
  input: PendingCharacterTokenWrite,
): Promise<boolean> => {
  const rows = await transaction.execute(sql`
    insert into pending_character_tokens (
      character_id, user_id, subject_lifecycle_id, base_token_version,
      attempt_id, encrypted_tokens, access_token_expires_at
    )
    select ${input.characterId}, ${input.userId}, ${input.subjectLifecycleId},
      ${input.baseTokenVersion}, ${input.attemptId}, ${input.encryptedTokens},
      ${input.accessTokenExpiresAt.toISOString()}::timestamptz
    from eve_tokens token
    join characters character on character.character_id = token.character_id
    join platform_subject_lifecycles lifecycle on lifecycle.character_id = token.character_id
    where token.character_id = ${input.characterId}
      and token.token_version = ${input.baseTokenVersion}
      and character.user_id = ${input.userId}
      and lifecycle.subject_lifecycle_id = ${input.subjectLifecycleId}
      and (
        ${input.expectedAttemptId}::uuid is null
        or exists (
          select 1 from pending_character_tokens pending
          where pending.character_id = ${input.characterId}
            and pending.attempt_id = ${input.expectedAttemptId}::uuid
            and pending.user_id = ${input.userId}
            and pending.subject_lifecycle_id = ${input.subjectLifecycleId}
            and pending.base_token_version = ${input.baseTokenVersion}
        )
      )
    on conflict (character_id) do update set
      attempt_id = excluded.attempt_id,
      encrypted_tokens = excluded.encrypted_tokens,
      access_token_expires_at = excluded.access_token_expires_at,
      updated_at = now()
    where pending_character_tokens.user_id = excluded.user_id
      and pending_character_tokens.subject_lifecycle_id = excluded.subject_lifecycle_id
      and pending_character_tokens.base_token_version = excluded.base_token_version
      and pending_character_tokens.attempt_id = ${input.expectedAttemptId}
      and ${input.expectedAttemptId}::uuid is not null
      and exists (
        select 1 from eve_tokens token
        where token.character_id = pending_character_tokens.character_id
          and token.token_version = pending_character_tokens.base_token_version
      )
    returning attempt_id
  `)
  return rows.length === 1
}

export const deletePendingCharacterToken = async (
  transaction: DatabaseTransaction,
  binding: PendingCharacterTokenBinding,
): Promise<boolean> => {
  const [deleted] = await transaction
    .delete(pendingCharacterTokens)
    .where(
      and(
        eq(pendingCharacterTokens.characterId, binding.characterId),
        eq(pendingCharacterTokens.userId, binding.userId),
        eq(pendingCharacterTokens.subjectLifecycleId, binding.subjectLifecycleId),
        eq(pendingCharacterTokens.baseTokenVersion, binding.baseTokenVersion),
        eq(pendingCharacterTokens.attemptId, binding.attemptId),
        sql`exists (
          select 1 from eve_tokens token
          where token.character_id = ${pendingCharacterTokens.characterId}
            and token.token_version = ${binding.baseTokenVersion}
        )`,
      ),
    )
    .returning({ characterId: pendingCharacterTokens.characterId })
  return Boolean(deleted)
}

import { sql } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import { characterLockKey, characterLockNamespace } from '../db/locks.js'
import { env } from '../env.js'

export async function setAuthTransactionLockTimeout(transaction: DatabaseTransaction) {
  await transaction.execute(
    sql.raw(`set local lock_timeout = '${env.TOKEN_REFRESH_LOCK_TIMEOUT_MS}ms'`),
  )
}

export async function lockCharacter(transaction: DatabaseTransaction, characterId: number) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(${characterLockNamespace}, ${characterLockKey(characterId)})`,
  )
}

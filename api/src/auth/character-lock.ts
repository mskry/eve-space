import { sql } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import { characterLockKey, characterLockNamespace } from '../db/locks.js'

export async function lockCharacter(transaction: DatabaseTransaction, characterId: number) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(${characterLockNamespace}, ${characterLockKey(characterId)})`,
  )
}

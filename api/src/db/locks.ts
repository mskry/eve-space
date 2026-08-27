import { createHash } from 'node:crypto'
import { collectionStateIdentityJson } from '../platform/collection-state.js'

/**
 * PostgreSQL advisory lock identifiers.
 *
 * Every advisory lock in a database shares one global keyspace, so each identifier used anywhere in
 * this codebase is declared here: a collision between two unrelated features is a silent deadlock,
 * not an error, and it is only visible when the keys sit side by side.
 *
 * `pg_advisory_lock(bigint)` and `pg_advisory_lock(int, int)` are separate keyspaces, so a bare id
 * can never collide with a namespaced one. The groups below reflect that split; only collisions
 * within a group matter.
 */

/** Single-key space: pg_advisory_lock(bigint) / pg_advisory_xact_lock(bigint). */
export const migrationLockId = 410_024_413
export const deploymentSetupLockId = 1_163_283_537

/** Namespaced space: pg_advisory_lock(int, int) / pg_advisory_xact_lock(int, int). */
export const characterLockNamespace = 1_163_277_105
export const resourceRefreshLockNamespace = 1_163_277_106
export const moduleMigrationLockNamespace = 410_024_414

/**
 * Folds a character ID into the signed 32-bit second slot.
 *
 * `character_id` is a bigint validated only as a safe integer, but the two-argument advisory lock
 * takes `integer`, so a raw ID above 2^31-1 raises SQLSTATE 22003 instead of locking. Every ID
 * below 2^32 stays distinct, and IDs below 2^31 map to themselves, leaving lock identity unchanged
 * for every character that exists today.
 */
export function characterLockKey(characterId: number) {
  const high = Math.floor(characterId / 2 ** 32)
  const low = characterId % 2 ** 32
  return Math.trunc(low ^ high)
}

export function moduleMigrationLockKey(moduleId: string) {
  return createHash('sha256')
    .update('eve-space:module-migration-lock:v1\0', 'utf8')
    .update(moduleId, 'utf8')
    .digest()
    .readInt32BE(0)
}

export function resourceRefreshLockKey(identity: {
  readonly moduleId: string
  readonly resourceId: string
  readonly subjectKind: string
  readonly subjectLifecycleId: string
  readonly subjectId: string
}) {
  return createHash('sha256')
    .update('eve-space:resource-refresh-lock:v1\0', 'utf8')
    .update(collectionStateIdentityJson(identity), 'utf8')
    .digest()
    .readInt32BE(0)
}

export function assertDistinctModuleMigrationLockKeys(
  moduleIds: readonly string[],
  keyOf = moduleMigrationLockKey,
) {
  const owners = new Map<number, string>()
  for (const moduleId of new Set(moduleIds)) {
    const key = keyOf(moduleId)
    const owner = owners.get(key)
    if (owner)
      throw new Error(
        `Module migration advisory-lock key ${key} collides between ${owner} and ${moduleId}`,
      )
    owners.set(key, moduleId)
  }
}

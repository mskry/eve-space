import {
  platformInventoryBounds,
  type PlatformPersonalInventorySubject,
} from '@eve-space/platform-module-contract/inventory'
import {
  inventoryAssetsScope,
  inventoryDenial,
  inventoryFingerprint,
  normalizeInventorySelection,
} from '../inventory-policy.js'
import { loadPersonalInventorySubjects } from './inventory-subject-store.js'
import { sessionAdmissionDenial } from './read-admission.js'
import type { ReadAdmissionDenial } from './read-policy.js'
import { immediateReadWork, type ReadAdmissionWork } from './read-work.js'
import type { SessionAccount } from './session-store.js'
import { schedulePendingCharacterTokenRecovery } from './tokens.js'

export interface PersonalInventorySubject extends PlatformPersonalInventorySubject {
  readonly characterName: string
  readonly coverage: 'authorization-required' | 'unavailable' | null
  readonly pendingAttemptId: string | null
}

export interface PersonalInventoryBinding {
  readonly scope: 'personal'
  readonly actorUserId: string
  readonly selection: readonly number[] | undefined
  readonly subjects: readonly PersonalInventorySubject[]
  readonly evidenceSubjects: readonly PersonalInventorySubject[]
  readonly fingerprint: string
}

export type PersonalInventoryAdmission =
  | ReadAdmissionDenial
  | {
      readonly admitted: true
      readonly binding: PersonalInventoryBinding
    }

const bindPersonalSubject = (
  row: Awaited<ReturnType<typeof loadPersonalInventorySubjects>>[number],
): PersonalInventorySubject => {
  const hasScope = row.authorizationRevision !== null && row.scopes?.includes(inventoryAssetsScope)
  const pendingAttemptId = row.pendingAttemptId ?? null
  if (pendingAttemptId)
    schedulePendingCharacterTokenRecovery(row.characterId, row.characterLifecycle)
  let coverage: PersonalInventorySubject['coverage'] = null
  if (!hasScope) coverage = 'authorization-required'
  if (pendingAttemptId) coverage = 'unavailable'
  return Object.freeze({
    characterId: row.characterId,
    characterName: row.characterName,
    userId: row.userId,
    characterLifecycle: row.characterLifecycle,
    authorizationRevision: row.authorizationRevision ?? 0,
    pendingAttemptId,
    coverage,
    evidenceReadable: coverage === null,
  })
}

export const admitPersonalInventory = async (
  session: SessionAccount | null,
  characterIds?: readonly number[],
  work: ReadAdmissionWork = immediateReadWork,
): Promise<PersonalInventoryAdmission> => {
  const denied = sessionAdmissionDenial(session)
  if (denied) return denied
  if (characterIds && characterIds.length > platformInventoryBounds.personalSubjects)
    return inventoryDenial('INVENTORY_LIMIT')
  const selection = normalizeInventorySelection(
    characterIds,
    platformInventoryBounds.personalSubjects,
  )
  const rows = await work.run(() =>
    loadPersonalInventorySubjects(
      session!.userId,
      selection,
      platformInventoryBounds.personalSubjects,
    ),
  )
  if (rows.length > platformInventoryBounds.personalSubjects)
    return inventoryDenial('INVENTORY_LIMIT')
  if (
    selection &&
    (rows.length !== selection.length ||
      rows.some((row, index) => row.characterId !== selection[index]))
  ) {
    return inventoryDenial('INVENTORY_SCOPE_DENIED')
  }
  const subjects = Object.freeze(rows.map(bindPersonalSubject))
  const identity = { scope: 'personal' as const, actorUserId: session!.userId, selection, subjects }
  return {
    admitted: true,
    binding: Object.freeze({
      ...identity,
      evidenceSubjects: Object.freeze(subjects.filter((subject) => subject.evidenceReadable)),
      fingerprint: inventoryFingerprint(identity),
    }),
  }
}

export const recheckPersonalInventory = async (
  binding: PersonalInventoryBinding,
  session: SessionAccount | null,
  work: ReadAdmissionWork = immediateReadWork,
): Promise<ReadAdmissionDenial | null> => {
  const denied = sessionAdmissionDenial(session)
  if (denied) return denied
  if (session!.userId !== binding.actorUserId)
    return inventoryDenial('INVENTORY_AUTHORIZATION_CHANGED')
  const current = await admitPersonalInventory(session, binding.selection, work)
  if (!current.admitted) return current
  return current.binding.fingerprint === binding.fingerprint
    ? null
    : inventoryDenial('INVENTORY_AUTHORIZATION_CHANGED')
}

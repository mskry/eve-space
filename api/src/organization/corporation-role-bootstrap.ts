import { observeAndPersistCharacterAffiliation } from '../characters/affiliation-sync.js'
import {
  loadCurrentCorporationRoleBinding,
  type CorporationRoleSourceBinding,
} from '../characters/corporation-role-evidence.js'
import { allocateCorporationRoleObservationSequence } from '../characters/corporation-role-invalidation.js'
import {
  attemptCorporationRoleRead,
  persistCorporationRoleAttemptInTransaction,
  type CorporationRoleAttempt,
  type CorporationRoleAuthorityCheck,
  type CorporationRoleBootstrapIntent,
  type CorporationRoleFailure,
} from '../characters/corporation-role-observation.js'
import type { CharacterCorporationRolesRead } from '../characters/corporation-roles.js'
import { db, type DatabaseTransaction } from '../db/client.js'
import { convergeObservedAffiliationInTransaction } from './authority-convergence.js'
import {
  createCorporationRoleConvergenceHook,
  type AuthorityCorporationEvidence,
} from './corporation-role-convergence.js'

export class CorporationRoleBootstrapError extends Error {
  constructor(
    readonly code:
      | 'affiliation-stale'
      | 'character-ineligible'
      | 'missing-scope'
      | 'not-director'
      | 'rejected'
      | 'role-evidence-unavailable'
      | 'superseded',
  ) {
    super(code)
  }
}

export interface CorporationRoleBootstrapObservation {
  readonly affiliationFreshUntil: Date
  readonly read: CharacterCorporationRolesRead
}

export interface PreparedCorporationRoleBootstrap {
  readonly attempt: CorporationRoleAttempt
  readonly binding: CorporationRoleSourceBinding
  readonly allianceId: number | null
}

export interface CommittedCorporationRoleBootstrap {
  readonly binding: CorporationRoleSourceBinding
  readonly roleEvidenceRevision: string
  readonly freshUntil: Date
}

const bootstrapFailureCode = (failure: CorporationRoleFailure) => {
  if (failure.kind === 'transient') {
    return 'role-evidence-unavailable' as const
  }
  return failure.failureClass === 'missing-scope'
    ? ('missing-scope' as const)
    : ('character-ineligible' as const)
}

const observeBootstrapAffiliation = async (characterId: number, signal?: AbortSignal) => {
  const affiliation = await observeAndPersistCharacterAffiliation(
    characterId,
    signal,
    convergeObservedAffiliationInTransaction,
  )
  if (!affiliation || affiliation.stale) {
    throw new CorporationRoleBootstrapError('affiliation-stale')
  }
  return affiliation
}

export const prepareCorporationRoleBootstrap = async (input: {
  readonly userId: string
  readonly characterId: number
  readonly signal?: AbortSignal
  readonly observation?: CorporationRoleBootstrapObservation
}): Promise<PreparedCorporationRoleBootstrap> => {
  input.signal?.throwIfAborted()
  const affiliation = input.observation
    ? null
    : await observeBootstrapAffiliation(input.characterId, input.signal)
  const binding = await loadCurrentCorporationRoleBinding(db, input)
  const affiliationFreshUntil =
    affiliation?.affiliationFreshUntil ?? input.observation?.affiliationFreshUntil
  if (
    !binding ||
    !affiliationFreshUntil ||
    (affiliation && affiliation.corporationId !== binding.authorityCorporationId)
  ) {
    throw new CorporationRoleBootstrapError('character-ineligible')
  }
  const sequence = await allocateCorporationRoleObservationSequence()
  const attempt: CorporationRoleAttempt = input.observation
    ? {
        affiliationFreshUntil,
        binding,
        outcome: { kind: 'observed', read: input.observation.read },
        sequence,
      }
    : await attemptCorporationRoleRead({
        affiliationFreshUntil,
        binding,
        sequence,
        ...(input.signal && { signal: input.signal }),
      })
  if (attempt.outcome.kind === 'failed') {
    throw new CorporationRoleBootstrapError(bootstrapFailureCode(attempt.outcome.failure))
  }
  return { allianceId: affiliation?.allianceId ?? null, attempt, binding }
}

export const commitCorporationRoleBootstrapInTransaction = async (
  transaction: DatabaseTransaction,
  prepared: PreparedCorporationRoleBootstrap,
  input: {
    readonly intent: CorporationRoleBootstrapIntent
    readonly authorize: CorporationRoleAuthorityCheck
    readonly authorityCorporation: AuthorityCorporationEvidence | null
    readonly signal?: AbortSignal
  },
): Promise<CommittedCorporationRoleBootstrap> => {
  const result = await persistCorporationRoleAttemptInTransaction(transaction, prepared.attempt, {
    afterPersist: createCorporationRoleConvergenceHook({
      authorityCorporation: input.authorityCorporation,
    }),
    authority: { authorize: input.authorize, intent: input.intent, kind: 'bootstrap' },
    ...(input.signal && { signal: input.signal }),
  })
  if (result.status !== 'accepted') {
    throw new CorporationRoleBootstrapError(result.status)
  }
  const { evidence, kind, predicates } = result.transition
  if (
    kind !== 'observed' ||
    evidence.state !== 'fresh' ||
    !evidence.roleRevision ||
    !evidence.freshUntil
  ) {
    throw new CorporationRoleBootstrapError('role-evidence-unavailable')
  }
  if (!predicates?.director) {
    throw new CorporationRoleBootstrapError('not-director')
  }
  return {
    binding: evidence.binding,
    freshUntil: evidence.freshUntil,
    roleEvidenceRevision: evidence.roleRevision,
  }
}

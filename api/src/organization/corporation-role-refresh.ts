import { observeAndPersistCharacterAffiliation } from '../characters/affiliation-sync.js'
import { allocateCorporationRoleObservationSequence } from '../characters/corporation-role-invalidation.js'
import {
  attemptCorporationRoleRead,
  classifyCorporationRoleFailure,
  persistCorporationRoleAttemptInTransaction,
  type CorporationRoleAttempt,
  type CorporationRoleFailure,
} from '../characters/corporation-role-observation.js'
import { db } from '../db/client.js'
import { getAllianceExecutorCorporation } from './authority.js'
import { convergeObservedAffiliationInTransaction } from './authority-convergence.js'
import { OrganizationAuthorityError } from './authority-policy.js'
import { loadCurrentOrganizationIdentity } from './context.js'
import {
  createCorporationRoleConvergenceHook,
  type AuthorityCorporationEvidence,
} from './corporation-role-convergence.js'
import {
  isCorporationRoleBindingDemanded,
  loadCorporationRoleDemand,
  type CorporationRoleDemand,
} from './corporation-role-demand.js'

export interface CorporationRoleRefreshCandidate {
  readonly organizationVersion: number
  readonly userId: string
  readonly characterId: number
  readonly subjectLifecycleId: string
  readonly affiliationPeriodRevision: string
  readonly authorityCorporationId: number
  readonly authorizationGeneration: number
  readonly expectedRoleRevision: string | null
}

export type CorporationRoleRefreshOutcome =
  | 'ineligible'
  | 'not-due'
  | 'superseded'
  | 'rejected'
  | 'observed'
  | 'retry-scheduled'
  | 'degraded'
  | 'invalidated'

const matchesCandidate = (
  demand: CorporationRoleDemand,
  candidate: CorporationRoleRefreshCandidate,
) =>
  demand.organizationVersion === candidate.organizationVersion &&
  demand.userId === candidate.userId &&
  demand.subjectLifecycleId === candidate.subjectLifecycleId &&
  demand.affiliationPeriodRevision === candidate.affiliationPeriodRevision &&
  demand.authorityCorporationId === candidate.authorityCorporationId &&
  demand.authorizationGeneration >= candidate.authorizationGeneration &&
  demand.expectedRoleRevision === candidate.expectedRoleRevision

const resolveConvergenceAuthorityCorporation = async (
  allianceId: number | null,
): Promise<AuthorityCorporationEvidence | null> => {
  const organization = await loadCurrentOrganizationIdentity()
  if (organization.organizationType === 'corporation') {
    return { corporationId: organization.organizationId, freshUntil: null }
  }
  if (allianceId !== organization.organizationId) {
    return null
  }
  try {
    return await getAllianceExecutorCorporation(organization.organizationId)
  } catch (error) {
    if (error instanceof OrganizationAuthorityError) {
      return null
    }
    throw error
  }
}

const affiliationUnavailableFailure: CorporationRoleFailure = {
  failureClass: 'affiliation-unavailable',
  kind: 'transient',
  retryAt: null,
}

const unavailableAffiliationAttempt = (
  demand: CorporationRoleDemand,
  sequence: bigint,
  now: Date,
  failure: CorporationRoleFailure = affiliationUnavailableFailure,
): CorporationRoleAttempt => ({
  affiliationFreshUntil: now,
  binding: demand,
  outcome: { failure, kind: 'failed' },
  sequence,
})

const observeAffiliationForRefresh = async (characterId: number, signal?: AbortSignal) => {
  try {
    return {
      affiliation: await observeAndPersistCharacterAffiliation(
        characterId,
        signal,
        convergeObservedAffiliationInTransaction,
      ),
      failure: null,
    }
  } catch (error) {
    signal?.throwIfAborted()
    const failure = classifyCorporationRoleFailure(error)
    if (!failure) {
      throw error
    }
    return { affiliation: null, failure }
  }
}

const attemptForAffiliation = async (
  demand: CorporationRoleDemand,
  sequence: bigint,
  now: Date,
  affiliation: Awaited<ReturnType<typeof observeAndPersistCharacterAffiliation>>,
  failure: CorporationRoleFailure | null,
  signal?: AbortSignal,
): Promise<CorporationRoleAttempt> => {
  if (
    failure ||
    !affiliation ||
    affiliation.stale ||
    affiliation.corporationId !== demand.authorityCorporationId
  ) {
    return unavailableAffiliationAttempt(demand, sequence, now, failure ?? undefined)
  }
  return attemptCorporationRoleRead({
    affiliationFreshUntil: affiliation.affiliationFreshUntil,
    binding: demand,
    sequence,
    ...(signal && { signal }),
  })
}

export const refreshCorporationRoleEvidence = async (
  candidate: CorporationRoleRefreshCandidate,
  options: { readonly signal?: AbortSignal; readonly now?: Date } = {},
): Promise<CorporationRoleRefreshOutcome> => {
  const { signal } = options
  signal?.throwIfAborted()
  const now = options.now ?? new Date()
  const demand = await loadCorporationRoleDemand(db, candidate.characterId)
  if (!demand || !matchesCandidate(demand, candidate)) {
    return 'ineligible'
  }
  if (demand.nextRefreshAt && demand.nextRefreshAt > now) {
    return 'not-due'
  }
  const sequence = await allocateCorporationRoleObservationSequence()
  const { affiliation, failure } = await observeAffiliationForRefresh(candidate.characterId, signal)
  signal?.throwIfAborted()
  const current = await loadCorporationRoleDemand(db, candidate.characterId)
  if (current?.affiliationPeriodRevision !== demand.affiliationPeriodRevision) {
    return 'superseded'
  }
  const attempt = await attemptForAffiliation(current, sequence, now, affiliation, failure, signal)
  signal?.throwIfAborted()
  const authorityCorporation = await resolveConvergenceAuthorityCorporation(
    affiliation?.allianceId ?? null,
  )
  const result = await db.transaction((transaction) =>
    persistCorporationRoleAttemptInTransaction(transaction, attempt, {
      afterPersist: createCorporationRoleConvergenceHook({ authorityCorporation }),
      authority: {
        expectedRoleRevision: candidate.expectedRoleRevision,
        isDemanded: isCorporationRoleBindingDemanded,
        kind: 'demand',
      },
      ...(signal && { signal }),
    }),
  )
  return result.status === 'accepted' ? result.transition.kind : result.status
}

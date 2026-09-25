import {
  corporationRoleObservationRequiredScope,
  evaluateCorporationRoleEvidence,
  type CorporationRoleEvidenceDatabase,
} from '../characters/corporation-role-evidence.js'
import type { AuthorityEvidenceState } from './authority-policy.js'

export interface RoleEvidenceSourceBinding {
  readonly organizationVersion: number
  readonly userId: string
  readonly characterId: number
  readonly sourceSubjectLifecycleId: string
  readonly affiliationPeriodRevision: string | null
  readonly authorityCorporationId: number
  readonly authorizationGeneration: number
  readonly roleEvidenceRevision: string
  readonly legacyRoleContinuityUntil: Date | null
}

const stateRank: Record<AuthorityEvidenceState, number> = { degraded: 1, fresh: 2, invalid: 0 }

export const weakestAuthorityEvidenceState = (
  first: AuthorityEvidenceState,
  second: AuthorityEvidenceState,
) => (stateRank[first] <= stateRank[second] ? first : second)

const legacyContinuityState = (
  source: RoleEvidenceSourceBinding,
  now: Date,
): AuthorityEvidenceState =>
  source.legacyRoleContinuityUntil && now < source.legacyRoleContinuityUntil ? 'fresh' : 'invalid'

export const resolveSourceRoleEvidenceState = async (
  database: CorporationRoleEvidenceDatabase,
  source: RoleEvidenceSourceBinding,
  now = new Date(),
): Promise<AuthorityEvidenceState> => {
  if (!source.affiliationPeriodRevision) {
    return 'invalid'
  }
  const evaluation = await evaluateCorporationRoleEvidence(database, {
    binding: {
      affiliationPeriodRevision: source.affiliationPeriodRevision,
      authorityCorporationId: source.authorityCorporationId,
      authorizationGeneration: source.authorizationGeneration,
      characterId: source.characterId,
      organizationVersion: source.organizationVersion,
      subjectLifecycleId: source.sourceSubjectLifecycleId,
      userId: source.userId,
    },
    now,
    predicate: 'director',
    requiredScope: corporationRoleObservationRequiredScope,
  })
  const evidence = evaluation.evidence
  if (!evaluation.bindingCurrent) {
    return 'invalid'
  }
  if (!evidence || evidence.status === 'pending') {
    return legacyContinuityState(source, now)
  }
  if (evaluation.outcome !== 'satisfied' || evidence.roleRevision !== source.roleEvidenceRevision) {
    return 'invalid'
  }
  return evidence.state === 'fresh' || evidence.state === 'degraded' ? evidence.state : 'invalid'
}

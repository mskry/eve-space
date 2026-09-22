export interface OrganizationIdentity {
  organizationType: 'corporation' | 'alliance'
  organizationId: number
}

export interface CharacterAffiliation {
  corporationId: number
  allianceId: number | null
}

export interface OrganizationDirectorRoles {
  readonly roles: readonly string[]
}

export type AuthorityEvidenceState = 'fresh' | 'degraded' | 'invalid'
export type AuthorityOperation = 'read-continuity' | 'remediate' | 'mutate'
export const minimumAuthorityEvidenceFreshDurationSeconds = 300
export const maximumAuthorityEvidenceFreshDurationSeconds = 86_400

export interface AuthorityEvidenceClock {
  readonly status: AuthorityEvidenceState
  readonly freshUntil: Date
  readonly graceUntil: Date | null
  readonly invalidatedAt: Date | null
}

export interface DerivedDirectorSourcePredicate {
  readonly enabled: boolean
  readonly organization: OrganizationIdentity
  readonly authorityCorporationId: number
  readonly affiliation: CharacterAffiliation
  readonly requiredScope: string
  readonly scopes: readonly string[]
  readonly roles: OrganizationDirectorRoles
  readonly lifecycleCurrent: boolean
  readonly authorizationGenerationCurrent: boolean
  readonly blocked: boolean
  readonly evidence: AuthorityEvidenceClock
}

export interface AuthoritySourceDecision {
  readonly state: AuthorityEvidenceState
  readonly eligible: boolean
  readonly failure:
    | 'disabled'
    | 'blocked'
    | 'lifecycle-replaced'
    | 'authorization-generation-changed'
    | 'wrong-corporation'
    | 'wrong-alliance'
    | 'missing-scope'
    | 'not-director'
    | 'expired'
    | null
}

export class OrganizationAuthorityError extends Error {
  constructor(
    readonly code:
      | 'missing-scope'
      | 'wrong-corporation'
      | 'wrong-alliance'
      | 'stale-affiliation'
      | 'stale-role-evidence'
      | 'executor-unavailable'
      | 'not-director',
  ) {
    super(code)
  }
}

export function assertOrganizationOwnerAuthorization(
  requiredScope: string,
  scopes: readonly string[],
  roles: OrganizationDirectorRoles,
) {
  assertOrganizationOwnerScope(requiredScope, scopes)
  assertOrganizationOwnerDirectorRole(roles)
}

export function assertOrganizationOwnerScope(requiredScope: string, scopes: readonly string[]) {
  if (!scopes.includes(requiredScope)) throw new OrganizationAuthorityError('missing-scope')
}

export function assertOrganizationOwnerDirectorRole(roles: OrganizationDirectorRoles) {
  if (!roles.roles.includes('Director')) throw new OrganizationAuthorityError('not-director')
}

export function evaluateDerivedDirectorSource(
  source: DerivedDirectorSourcePredicate,
  now: Date,
): AuthoritySourceDecision {
  if (!source.enabled) return invalidDecision('disabled')
  if (source.blocked) return invalidDecision('blocked')
  if (!source.lifecycleCurrent) return invalidDecision('lifecycle-replaced')
  if (!source.authorizationGenerationCurrent)
    return invalidDecision('authorization-generation-changed')
  if (source.affiliation.corporationId !== source.authorityCorporationId)
    return invalidDecision('wrong-corporation')
  if (
    source.organization.organizationType === 'alliance' &&
    source.affiliation.allianceId !== source.organization.organizationId
  )
    return invalidDecision('wrong-alliance')
  if (!source.scopes.includes(source.requiredScope)) return invalidDecision('missing-scope')
  if (!source.roles.roles.includes('Director')) return invalidDecision('not-director')

  const state = resolveAuthorityEvidenceState(source.evidence, now)
  return { state, eligible: state !== 'invalid', failure: state === 'invalid' ? 'expired' : null }
}

export function resolveAuthorityEvidenceState(
  evidence: AuthorityEvidenceClock,
  now: Date,
): AuthorityEvidenceState {
  if (evidence.status === 'invalid' || evidence.invalidatedAt) return 'invalid'
  if (now < evidence.freshUntil) return 'fresh'
  if (evidence.status === 'degraded' && evidence.graceUntil && now < evidence.graceUntil)
    return 'degraded'
  return 'invalid'
}

export function canUseAuthoritySource(
  state: AuthorityEvidenceState,
  operation: AuthorityOperation,
) {
  if (state === 'fresh') return true
  return state === 'degraded' && operation !== 'mutate'
}

export function hasEffectiveDirectorAuthority(input: {
  readonly explicitGrant: boolean
  readonly sourceStates: readonly AuthorityEvidenceState[]
  readonly operation: AuthorityOperation
}) {
  if (input.explicitGrant) return true
  return input.sourceStates.some((state) => canUseAuthoritySource(state, input.operation))
}

function invalidDecision(failure: Exclude<AuthoritySourceDecision['failure'], 'expired' | null>) {
  return { state: 'invalid', eligible: false, failure } as const
}

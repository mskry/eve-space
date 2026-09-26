// Organization-rule SQL constraints intentionally permit fewer roles than operation authorization.
export const organizationRuleRolePredicates = ['director', 'accountant', 'factory-manager'] as const
export type OrganizationRuleRolePredicate = (typeof organizationRuleRolePredicates)[number]

const organizationRuleRolePredicateSet: ReadonlySet<string> = new Set(
  organizationRuleRolePredicates,
)

export const isOrganizationRuleRolePredicate = (
  value: string,
): value is OrganizationRuleRolePredicate => organizationRuleRolePredicateSet.has(value)

export type RuleCondition =
  | { readonly kind: 'registration-compliant' }
  | { readonly kind: 'director-audience' }
  | { readonly kind: 'corporation-role'; readonly predicate: OrganizationRuleRolePredicate }

export type RuleConditionKind = RuleCondition['kind']

interface RuleCharacterBinding {
  readonly subjectLifecycleId: string
  readonly affiliationPeriodRevision: string
  readonly authorizationGeneration: number
  readonly authorityCorporationId: number
  readonly executorRevision: string | null
  readonly executorFreshUntil: Date | null
}

export interface RuleEvidenceSource {
  readonly sourceId: string
  readonly kind: 'registration' | 'explicit-director' | 'derived-director' | 'corporation-role'
  readonly predicate: string | null
  readonly binding: RuleCharacterBinding | null
  readonly complete: boolean
  readonly bindingCurrent: boolean
  readonly status: 'fresh' | 'degraded' | 'invalid' | 'unavailable'
  readonly freshUntil: Date | null
  readonly roleRevision: string | null
}

export interface RuleEligibilityInput {
  readonly condition: RuleCondition
  readonly admitted: boolean
  readonly compliant: boolean
  readonly blocked: boolean
  readonly evidenceUnavailable?: boolean
  readonly sources: readonly RuleEvidenceSource[]
  readonly now: Date
}

export type RuleEligibility =
  | { readonly outcome: 'eligible'; readonly contributors: readonly RuleEvidenceSource[] }
  | { readonly outcome: 'ineligible' | 'unavailable'; readonly contributors: readonly [] }

export const isRuleCondition = (value: unknown): value is RuleCondition => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  if (!('kind' in value)) {
    return false
  }
  if (value.kind === 'corporation-role') {
    return (
      Object.keys(value).length === 2 &&
      'predicate' in value &&
      typeof value.predicate === 'string' &&
      isOrganizationRuleRolePredicate(value.predicate)
    )
  }
  return (
    (value.kind === 'registration-compliant' || value.kind === 'director-audience') &&
    Object.keys(value).length === 1
  )
}

const sourceMatchesRule = (source: RuleEvidenceSource, condition: RuleCondition) => {
  if (condition.kind === 'registration-compliant') {
    return source.kind === 'registration'
  }
  if (condition.kind === 'director-audience') {
    return source.kind === 'explicit-director' || source.kind === 'derived-director'
  }
  return source.kind === 'corporation-role' && source.predicate === condition.predicate
}

const sourceIsCurrent = (source: RuleEvidenceSource, now: Date) =>
  source.complete &&
  source.bindingCurrent &&
  (source.kind === 'registration' ||
    source.kind === 'explicit-director' ||
    source.binding !== null) &&
  source.status === 'fresh' &&
  source.freshUntil !== null &&
  source.freshUntil > now

export const evaluateRuleEligibility = (input: RuleEligibilityInput): RuleEligibility => {
  if (!input.admitted || input.blocked) {
    return { outcome: 'ineligible', contributors: [] }
  }
  if (input.condition.kind === 'registration-compliant' && !input.compliant) {
    return { outcome: 'ineligible', contributors: [] }
  }
  const relevant = input.sources.filter((source) => sourceMatchesRule(source, input.condition))
  const contributors = relevant.filter((source) => sourceIsCurrent(source, input.now))
  if (contributors.length > 0) {
    return { outcome: 'eligible', contributors }
  }
  if (
    input.evidenceUnavailable ||
    relevant.some((source) => source.status === 'unavailable' || source.status === 'degraded')
  ) {
    return { outcome: 'unavailable', contributors: [] }
  }
  return { outcome: 'ineligible', contributors: [] }
}

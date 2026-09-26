export interface CorporationRoleSets {
  readonly roles: readonly string[]
  readonly rolesAtBase: readonly string[]
  readonly rolesAtHeadquarters: readonly string[]
  readonly rolesAtOther: readonly string[]
}

export type CorporationRoleTransition = 'initial' | 'unchanged' | 'gained' | 'lost'

export const reviewedCorporationRolePredicates = [
  'director',
  'accountant',
  'factory-manager',
] as const
export type ReviewedCorporationRolePredicate = (typeof reviewedCorporationRolePredicates)[number]

const roleLocations = ['roles', 'rolesAtBase', 'rolesAtHeadquarters', 'rolesAtOther'] as const

const predicateRequirements: Record<
  ReviewedCorporationRolePredicate,
  { readonly location: (typeof roleLocations)[number]; readonly role: string }
> = {
  accountant: { location: 'roles', role: 'Accountant' },
  director: { location: 'roles', role: 'Director' },
  'factory-manager': { location: 'roles', role: 'Factory_Manager' },
}

const reviewedPredicateSet: ReadonlySet<string> = new Set(reviewedCorporationRolePredicates)

export const isReviewedCorporationRolePredicate = (
  value: string,
): value is ReviewedCorporationRolePredicate => reviewedPredicateSet.has(value)

const compareRoleNames = (left: string, right: string) => {
  if (left < right) {
    return -1
  }
  return left > right ? 1 : 0
}

const canonicalRoleSet = (values: readonly string[]) =>
  [...new Set(values)].toSorted(compareRoleNames)

export const canonicalizeCorporationRoleSets = (
  sets: CorporationRoleSets,
): CorporationRoleSets => ({
  roles: canonicalRoleSet(sets.roles),
  rolesAtBase: canonicalRoleSet(sets.rolesAtBase),
  rolesAtHeadquarters: canonicalRoleSet(sets.rolesAtHeadquarters),
  rolesAtOther: canonicalRoleSet(sets.rolesAtOther),
})

const locationDifference = (from: readonly string[], to: readonly string[]) => {
  const target = new Set(to)
  return from.some((role) => !target.has(role))
}

export const classifyCorporationRoleTransition = (
  previous: CorporationRoleSets | null,
  current: CorporationRoleSets,
): CorporationRoleTransition => {
  if (!previous) {
    return 'initial'
  }
  const lost = roleLocations.some((location) =>
    locationDifference(previous[location], current[location]),
  )
  if (lost) {
    return 'lost'
  }
  const gained = roleLocations.some((location) =>
    locationDifference(current[location], previous[location]),
  )
  return gained ? 'gained' : 'unchanged'
}

export const evaluateCorporationRolePredicate = (
  sets: CorporationRoleSets,
  predicate: ReviewedCorporationRolePredicate,
) => {
  if (!isReviewedCorporationRolePredicate(predicate)) {
    throw new RangeError('Unsupported corporation-role predicate')
  }
  const requirement = predicateRequirements[predicate]
  return sets[requirement.location].includes(requirement.role)
}

export const evaluateReviewedCorporationRolePredicates = (
  sets: CorporationRoleSets,
): Readonly<Record<ReviewedCorporationRolePredicate, boolean>> => ({
  accountant: evaluateCorporationRolePredicate(sets, 'accountant'),
  director: evaluateCorporationRolePredicate(sets, 'director'),
  'factory-manager': evaluateCorporationRolePredicate(sets, 'factory-manager'),
})

export const resolveCorporationRoleRevision = (input: {
  readonly currentRevision: string | null
  readonly transition: CorporationRoleTransition
  readonly generateRevision: () => string
}) =>
  input.currentRevision !== null && input.transition === 'unchanged'
    ? input.currentRevision
    : input.generateRevision()

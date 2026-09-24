import type { EntryKey } from '@pinia/colada'
import type { PlatformReviewerSelectedTarget } from './reviewer-panel.js'

export type PlatformQuerySubject =
  | { readonly kind: 'account' }
  | { readonly kind: 'character'; readonly characterId: number }
  | { readonly kind: 'organization'; readonly organizationVersion: number }
  | {
      readonly kind: 'corporation'
      readonly corporationId: number
      readonly organizationVersion: number
    }
  | {
      readonly kind: 'alliance'
      readonly allianceId: number
      readonly organizationVersion: number
    }

export const PLATFORM_PRIVATE_QUERY_ROOT = ['private'] as const

export interface PlatformReviewerContributionTargetIdentity {
  readonly organizationVersion: number
  readonly moduleId: string
  readonly sectionId?: string
  readonly contributionId: string
  readonly target: PlatformReviewerSelectedTarget
}

export function platformReviewerContributionTargetResourceKey(
  identity: Omit<PlatformReviewerContributionTargetIdentity, 'moduleId' | 'organizationVersion'>,
): EntryKey {
  const target = identity.target
  const key: EntryKey = [
    'reviewer',
    'contributions',
    requiredIdentity(identity.contributionId, 'Reviewer contribution ID'),
    'targets',
    requiredIdentity(target.managedMemberLifecycleId, 'Managed member lifecycle ID'),
    requiredIdentity(target.userId, 'Reviewer target user ID'),
    'section-activation',
    positiveInteger(target.sectionActivationVersion, 'section activation version'),
  ]
  return target.kind === 'managed-organization-character'
    ? [
        ...key,
        positiveInteger(target.characterId, 'character ID'),
        'character-lifecycle',
        requiredIdentity(target.characterLifecycleId, 'Character lifecycle ID'),
        'authorization-generation',
        target.authorizationGeneration === null
          ? 'authorization-required'
          : nonnegativeInteger(target.authorizationGeneration, 'authorization generation'),
        'disclosure-version',
        positiveInteger(target.disclosureVersion, 'disclosure version'),
      ]
    : key
}

export function platformReviewerContributionTargetQueryKey(
  identity: PlatformReviewerContributionTargetIdentity,
): EntryKey {
  return platformModuleQueryKey(
    identity.moduleId,
    { kind: 'organization', organizationVersion: identity.organizationVersion },
    platformReviewerContributionTargetResourceKey(identity),
    identity.sectionId,
  )
}

export function platformModuleQueryKey(
  moduleId: string,
  subject: PlatformQuerySubject,
  resource: EntryKey = [],
  sectionId?: string,
): EntryKey {
  const moduleKey = platformModuleSubjectQueryKey(moduleId, subject)
  return sectionId
    ? [
        ...moduleKey,
        'sections',
        requiredIdentity(sectionId, 'Platform module section ID'),
        ...resource,
      ]
    : [...moduleKey, ...resource]
}

export function platformModuleSubjectQueryKey(
  moduleId: string,
  subject: PlatformQuerySubject,
): EntryKey {
  if (!moduleId) {
    throw new TypeError('Platform module ID is required.')
  }

  if (subject.kind === 'account') {
    return [...PLATFORM_PRIVATE_QUERY_ROOT, 'modules', moduleId, 'account']
  }
  if (subject.kind === 'character') {
    return [
      ...PLATFORM_PRIVATE_QUERY_ROOT,
      'characters',
      positiveInteger(subject.characterId, 'character ID'),
      'modules',
      moduleId,
    ]
  }

  const organizationKey: EntryKey = [
    ...PLATFORM_PRIVATE_QUERY_ROOT,
    'organization',
    positiveInteger(subject.organizationVersion, 'organization version'),
  ]
  if (subject.kind === 'organization') {
    return [...organizationKey, 'modules', moduleId]
  }
  if (subject.kind === 'corporation') {
    return [
      ...organizationKey,
      'corporations',
      positiveInteger(subject.corporationId, 'corporation ID'),
      'modules',
      moduleId,
    ]
  }
  return [
    ...organizationKey,
    'alliances',
    positiveInteger(subject.allianceId, 'alliance ID'),
    'modules',
    moduleId,
  ]
}

export function isPlatformModuleQueryKey(key: EntryKey, moduleId: string) {
  return key.some((part, index) => part === 'modules' && key[index + 1] === moduleId)
}

export function isPlatformModuleSectionQueryKey(
  key: EntryKey,
  moduleId: string,
  sectionId: string,
) {
  return key.some((part, index) => {
    if (part !== 'modules' || key[index + 1] !== moduleId) {
      return false
    }
    const accountSubject =
      index === PLATFORM_PRIVATE_QUERY_ROOT.length && key[index + 2] === 'account'
    const sectionIndex = index + (accountSubject ? 3 : 2)
    return key[sectionIndex] === 'sections' && key[sectionIndex + 1] === sectionId
  })
}

export function isPlatformQuerySubjectValid(subject: PlatformQuerySubject) {
  if (subject.kind === 'account') {
    return true
  }
  if (subject.kind === 'character') {
    return isPositiveInteger(subject.characterId)
  }
  if (!isPositiveInteger(subject.organizationVersion)) {
    return false
  }
  if (subject.kind === 'organization') {
    return true
  }
  return isPositiveInteger(
    subject.kind === 'corporation' ? subject.corporationId : subject.allianceId,
  )
}

function positiveInteger(value: number, name: string) {
  if (!isPositiveInteger(value)) {
    throw new TypeError(`Invalid ${name}: ${value}`)
  }
  return value
}

function nonnegativeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Invalid ${name}: ${value}`)
  }
  return value
}

function requiredIdentity(value: string, name: string) {
  if (!value) {
    throw new TypeError(`${name} is required.`)
  }
  return value
}

function isPositiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

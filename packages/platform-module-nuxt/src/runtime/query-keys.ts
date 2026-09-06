import type { EntryKey } from '@pinia/colada'

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

export function platformModuleQueryKey(
  moduleId: string,
  subject: PlatformQuerySubject,
  resource: EntryKey = [],
): EntryKey {
  const moduleKey = platformModuleSubjectQueryKey(moduleId, subject)
  return [...moduleKey, ...resource]
}

export function platformModuleSubjectQueryKey(
  moduleId: string,
  subject: PlatformQuerySubject,
): EntryKey {
  if (!moduleId) throw new TypeError('Platform module ID is required.')

  if (subject.kind === 'account')
    return [...PLATFORM_PRIVATE_QUERY_ROOT, 'modules', moduleId, 'account']
  if (subject.kind === 'character')
    return [
      ...PLATFORM_PRIVATE_QUERY_ROOT,
      'characters',
      positiveInteger(subject.characterId, 'character ID'),
      'modules',
      moduleId,
    ]

  const organizationKey: EntryKey = [
    ...PLATFORM_PRIVATE_QUERY_ROOT,
    'organization',
    positiveInteger(subject.organizationVersion, 'organization version'),
  ]
  if (subject.kind === 'organization') return [...organizationKey, 'modules', moduleId]
  if (subject.kind === 'corporation')
    return [
      ...organizationKey,
      'corporations',
      positiveInteger(subject.corporationId, 'corporation ID'),
      'modules',
      moduleId,
    ]
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

export function isPlatformQuerySubjectValid(subject: PlatformQuerySubject) {
  if (subject.kind === 'account') return true
  if (subject.kind === 'character') return isPositiveInteger(subject.characterId)
  if (!isPositiveInteger(subject.organizationVersion)) return false
  if (subject.kind === 'organization') return true
  return isPositiveInteger(
    subject.kind === 'corporation' ? subject.corporationId : subject.allianceId,
  )
}

function positiveInteger(value: number, name: string) {
  if (!isPositiveInteger(value)) throw new TypeError(`Invalid ${name}: ${value}`)
  return value
}

function isPositiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

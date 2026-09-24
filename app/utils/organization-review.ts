import type {
  PlatformReviewerPanelCatalogEntry,
  PlatformReviewerSelectedTarget,
} from '@eve-space/platform-module-nuxt/runtime'
import type {
  OrganizationReviewContribution,
  OrganizationReviewDirectoryMember,
  OrganizationReviewTargetMember,
} from '../queries/organization-review'

export interface OrganizationReviewUrlState {
  readonly targetUserId?: string
  readonly targetCharacterId?: number
  readonly contribution?: string
}

export function reviewerContributionIdentity(
  contribution: Pick<PlatformReviewerPanelCatalogEntry, 'moduleId' | 'contributionId'>,
) {
  return `${contribution.moduleId}/${contribution.contributionId}`
}

export function availableOrganizationReviewerPanels(
  authorized: readonly OrganizationReviewContribution[],
  installed: readonly PlatformReviewerPanelCatalogEntry[],
) {
  const authorizedByIdentity = new Map(
    authorized.map((contribution) => [reviewerContributionIdentity(contribution), contribution]),
  )
  return installed.filter((panel) => {
    const contribution = authorizedByIdentity.get(reviewerContributionIdentity(panel))
    return (
      contribution?.routeId === panel.routeId &&
      contribution.routePath === panel.routePath &&
      contribution.target === panel.target &&
      contribution.sectionId === panel.sectionId
    )
  })
}

export function parseOrganizationReviewUrlState(query: Record<string, unknown>) {
  const targetUserId = singleString(query.targetUserId)
  const targetCharacterId = singleString(query.targetCharacterId)
  const contribution = singleString(query.contribution)
  return {
    ...(targetUserId && isUuid(targetUserId) ? { targetUserId } : {}),
    ...(targetCharacterId && positiveIntegerString(targetCharacterId)
      ? { targetCharacterId: Number(targetCharacterId) }
      : {}),
    ...(contribution && isContributionIdentity(contribution) ? { contribution } : {}),
  } satisfies OrganizationReviewUrlState
}

export function selectedReviewerTarget(
  member: OrganizationReviewDirectoryMember | OrganizationReviewTargetMember,
  contribution: PlatformReviewerPanelCatalogEntry,
  requestedCharacterId?: number,
  sectionAuthority?: { readonly disclosureVersion: number; readonly activationVersion: number },
): PlatformReviewerSelectedTarget | undefined {
  if (!sectionAuthority) {
    return undefined
  }
  if (contribution.target === 'managed-organization-account') {
    return {
      kind: 'managed-organization-account',
      managedMemberLifecycleId: member.managedMemberLifecycleId,
      sectionActivationVersion: sectionAuthority.activationVersion,
      userId: member.account.userId,
    }
  }
  if (!('characters' in member)) {
    return undefined
  }
  const characterId = requestedCharacterId ?? member.managedAffiliation.characterId
  const character = member.characters.find((candidate) => candidate.characterId === characterId)
  if (!character) {
    return undefined
  }
  return {
    authorizationGeneration: character.authorizationGeneration,
    characterId,
    characterLifecycleId: character.subjectLifecycleId,
    disclosureVersion: sectionAuthority.disclosureVersion,
    kind: 'managed-organization-character',
    managedMemberLifecycleId: member.managedMemberLifecycleId,
    sectionActivationVersion: sectionAuthority.activationVersion,
    userId: member.account.userId,
  }
}

function singleString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isContributionIdentity(value: string) {
  const separator = value.indexOf('/')
  if (separator <= 0 || separator !== value.lastIndexOf('/')) {
    return false
  }
  return (
    isKebabIdentifier(value.slice(0, separator), 44, true) &&
    isKebabIdentifier(value.slice(separator + 1), 80, false)
  )
}

function isKebabIdentifier(value: string, maximumLength: number, reserved: boolean) {
  if (value.length === 0 || value.length > maximumLength) {
    return false
  }
  if (reserved && (value === 'core' || value === 'platform')) {
    return false
  }
  if (value[0]! < 'a' || value[0]! > 'z' || value.at(-1) === '-') {
    return false
  }
  let previousWasHyphen = false
  for (const character of value) {
    const letter = character >= 'a' && character <= 'z'
    const digit = character >= '0' && character <= '9'
    if (!letter && !digit && character !== '-') {
      return false
    }
    if (character === '-' && previousWasHyphen) {
      return false
    }
    previousWasHyphen = character === '-'
  }
  return true
}

function positiveIntegerString(value: string) {
  if (value.length === 0 || value.length > 16 || value.startsWith('0')) {
    return false
  }
  for (const character of value) {
    if (character < '0' || character > '9') return false
  }
  return Number.isSafeInteger(Number(value)) && Number(value) > 0
}

function isUuid(value: string) {
  const segmentLengths = [8, 4, 4, 4, 12]
  const segments = value.split('-')
  if (segments.length !== segmentLengths.length) {
    return false
  }
  return segments.every(
    (segment, index) =>
      segment.length === segmentLengths[index] &&
      [...segment].every(
        (character) =>
          (character >= '0' && character <= '9') ||
          (character >= 'a' && character <= 'f') ||
          (character >= 'A' && character <= 'F'),
      ),
  )
}

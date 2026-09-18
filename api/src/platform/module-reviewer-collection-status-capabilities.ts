import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import type {
  PlatformReviewerCollectionStatus,
  PlatformReviewerCollectionStatusReads,
  PlatformReviewerTargetContext,
} from '@eve-space/platform-module-contract/server'
import { resolveInstalledResourceEligibility } from './resource-eligibility.js'
import { platformResources } from './resources.js'

interface ReviewerCollectionStatusBinding {
  readonly moduleId: string
  readonly sectionId?: string
  readonly target: PlatformReviewerTargetContext
}

interface ReviewerCollectionStatusOptions {
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly now?: () => Date
  readonly resolveEligibility?: typeof resolveInstalledResourceEligibility
}

export function createPlatformReviewerCollectionStatusReads(
  binding: ReviewerCollectionStatusBinding,
  options: ReviewerCollectionStatusOptions = {},
): PlatformReviewerCollectionStatusReads {
  const allowedCharacters = new Map(
    binding.target.characters
      .filter(
        ({ characterId }) =>
          binding.target.selection.kind === 'account' ||
          binding.target.selection.characterId === characterId,
      )
      .map((character) => [character.characterId, character]),
  )
  const resources = options.resources ?? platformResources

  return {
    async read(resourceId, characterId) {
      if (!Number.isSafeInteger(characterId) || characterId <= 0)
        throw new Error('Reviewer collection resource is unavailable')
      const character = allowedCharacters.get(characterId)
      const resource = resources.find(
        (candidate) =>
          candidate.moduleId === binding.moduleId &&
          candidate.resourceId === resourceId &&
          candidate.subjectKind === 'character' &&
          candidate.eligibility.kind === 'current-managed-member-character' &&
          candidate.sectionId === binding.sectionId,
      )
      if (!character || !resource || !binding.sectionId)
        throw new Error('Reviewer collection resource is unavailable')

      const eligibility = await (options.resolveEligibility ?? resolveInstalledResourceEligibility)(
        {
          moduleId: binding.moduleId,
          resourceId,
          subjectKind: 'character',
          subjectLifecycleId: character.subjectLifecycleId,
          subjectId: String(characterId),
        },
        { resources: [resource], now: (options.now ?? (() => new Date()))() },
      )
      const authority = 'managedAuthority' in eligibility ? eligibility.managedAuthority : null
      if (
        authority?.organizationVersion !== binding.target.organizationVersion ||
        authority.targetUserId !== binding.target.account.userId ||
        authority.managedMemberLifecycleId !== binding.target.managedMemberLifecycleId ||
        authority.sectionId !== binding.sectionId ||
        !('authorizationGeneration' in eligibility) ||
        eligibility.authorizationGeneration !== character.authorizationGeneration
      )
        throw new Error('Reviewer collection resource is unavailable')

      const correlation = {
        moduleId: binding.moduleId,
        sectionId: binding.sectionId,
        resourceId,
        organizationVersion: binding.target.organizationVersion,
        targetUserId: binding.target.account.userId,
        managedMemberLifecycleId: binding.target.managedMemberLifecycleId,
        characterId,
        characterLifecycleId: character.subjectLifecycleId,
        authorizationGeneration: eligibility.authorizationGeneration,
        disclosureVersion: authority.disclosureVersion,
        sectionActivationVersion: authority.sectionActivationVersion,
      }
      if (eligibility.status === 'authorization-required')
        return {
          ...correlation,
          status: 'authorization-required',
          validatedAt: eligibility.validatedAt?.toISOString() ?? null,
          lastFailureClass: 'authorization-required',
          requiredScope: eligibility.requiredScope,
        }
      if (eligibility.status === 'disabled')
        throw new Error('Reviewer collection resource is unavailable')
      if (eligibility.status === 'suppressed') return projectStatus(correlation, eligibility, true)
      if (eligibility.status !== 'eligible')
        throw new Error('Reviewer collection resource is unavailable')
      return projectStatus(correlation, eligibility, eligibility.due)
    },
  }
}

function projectStatus(
  correlation: Omit<
    PlatformReviewerCollectionStatus,
    'status' | 'validatedAt' | 'lastFailureClass' | 'requiredScope'
  >,
  state: {
    readonly validatedAt: Date | null
    readonly lastFailureClass: PlatformReviewerCollectionStatus['lastFailureClass']
  },
  stale: boolean,
): PlatformReviewerCollectionStatus {
  const validatedAt = state.validatedAt?.toISOString() ?? null
  if (!state.validatedAt)
    return {
      ...correlation,
      status: state.lastFailureClass ? 'unavailable' : 'never-collected',
      validatedAt: null,
      lastFailureClass: state.lastFailureClass,
    }
  return {
    ...correlation,
    status: stale || state.lastFailureClass ? 'stale' : 'current',
    validatedAt,
    lastFailureClass: state.lastFailureClass,
  }
}

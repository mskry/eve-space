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
  readonly resourceIds?: readonly string[]
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
      if (!Number.isSafeInteger(characterId) || characterId <= 0) {
        throw new Error('Reviewer collection resource is unavailable')
      }
      const character = allowedCharacters.get(characterId)
      const resource = findReviewerCollectionResource(resources, binding, resourceId)
      if (!character || !resource || !binding.sectionId) {
        throw new Error('Reviewer collection resource is unavailable')
      }

      const eligibility = await (options.resolveEligibility ?? resolveInstalledResourceEligibility)(
        {
          moduleId: binding.moduleId,
          resourceId,
          subjectId: String(characterId),
          subjectKind: 'character',
          subjectLifecycleId: character.subjectLifecycleId,
        },
        { now: (options.now ?? (() => new Date()))(), resources: [resource] },
      )
      const { authority, authorizationGeneration } = requireReviewerCollectionAuthority(
        eligibility,
        binding,
        character.authorizationGeneration,
      )

      const correlation = {
        authorizationGeneration,
        characterId,
        characterLifecycleId: character.subjectLifecycleId,
        disclosureVersion: authority.disclosureVersion,
        managedMemberLifecycleId: binding.target.managedMemberLifecycleId,
        moduleId: binding.moduleId,
        organizationVersion: binding.target.organizationVersion,
        resourceId,
        sectionActivationVersion: authority.sectionActivationVersion,
        sectionId: binding.sectionId,
        targetUserId: binding.target.account.userId,
      }
      if (eligibility.status === 'authorization-required') {
        return {
          ...correlation,
          lastFailureClass: 'authorization-required',
          requiredScope: eligibility.requiredScope,
          status: 'authorization-required',
          validatedAt: eligibility.validatedAt?.toISOString() ?? null,
        }
      }
      if (eligibility.status === 'disabled') {
        throw new Error('Reviewer collection resource is unavailable')
      }
      if (eligibility.status === 'suppressed') {
        return projectStatus(correlation, eligibility, true)
      }
      if (eligibility.status !== 'eligible') {
        throw new Error('Reviewer collection resource is unavailable')
      }
      return projectStatus(correlation, eligibility, eligibility.due)
    },
  }
}

function requireReviewerCollectionAuthority(
  eligibility: Awaited<ReturnType<typeof resolveInstalledResourceEligibility>>,
  binding: ReviewerCollectionStatusBinding,
  expectedGeneration: number | null,
) {
  const authority = 'managedAuthority' in eligibility ? eligibility.managedAuthority : null
  if (
    authority?.organizationVersion !== binding.target.organizationVersion ||
    authority.targetUserId !== binding.target.account.userId ||
    authority.managedMemberLifecycleId !== binding.target.managedMemberLifecycleId ||
    authority.sectionId !== binding.sectionId ||
    !('authorizationGeneration' in eligibility) ||
    eligibility.authorizationGeneration !== expectedGeneration
  ) {
    throw new Error('Reviewer collection resource is unavailable')
  }
  return { authority, authorizationGeneration: eligibility.authorizationGeneration }
}

function findReviewerCollectionResource(
  resources: readonly PlatformInstalledResourceDescriptor[],
  binding: ReviewerCollectionStatusBinding,
  resourceId: string,
) {
  return resources.find(
    (candidate) =>
      candidate.moduleId === binding.moduleId &&
      candidate.resourceId === resourceId &&
      (binding.resourceIds === undefined || binding.resourceIds.includes(resourceId)) &&
      candidate.subjectKind === 'character' &&
      candidate.eligibility.kind === 'current-managed-member-character' &&
      candidate.sectionId === binding.sectionId,
  )
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
  if (!state.validatedAt) {
    return {
      ...correlation,
      lastFailureClass: state.lastFailureClass,
      status: state.lastFailureClass ? 'unavailable' : 'never-collected',
      validatedAt: null,
    }
  }
  return {
    ...correlation,
    lastFailureClass: state.lastFailureClass,
    status: stale || state.lastFailureClass ? 'stale' : 'current',
    validatedAt,
  }
}

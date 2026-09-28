import type { PlatformInstalledOrganizationContributionAuthorization } from '@eve-space/platform-module-contract/installed'
import type { PlatformReviewerTargetContext } from '@eve-space/platform-module-contract/server'
import type { OrganizationSessionContext } from '../organization/access-policy.js'
import { authorizeOrganizationReviewerContribution } from '../organization/module-authorization.js'
import { resolveOrganizationReviewerTarget } from '../organization/reviewer-target.js'
import { isInstalledModuleContributionEnabled } from './module-settings.js'

export const isReviewerProfileReleaseCurrent = async (input: {
  readonly actorUserId: string
  readonly organization: OrganizationSessionContext
  readonly initial: PlatformReviewerTargetContext
  readonly declaration: PlatformInstalledOrganizationContributionAuthorization
  readonly sectionId?: string
}) => {
  const { initial, organization, declaration } = input
  if (
    initial.selection.kind !== 'character' ||
    organization.organizationVersion !== initial.organizationVersion
  ) {
    return false
  }
  const selectedCharacterId = initial.selection.characterId
  const enabled = await isInstalledModuleContributionEnabled(declaration.moduleId, input.sectionId)
  if (!enabled) return false
  const admission = await authorizeOrganizationReviewerContribution(
    input.actorUserId,
    organization,
    declaration,
  )
  if (!admission.authorized) return false

  const current = await resolveOrganizationReviewerTarget({
    organizationVersion: initial.organizationVersion,
    targetUserId: initial.account.userId,
    characterId: selectedCharacterId,
  })
  if (current?.selection.kind !== 'character') return false
  const currentCharacterId = current.selection.characterId
  if (
    current.managedMemberLifecycleId !== initial.managedMemberLifecycleId ||
    current.selection.subjectLifecycleId !== initial.selection.subjectLifecycleId
  ) {
    return false
  }
  const before = initial.characters.find(({ characterId }) => characterId === selectedCharacterId)
  const after = current.characters.find(({ characterId }) => characterId === currentCharacterId)
  return (
    !!before &&
    !!after &&
    before.authorizationGeneration === after.authorizationGeneration &&
    before.affiliation.corporationId === after.affiliation.corporationId &&
    before.affiliation.membership === after.affiliation.membership &&
    before.affiliation.checkedAt === after.affiliation.checkedAt &&
    JSON.stringify(initial.compliance) === JSON.stringify(current.compliance) &&
    JSON.stringify(initial.block) === JSON.stringify(current.block)
  )
}

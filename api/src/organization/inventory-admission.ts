import { platformInventoryBounds } from '@eve-space/platform-module-contract/inventory'
import type { PlatformInstalledOrganizationContributionAuthorization } from '@eve-space/platform-module-contract/installed'
import type { PlatformAuthorizedOrganizationContext } from '@eve-space/platform-module-contract/server'
import { sessionAdmissionDenial } from '../auth/read-admission.js'
import type { ReadAdmissionDenial } from '../auth/read-policy.js'
import { immediateReadWork, type ReadAdmissionWork } from '../auth/read-work.js'
import type { SessionAccount } from '../auth/session-store.js'
import {
  inventoryDenial,
  inventoryFingerprint,
  normalizeInventorySelection,
} from '../inventory-policy.js'
import {
  loadInventoryOrganizationPolicy,
  resolveCorporationInventorySubjects,
  type CorporationInventoryCandidate,
} from './inventory-subject-store.js'
import { admitOrganizationRead } from './read-admission.js'
import { loadOrganizationSessionContext } from './session-context.js'

export interface CorporationInventoryScope {
  readonly actorUserId: string
  readonly corporationId: number
  readonly selection: readonly number[] | undefined
  readonly declaration: PlatformInstalledOrganizationContributionAuthorization
  readonly organization: PlatformAuthorizedOrganizationContext
  readonly viewerFingerprint: string
  readonly policyVersion: number
  readonly subjects: readonly CorporationInventoryCandidate[]
}

export type CorporationInventoryScopeAdmission =
  | ReadAdmissionDenial
  | {
      readonly admitted: true
      readonly binding: CorporationInventoryScope
    }

const requireInventoryReviewerDeclaration = (
  declaration: PlatformInstalledOrganizationContributionAuthorization,
) => {
  if (
    declaration.moduleId !== 'trading' ||
    declaration.audience === 'member' ||
    declaration.requiredPermission !== 'trading.inventory.corporation.read' ||
    declaration.additionalRequiredPermissions?.length !== 1 ||
    declaration.additionalRequiredPermissions[0] !== 'member-audit.assets.read'
  ) {
    throw new TypeError('Inventory requires its exact reviewer permissions')
  }
}

const matchesInventorySelection = (
  selection: readonly number[] | undefined,
  candidates: readonly CorporationInventoryCandidate[],
) =>
  selection === undefined ||
  (candidates.length === selection.length &&
    candidates.every((subject, index) => subject.characterId === selection[index]))

export const admitCorporationInventoryScope = async (
  session: SessionAccount | null,
  declaration: PlatformInstalledOrganizationContributionAuthorization,
  corporationId: number,
  characterIds?: readonly number[],
  work: ReadAdmissionWork = immediateReadWork,
): Promise<CorporationInventoryScopeAdmission> => {
  requireInventoryReviewerDeclaration(declaration)
  const denied = sessionAdmissionDenial(session)
  if (denied) return denied
  if (!Number.isSafeInteger(corporationId) || corporationId <= 0)
    return inventoryDenial('INVENTORY_SCOPE_DENIED')
  if (characterIds && characterIds.length > platformInventoryBounds.corporationSubjects)
    return inventoryDenial('INVENTORY_LIMIT')
  const selection = normalizeInventorySelection(
    characterIds,
    platformInventoryBounds.corporationSubjects,
  )
  const viewer = await work.run(() => loadOrganizationSessionContext(session!.userId))
  const authorized = await work.run(() => admitOrganizationRead(session, viewer, declaration, true))
  if (!authorized.admitted) return authorized
  const policyVersion = await work.run(() =>
    loadInventoryOrganizationPolicy(viewer.organizationVersion),
  )
  if (policyVersion === null) return inventoryDenial('INVENTORY_AUTHORIZATION_CHANGED')
  const candidates = await work.run(() =>
    resolveCorporationInventorySubjects({
      organizationVersion: viewer.organizationVersion,
      corporationId,
      selection,
      maximum: platformInventoryBounds.corporationSubjects,
    }),
  )
  if (!candidates) return inventoryDenial('INVENTORY_SCOPE_DENIED')
  if (candidates.length > platformInventoryBounds.corporationSubjects)
    return inventoryDenial('INVENTORY_LIMIT')
  if (!matchesInventorySelection(selection, candidates))
    return inventoryDenial('INVENTORY_SCOPE_DENIED')
  return {
    admitted: true,
    binding: Object.freeze({
      actorUserId: session!.userId,
      corporationId,
      selection,
      declaration: Object.freeze({
        ...declaration,
        additionalRequiredPermissions: Object.freeze([
          ...declaration.additionalRequiredPermissions!,
        ]),
      }),
      organization: authorized.organization,
      viewerFingerprint: inventoryFingerprint(viewer),
      policyVersion,
      subjects: Object.freeze(candidates.map((subject) => Object.freeze({ ...subject }))),
    }),
  }
}

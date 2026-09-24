import type {
  PlatformReviewerCollectionStatusReads,
  PlatformReviewerEvidenceReads,
  PlatformReviewerTargetContext,
} from '@eve-space/platform-module-contract/server'
import type { PlatformInstalledPersistenceOperationDescriptor } from '@eve-space/platform-module-server'
import { sql } from '../db/client.js'
import { createStandaloneModulePersistenceOperationInvoker } from '../db/module-persistence-operation-transaction.js'
import {
  installedModulePersistenceOperationCatalog,
  installedModulePersistenceOperations,
} from '../generated/platform/installed-module-persistence.js'

interface ReviewerEvidenceBinding {
  readonly moduleId: string
  readonly routeId: string
  readonly resourceId: string
  readonly operationId: string
  readonly target: PlatformReviewerTargetContext
}

export function createPlatformReviewerEvidenceReads(
  binding: ReviewerEvidenceBinding,
  collectionStatus: PlatformReviewerCollectionStatusReads,
): PlatformReviewerEvidenceReads {
  const operation = resolveOperation(binding)
  const invoke = createStandaloneModulePersistenceOperationInvoker(
    sql,
    binding.moduleId,
    installedModulePersistenceOperations,
    { readOnly: true, statementTimeoutMilliseconds: 2000 },
  )
  return {
    async read(options = {}) {
      if (binding.target.selection.kind !== 'character') {
        throw new Error('Reviewer evidence is unavailable')
      }
      const status = await collectionStatus.read(
        binding.resourceId,
        binding.target.selection.characterId,
      )
      if (
        status.authorizationGeneration === null ||
        (status.status !== 'current' && status.status !== 'stale')
      ) {
        return null
      }
      return invoke(operation, {
        authorizationGeneration: status.authorizationGeneration,
        characterId: status.characterId,
        characterLifecycleId: status.characterLifecycleId,
        disclosureVersion: status.disclosureVersion,
        managedMemberLifecycleId: status.managedMemberLifecycleId,
        organizationVersion: status.organizationVersion,
        sectionActivationVersion: status.sectionActivationVersion,
        targetUserId: status.targetUserId,
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      })
    },
  }
}

function resolveOperation(binding: ReviewerEvidenceBinding) {
  const catalog = installedModulePersistenceOperationCatalog as Readonly<
    Record<string, PlatformInstalledPersistenceOperationDescriptor>
  >
  const operation = catalog[`${binding.moduleId}/${binding.operationId}`]
  if (operation?.mode !== 'read' || !operation.grants.routes.includes(binding.routeId)) {
    throw new Error('Reviewer evidence operation is unavailable')
  }
  return operation
}

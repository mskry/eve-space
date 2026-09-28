import type {
  PlatformReviewerCollectionStatusReads,
  PlatformReviewerCollectionStatus,
  PlatformReviewerEvidenceReads,
  PlatformReviewerEvidenceResult,
  PlatformReviewerTargetContext,
} from '@eve-space/platform-module-contract/server'
import type { PlatformInstalledPersistenceOperationDescriptor } from '@eve-space/platform-module-server'
import { z } from 'zod'
import { sql } from '../db/client.js'
import { createStandaloneModulePersistenceOperationInvoker } from '../db/module-persistence-operation-transaction.js'
import {
  installedModulePersistenceOperationCatalog,
  installedModulePersistenceOperations,
} from '../generated/platform/installed-module-persistence.js'

interface ReviewerEvidenceBinding {
  readonly moduleId: string
  readonly routeId: string
  readonly resources: readonly { readonly resourceId: string; readonly field: string | null }[]
  readonly operationId: string
  readonly target: PlatformReviewerTargetContext
}

const evidenceFieldsSchema = z.record(z.string(), z.unknown()).nullable()
const maximumEvidenceReadAttempts = 2

const readableEvidenceStatus = (status: PlatformReviewerCollectionStatus) =>
  status.authorizationGeneration !== null &&
  (status.status === 'current' || status.status === 'stale')

const sameAuthority = (
  left: Awaited<ReturnType<PlatformReviewerCollectionStatusReads['read']>>,
  right: Awaited<ReturnType<PlatformReviewerCollectionStatusReads['read']>>,
) =>
  left.authorizationGeneration === right.authorizationGeneration &&
  left.characterId === right.characterId &&
  left.characterLifecycleId === right.characterLifecycleId &&
  left.disclosureVersion === right.disclosureVersion &&
  left.managedMemberLifecycleId === right.managedMemberLifecycleId &&
  left.organizationVersion === right.organizationVersion &&
  left.sectionActivationVersion === right.sectionActivationVersion &&
  left.targetUserId === right.targetUserId &&
  left.sectionId === right.sectionId

const sameCollectionMetadata = (
  left: PlatformReviewerCollectionStatus,
  right: PlatformReviewerCollectionStatus,
) => {
  if (
    left.resourceId !== right.resourceId ||
    left.status !== right.status ||
    left.validatedAt !== right.validatedAt ||
    left.cachedUntil !== right.cachedUntil ||
    left.lastFailureClass !== right.lastFailureClass
  ) {
    return false
  }
  return (
    left.status !== 'authorization-required' ||
    (right.status === 'authorization-required' && left.requiredScope === right.requiredScope)
  )
}

const assertSameAuthority = (
  anchor: PlatformReviewerCollectionStatus,
  statuses: readonly PlatformReviewerCollectionStatus[],
) => {
  if (statuses.some((status) => !sameAuthority(anchor, status))) {
    throw new Error('Reviewer evidence authority changed')
  }
}

const resolveOperation = (binding: ReviewerEvidenceBinding) => {
  const catalog: Readonly<Record<string, PlatformInstalledPersistenceOperationDescriptor>> =
    installedModulePersistenceOperationCatalog
  const operation = catalog[`${binding.moduleId}/${binding.operationId}`]
  if (operation?.mode !== 'read' || !operation.grants.routes.includes(binding.routeId)) {
    throw new Error('Reviewer evidence operation is unavailable')
  }
  return operation
}

const projectEvidence = <Result>(
  bindings: ReviewerEvidenceBinding['resources'],
  statuses: readonly PlatformReviewerCollectionStatus[],
  result: Result,
) => {
  // The invoker validates the operation output; only named fields require an object result.
  const fields = bindings.some(({ field }) => field !== null)
    ? evidenceFieldsSchema.parse(result)
    : null
  const resources: Record<string, PlatformReviewerEvidenceResult<unknown>> = {}
  for (const [index, { resourceId, field }] of bindings.entries()) {
    const status = statuses[index]!
    const canRead = status.status === 'current' || status.status === 'stale'
    if (canRead && field !== null && fields && !Object.hasOwn(fields, field)) {
      throw new Error('Reviewer evidence result is unavailable')
    }
    const evidence = field === null ? result : (fields?.[field] ?? null)
    resources[resourceId] = { status, evidence: canRead ? evidence : null }
  }
  return resources
}

const readResourceStatuses = (
  bindings: ReviewerEvidenceBinding['resources'],
  characterId: number,
  collectionStatus: PlatformReviewerCollectionStatusReads,
) => Promise.all(bindings.map(({ resourceId }) => collectionStatus.read(resourceId, characterId)))

export const createPlatformReviewerEvidenceReads = (
  binding: ReviewerEvidenceBinding,
  collectionStatus: PlatformReviewerCollectionStatusReads,
): PlatformReviewerEvidenceReads => {
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
      const characterId = binding.target.selection.characterId
      /* oxlint-disable no-await-in-loop -- A retry must finish its observation read before checking the next collection state. */
      for (let attempt = 0; attempt < maximumEvidenceReadAttempts; attempt += 1) {
        const statuses = await readResourceStatuses(
          binding.resources,
          characterId,
          collectionStatus,
        )
        const readable = statuses.find(readableEvidenceStatus)
        if (readable) assertSameAuthority(readable, statuses)
        const result = readable
          ? await invoke(operation, {
              authorizationGeneration: readable.authorizationGeneration,
              characterId: readable.characterId,
              characterLifecycleId: readable.characterLifecycleId,
              disclosureVersion: readable.disclosureVersion,
              managedMemberLifecycleId: readable.managedMemberLifecycleId,
              organizationVersion: readable.organizationVersion,
              sectionActivationVersion: readable.sectionActivationVersion,
              targetUserId: readable.targetUserId,
              ...(options.limit !== undefined && { limit: options.limit }),
            })
          : null
        const finalStatuses = readable
          ? await readResourceStatuses(binding.resources, characterId, collectionStatus)
          : statuses
        if (readable) assertSameAuthority(readable, finalStatuses)
        if (
          statuses.every((status, index) => sameCollectionMetadata(status, finalStatuses[index]!))
        ) {
          return projectEvidence(binding.resources, statuses, result)
        }
      }
      /* oxlint-enable no-await-in-loop */
      throw new Error('Reviewer evidence changed during read')
    },
  }
}

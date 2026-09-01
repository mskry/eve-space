import type { Queue } from 'bullmq'
import { repairPlatformCollectionState } from '../platform/collection-state-repair.js'
import { runAffiliationPlanner } from './affiliation-planner.js'
import { enqueueDiagnostic } from './platform.js'
import { runOrganizationOwnerEvidencePlanner } from './owner-evidence-planner.js'
import { runResourcePlanner } from './resource-planner.js'

interface QueuePlannerDependencies {
  enqueueDiagnostic(source: 'planner', signal?: AbortSignal): Promise<unknown>
  planAffiliations(queue: Queue, signal?: AbortSignal): Promise<unknown>
  planOrganizationOwnerEvidence(queue: Queue, signal?: AbortSignal): Promise<unknown>
  repairCollectionState(options: { signal?: AbortSignal }): Promise<unknown>
  planResources(queue: Queue, signal?: AbortSignal): Promise<unknown>
}

const defaultDependencies: QueuePlannerDependencies = {
  enqueueDiagnostic,
  planAffiliations: runAffiliationPlanner,
  planOrganizationOwnerEvidence: runOrganizationOwnerEvidencePlanner,
  repairCollectionState: repairPlatformCollectionState,
  planResources: runResourcePlanner,
}

export async function runQueuePlanner(
  queue: Queue,
  signal?: AbortSignal,
  dependencies: QueuePlannerDependencies = defaultDependencies,
) {
  signal?.throwIfAborted()
  await dependencies.enqueueDiagnostic('planner', signal)
  await dependencies.planAffiliations(queue, signal)
  await dependencies.planOrganizationOwnerEvidence(queue, signal)
  await dependencies.repairCollectionState({ signal })
  await dependencies.planResources(queue, signal)
}

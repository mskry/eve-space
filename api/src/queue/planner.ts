import { repairPlatformCollectionState } from '../platform/collection-state-repair.js'
import { runInstalledResourceMaintenance } from '../platform/resource-maintenance.js'
import { repairOrganizationCompliance } from '../organization/compliance-repair.js'
import { runAffiliationPlanner } from './affiliation-planner.js'
import { runCorporationRolePlanner } from './corporation-role-planner.js'
import type { QueuePlanningContext } from './planning-context.js'
import { runResourcePlanner } from './resource-planner.js'

export async function runQueuePlanner(context: QueuePlanningContext) {
  const { producer, signal } = context
  signal?.throwIfAborted()
  await producer.enqueue(
    {
      name: 'diagnostic',
      payload: { operationId: 'queue-diagnostic' },
      source: 'planner',
    },
    { signal },
  )
  await runAffiliationPlanner(context)
  await runCorporationRolePlanner(context)
  await repairPlatformCollectionState({ signal })
  await runInstalledResourceMaintenance({ signal })
  await runResourcePlanner(context)
  await repairOrganizationCompliance({ signal })
}

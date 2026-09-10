import { selectDueOrganizationOwnerEvidence } from '../organization/owner-evidence.js'
import type { QueuePlanningContext } from './planning-context.js'

export async function runOrganizationOwnerEvidencePlanner(context: QueuePlanningContext) {
  const { producer, signal } = context
  const due = await selectDueOrganizationOwnerEvidence()
  let planned = 0
  for (const { grantId } of due) {
    signal?.throwIfAborted()
    const payload = { operationId: organizationOwnerEvidenceJobId(grantId), grantId }
    // oxlint-disable-next-line no-await-in-loop
    const admission = await producer.enqueue(
      {
        name: 'organization-owner-evidence',
        payload,
        source: 'planner',
      },
      { signal },
    )
    if (admission.status === 'rejected') {
      if (admission.reason === 'coalesced') continue
      return { planned, reason: admission.reason }
    }
    planned += 1
  }
  return { planned, reason: planned === 0 ? ('idle' as const) : ('scheduled' as const) }
}

export function organizationOwnerEvidenceJobId(grantId: string) {
  return `organization-owner-evidence-${grantId}`
}

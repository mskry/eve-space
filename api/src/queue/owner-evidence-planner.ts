import type { Queue } from 'bullmq'
import { selectDueOrganizationOwnerEvidence } from '../organization/owner-evidence.js'
import { admitQueueWork } from './admission.js'
import { getJobDefinition, jobOptions, type JobDefinition } from './job-registry.js'

export async function runOrganizationOwnerEvidencePlanner(
  queue: Queue,
  signal?: AbortSignal,
  selectDue = selectDueOrganizationOwnerEvidence,
) {
  const due = await selectDue()
  const definition = getJobDefinition('organization-owner-evidence') as JobDefinition<{
    operationId: string
    grantId: string
  }>
  let planned = 0
  for (const { grantId } of due) {
    signal?.throwIfAborted()
    const payload = { operationId: organizationOwnerEvidenceJobId(grantId), grantId }
    // oxlint-disable-next-line no-await-in-loop
    const admission = await admitQueueWork(queue, definition.operationIdentity(payload), 'planner')
    if (!admission.admitted) {
      if (admission.reason === 'coalesced') continue
      return { planned, reason: admission.reason }
    }
    signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop
    await queue.add(definition.name, payload, jobOptions(definition))
    planned += 1
  }
  return { planned, reason: planned === 0 ? ('idle' as const) : ('scheduled' as const) }
}

export function organizationOwnerEvidenceJobId(grantId: string) {
  return `organization-owner-evidence-${grantId}`
}

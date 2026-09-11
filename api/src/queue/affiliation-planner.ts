import { randomUUID } from 'node:crypto'
import { affiliationCooldownActive } from '../characters/affiliation-planning.js'
import {
  affiliationOperationIdentity,
  partitionAffiliationCharacterIds,
  selectDueAffiliationCharacterIds,
} from '../characters/affiliation-sync.js'
import type { AffiliationPlannerOutcome } from './outcomes.js'
import type { QueuePlanningContext } from './planning-context.js'

type AffiliationPlannerOutcomeKind = AffiliationPlannerOutcome['outcome']

export async function runAffiliationPlanner(context: QueuePlanningContext) {
  const { producer, outcomes, signal } = context
  let planned = 0
  try {
    signal?.throwIfAborted()
    if (await affiliationCooldownActive()) {
      signal?.throwIfAborted()
      await producer.pausePlanner()
      await recordAffiliationPlannerOutcome(outcomes, 'cooldown', planned)
      return { planned, reason: 'cooldown' as const }
    }

    const due = await selectDueAffiliationCharacterIds()
    signal?.throwIfAborted()
    const characterIds = due
      .map((character) => character.characterId)
      .toSorted((left, right) => left - right)
    const refreshId = randomUUID()
    for (const batch of partitionAffiliationCharacterIds(characterIds)) {
      signal?.throwIfAborted()
      const payload = {
        operationId: affiliationOperationIdentity(batch, refreshId),
        characterIds: batch,
      }
      // oxlint-disable-next-line no-await-in-loop
      const admission = await producer.enqueue(
        { name: 'affiliation', payload, source: 'planner' },
        { signal },
      )
      if (admission.status === 'rejected') {
        // oxlint-disable-next-line no-await-in-loop
        await recordAffiliationPlannerOutcome(
          outcomes,
          admission.reason === 'coalesced' ? 'coalesced' : 'paused',
          planned,
        )
        return { planned, reason: admission.reason }
      }
      planned += 1
    }
    if (planned === 0) await producer.resumePlanner()
    await recordAffiliationPlannerOutcome(outcomes, planned === 0 ? 'idle' : 'scheduled', planned)
    return { planned, reason: 'scheduled' as const }
  } catch (error) {
    signal?.throwIfAborted()
    await recordAffiliationPlannerOutcome(outcomes, 'failed', planned)
    throw error
  }
}

async function recordAffiliationPlannerOutcome(
  recorder: QueuePlanningContext['outcomes'],
  outcome: AffiliationPlannerOutcomeKind,
  planned: number,
) {
  await recorder
    .recordAffiliation({ outcome, planned, recordedAt: new Date().toISOString() })
    .catch(() => {})
}

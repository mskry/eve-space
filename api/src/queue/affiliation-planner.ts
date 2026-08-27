import { randomUUID } from 'node:crypto'
import type { Queue } from 'bullmq'
import { acquireEsiRequestPermit, EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { getCoordinationConnection } from '../esi-resilience/transport.js'
import { env } from '../env.js'
import {
  affiliationOperationIdentity,
  partitionAffiliationCharacterIds,
  selectDueAffiliationCharacterIds,
} from '../affiliation-sync.js'
import { admitQueueWork } from './admission.js'
import { getJobDefinition, jobOptions, type JobDefinition } from './job-registry.js'
import { affiliationPlannerOutcomeKey, plannerStateKey } from './namespaces.js'

type AffiliationPlannerOutcome =
  | 'scheduled'
  | 'idle'
  | 'cooldown'
  | 'paused'
  | 'coalesced'
  | 'failed'

interface AffiliationPlannerOptions {
  readonly dependencies?: {
    cooldownActive?: () => Promise<boolean>
    selectDue?: typeof selectDueAffiliationCharacterIds
  }
}

export async function runAffiliationPlanner(
  queue: Queue,
  signal?: AbortSignal,
  options: AffiliationPlannerOptions = {},
) {
  const dependencies = options.dependencies ?? {}
  let planned = 0
  try {
    signal?.throwIfAborted()
    if (await (dependencies.cooldownActive ?? affiliationCooldownActive)()) {
      await queue
        .getBackend()
        .client.then((connection) => connection.set(plannerStateKey, 'paused'))
      await recordAffiliationPlannerOutcome(queue, 'cooldown', planned)
      return { planned, reason: 'cooldown' as const }
    }

    const due = await (dependencies.selectDue ?? selectDueAffiliationCharacterIds)()
    const definition = getJobDefinition('affiliation') as JobDefinition<{
      operationId: string
      characterIds: number[]
    }>
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
      const admission = await admitQueueWork(
        queue,
        definition.operationIdentity(payload),
        'planner',
      )
      if (!admission.admitted) {
        // oxlint-disable-next-line no-await-in-loop
        await recordAffiliationPlannerOutcome(
          queue,
          admission.reason === 'coalesced' ? 'coalesced' : 'paused',
          planned,
        )
        return { planned, reason: admission.reason }
      }
      signal?.throwIfAborted()
      // oxlint-disable-next-line no-await-in-loop
      await queue.add(
        definition.name,
        payload,
        jobOptions(definition, definition.operationIdentity(payload)),
      )
      planned += 1
    }
    if (planned === 0)
      await queue.getBackend().client.then((connection) => connection.del(plannerStateKey))
    await recordAffiliationPlannerOutcome(queue, planned === 0 ? 'idle' : 'scheduled', planned)
    return { planned, reason: 'scheduled' as const }
  } catch (error) {
    await recordAffiliationPlannerOutcome(queue, 'failed', planned)
    throw error
  }
}

async function affiliationCooldownActive() {
  try {
    const permit = await acquireEsiRequestPermit({
      connection: getCoordinationConnection(),
      operation: 'bulk-affiliation',
      concurrency: env.ESI_OPERATION_CONCURRENCY,
    })
    await permit.release()
    return false
  } catch (error) {
    if (error instanceof EsiQuotaError) return true
    throw error
  }
}

async function recordAffiliationPlannerOutcome(
  queue: Queue,
  outcome: AffiliationPlannerOutcome,
  planned: number,
) {
  const value = JSON.stringify({ outcome, planned, recordedAt: new Date().toISOString() })
  await queue
    .getBackend()
    .client.then((connection) => connection.set(affiliationPlannerOutcomeKey, value))
    .catch(() => {})
}

import { resolveJobContract, type JobPayloadByName } from './job-contracts.js'

export type QueueSource = 'planner' | 'on-demand' | 'outbox'

export type QueueCommand =
  | {
      readonly name: 'diagnostic'
      readonly payload: JobPayloadByName['diagnostic']
      readonly source: 'planner' | 'on-demand'
    }
  | {
      readonly name: 'domain-event'
      readonly payload: JobPayloadByName['domain-event']
      readonly source: 'outbox'
    }
  | {
      readonly name: 'affiliation'
      readonly payload: JobPayloadByName['affiliation']
      readonly source: 'planner'
    }
  | {
      readonly name: 'corporation-role-observation'
      readonly payload: JobPayloadByName['corporation-role-observation']
      readonly source: 'planner'
      readonly notBefore: Date
    }
  | {
      readonly name: 'alliance-executor-observation'
      readonly payload: JobPayloadByName['alliance-executor-observation']
      readonly source: 'planner'
      readonly notBefore: Date
    }
  | {
      readonly name: 'rule-group-reconciliation'
      readonly payload: JobPayloadByName['rule-group-reconciliation']
      readonly source: 'planner'
    }
  | {
      readonly name: 'resource-refresh'
      readonly payload: JobPayloadByName['resource-refresh']
      readonly source: 'planner' | 'on-demand'
      readonly materializationIntervalSeconds: number
    }
  | {
      readonly name: 'resource-batch'
      readonly payload: JobPayloadByName['resource-batch']
      readonly source: 'planner'
      readonly materializationIntervalSeconds: number
    }

export interface QueueCapacityQuery {
  readonly source: QueueSource
  readonly highWaterMark?: number
  readonly preservePausedState?: boolean
}

export type QueueCapacityResult =
  | {
      readonly status: 'accepted'
      readonly depth: number
      readonly remainingCapacity: number
    }
  | {
      readonly status: 'rejected'
      readonly depth: number
      readonly remainingCapacity: 0
      readonly reason: 'planner-paused' | 'outbox-paused' | 'on-demand-rejected'
    }

export type QueueProducerResult =
  | { readonly status: 'accepted'; readonly depth: number }
  | {
      readonly status: 'rejected'
      readonly depth: number
      readonly reason: 'planner-paused' | 'outbox-paused' | 'on-demand-rejected' | 'coalesced'
    }

interface QueuePublicationOptions {
  readonly signal?: AbortSignal
  readonly preservePausedState?: boolean
}

export interface QueueProducer {
  inspectCapacity(query: QueueCapacityQuery): Promise<QueueCapacityResult>
  enqueue(command: QueueCommand, options?: QueuePublicationOptions): Promise<QueueProducerResult>
  enqueueMany(
    commands: readonly QueueCommand[],
    options?: QueuePublicationOptions,
  ): Promise<readonly QueueProducerResult[]>
  pausePlanner(): Promise<void>
  resumePlanner(): Promise<void>
}

export interface InMemoryQueueProducer extends QueueProducer {
  readonly commands: readonly QueueCommand[]
  readonly plannerPaused: boolean
  setDepth(depth: number): void
  release(identity: string): void
}

export function createInMemoryQueueProducer(
  configuration: {
    readonly highWaterMark?: number
    readonly depth?: number
  } = {},
): InMemoryQueueProducer {
  const highWaterMark = configuration.highWaterMark ?? Number.MAX_SAFE_INTEGER
  let depth = configuration.depth ?? 0
  let plannerPaused = false
  const commands: QueueCommand[] = []
  const activeIdentities = new Set<string>()
  return {
    commands,
    async enqueue(command, publication) {
      const [result] = await this.enqueueMany([command], publication)
      return result!
    },
    async enqueueMany(pending, publication) {
      publication?.signal?.throwIfAborted()
      const results: QueueProducerResult[] = []
      for (const command of pending) {
        // oxlint-disable-next-line no-await-in-loop -- depth and coalescing change per command.
        const capacity = await this.inspectCapacity({
          source: command.source,
          preservePausedState: publication?.preservePausedState,
        })
        publication?.signal?.throwIfAborted()
        if (capacity.status === 'rejected') {
          results.push(capacity)
          continue
        }
        const identity = inMemoryIdentity(command)
        if (identity && activeIdentities.has(identity)) {
          results.push({ status: 'rejected', depth, reason: 'coalesced' })
          continue
        }
        if (identity) {
          activeIdentities.add(identity)
        }
        publication?.signal?.throwIfAborted()
        commands.push(command)
        results.push({ status: 'accepted', depth })
        depth += 1
      }
      return results
    },
    async inspectCapacity(query) {
      const maximum = query.highWaterMark ?? highWaterMark
      const remainingCapacity = Math.max(0, maximum - depth)
      if (remainingCapacity > 0) {
        if (query.source === 'planner' && !query.preservePausedState) {
          plannerPaused = false
        }
        return { status: 'accepted', depth, remainingCapacity }
      }
      if (query.source === 'planner') {
        plannerPaused = true
      }
      return {
        status: 'rejected',
        depth,
        remainingCapacity: 0,
        reason: rejectionReason(query.source),
      }
    },
    async pausePlanner() {
      plannerPaused = true
    },
    get plannerPaused() {
      return plannerPaused
    },
    release(identity) {
      activeIdentities.delete(identity)
    },
    async resumePlanner() {
      plannerPaused = false
    },
    setDepth(value) {
      depth = value
    },
  }
}

export function rejectionReason(source: QueueSource) {
  if (source === 'planner') {
    return 'planner-paused' as const
  }
  if (source === 'outbox') {
    return 'outbox-paused' as const
  }
  return 'on-demand-rejected' as const
}

function inMemoryIdentity(command: QueueCommand) {
  if (command.name === 'diagnostic' && command.source === 'on-demand') {
    return
  }
  const resolved = resolveJobContract(command.name, command.payload)
  if (resolved.contract.activeWorkDeduplication === 'none') {
    return
  }
  return `${command.name}:${resolved.operationIdentity}`
}

import type { JobsOptions } from 'bullmq'
import { env } from '../env.js'
import { getJobContract, resolveJobContract, type JobName } from './job-contracts.js'
import { outboxRelayStateKey, plannerStateKey } from './namespaces.js'
import { createOperationsQueueHandle, type OperationsQueueHandle } from './operations-queue.js'
import { resourceRefreshPriority } from './policy.js'
import {
  rejectionReason,
  type QueueCapacityQuery,
  type QueueCapacityResult,
  type QueueCommand,
  type QueueProducer,
  type QueueProducerResult,
} from './producer.js'

export interface BullMqQueueProducer extends QueueProducer {
  close(): Promise<void>
}

type ResolvedQueueCommand = {
  readonly command: QueueCommand
  readonly contract: ReturnType<typeof getJobContract<JobName>>
  readonly identity: string
}

type CoalescingLookup = {
  readonly commandIndex: number
  readonly kind: 'job-id' | 'simple'
  readonly key: string
}

export function createBullMqQueueProducer(
  configuration: {
    readonly handle?: OperationsQueueHandle
    readonly highWaterMark?: number
    readonly plannerDelay?: () => Promise<number>
  } = {},
): BullMqQueueProducer {
  const handle = configuration.handle ?? createOperationsQueueHandle()
  const ownsHandle = !configuration.handle
  const highWaterMark = configuration.highWaterMark ?? env.QUEUE_HIGH_WATER_MARK
  const plannerDelay = configuration.plannerDelay ?? (() => Promise.resolve(0))

  const producer: BullMqQueueProducer = {
    close: () => (ownsHandle ? handle.close() : Promise.resolve()),
    pausePlanner: async () =>
      handle.connection.set(plannerStateKey, 'paused').then(() => undefined),
    resumePlanner: async () => handle.connection.del(plannerStateKey).then(() => undefined),
    inspectCapacity: (query) => inspectCapacity(handle, query, highWaterMark),
    async enqueue(command, publication) {
      const [result] = await producer.enqueueMany([command], publication)
      return result!
    },
    async enqueueMany(commands, publication) {
      publication?.signal?.throwIfAborted()
      if (commands.length === 0) return []
      const capacity = await inspectBatchCapacity(
        handle,
        commands,
        highWaterMark,
        publication?.preservePausedState,
      )
      publication?.signal?.throwIfAborted()
      const prepared =
        capacity.remainingCapacity > 0
          ? await prepareCommands(handle, commands, plannerDelay, publication?.signal)
          : []
      const results: QueueProducerResult[] = []
      const accepted: Array<{ command: QueueCommand; deliveryOptions: JobsOptions }> = []
      for (const [index, command] of commands.entries()) {
        if (accepted.length >= capacity.remainingCapacity) {
          results.push({
            status: 'rejected',
            depth: capacity.depth + accepted.length,
            reason: rejectionReason(command.source),
          })
          continue
        }
        const deliveryOptions = prepared[index]
        if (!deliveryOptions) {
          results.push({ status: 'rejected', depth: capacity.depth, reason: 'coalesced' })
          continue
        }
        accepted.push({ command, deliveryOptions })
        results.push({ status: 'accepted', depth: capacity.depth + accepted.length - 1 })
      }
      publication?.signal?.throwIfAborted()
      if (accepted.length > 0)
        await handle.queue.addBulk(
          accepted.map(({ command, deliveryOptions }) => ({
            name: command.name,
            data: command.payload,
            opts: deliveryOptions,
          })),
        )
      return results
    },
  }
  return producer
}

async function inspectCapacity(
  handle: OperationsQueueHandle,
  query: QueueCapacityQuery,
  defaultHighWaterMark: number,
): Promise<QueueCapacityResult> {
  const capacity = await readCapacity(handle, query.highWaterMark ?? defaultHighWaterMark)
  await updateCapacityState(
    handle,
    query.source,
    capacity.remainingCapacity,
    query.preservePausedState,
  )
  if (capacity.remainingCapacity === 0)
    return {
      ...capacity,
      remainingCapacity: 0,
      status: 'rejected',
      reason: rejectionReason(query.source),
    }
  return { ...capacity, status: 'accepted' }
}

async function inspectBatchCapacity(
  handle: OperationsQueueHandle,
  commands: readonly QueueCommand[],
  highWaterMark: number,
  preservePausedState?: boolean,
) {
  const capacity = await readCapacity(handle, highWaterMark)
  await Promise.all(
    [...new Set(commands.map(({ source }) => source))].map((source) =>
      updateCapacityState(handle, source, capacity.remainingCapacity, preservePausedState),
    ),
  )
  return capacity
}

async function readCapacity(handle: OperationsQueueHandle, highWaterMark: number) {
  const counts = await handle.queue.getJobCounts('waiting', 'delayed', 'prioritized')
  const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0)
  return { depth, remainingCapacity: Math.max(0, highWaterMark - depth) }
}

async function updateCapacityState(
  handle: OperationsQueueHandle,
  source: QueueCommand['source'],
  remainingCapacity: number,
  preservePausedState?: boolean,
) {
  if (source === 'on-demand') return
  const stateKey = source === 'planner' ? plannerStateKey : outboxRelayStateKey
  if (remainingCapacity === 0) {
    await handle.connection.set(stateKey, 'paused')
    return
  }
  if (!preservePausedState) await handle.connection.del(stateKey)
}

async function prepareCommands(
  handle: OperationsQueueHandle,
  commands: readonly QueueCommand[],
  plannerDelay: () => Promise<number>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const resolved: ResolvedQueueCommand[] = commands.map((command) => {
    const { contract, operationIdentity: identity } = resolveJobContract(
      command.name,
      command.payload,
    )
    return { command, contract, identity }
  })
  const coalesced = await findCoalescedCommands(handle, resolved)
  signal?.throwIfAborted()
  return Promise.all(
    resolved.map(({ command, contract, identity }, index) =>
      coalesced[index]
        ? Promise.resolve(null)
        : prepareDeliveryOptions(command, contract, identity, plannerDelay, signal),
    ),
  )
}

async function prepareDeliveryOptions(
  command: QueueCommand,
  contract: ReturnType<typeof getJobContract<JobName>>,
  identity: string,
  plannerDelay: () => Promise<number>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const delay =
    command.source === 'planner' && contract.delay === 'planner-stagger' ? await plannerDelay() : 0
  signal?.throwIfAborted()
  return {
    attempts: contract.attempts,
    backoff: { type: 'exponential' as const, delay: 1_000, jitter: 0.25 },
    removeOnComplete: contract.retention.completed,
    removeOnFail: contract.retention.failed,
    ...(contract.activeWorkDeduplication === 'job-id' ? { jobId: identity } : {}),
    ...(usesSimpleDeduplication(command, contract.activeWorkDeduplication)
      ? { deduplication: { id: identity } }
      : {}),
    ...(delay > 0 ? { delay } : {}),
    ...(contract.priority === 'resource'
      ? {
          priority: resourceRefreshPriority(
            (command as Extract<QueueCommand, { name: 'resource-refresh' | 'resource-batch' }>)
              .materializationIntervalSeconds,
          ),
        }
      : {}),
  } satisfies JobsOptions
}

async function findCoalescedCommands(
  handle: OperationsQueueHandle,
  commands: readonly ResolvedQueueCommand[],
) {
  const lookups = commands
    .map((command, commandIndex) => createCoalescingLookup(handle, command, commandIndex))
    .filter((lookup): lookup is CoalescingLookup => lookup !== undefined)
  if (lookups.length === 0) return commands.map(() => false)

  const pipeline = handle.connection.pipeline()
  for (const lookup of lookups) enqueueCoalescingLookup(pipeline, lookup)
  const responses = await pipeline.exec()
  if (responses?.length !== lookups.length)
    throw new Error('Queue deduplication batch returned an invalid response')

  const coalesced = commands.map(() => false)
  for (const [index, [error, value]] of responses.entries()) {
    if (error) throw error
    const lookup = lookups[index]!
    coalesced[lookup.commandIndex] = isLookupCoalesced(lookup, value)
  }
  return coalesced
}

function createCoalescingLookup(
  handle: OperationsQueueHandle,
  { command, contract, identity }: ResolvedQueueCommand,
  commandIndex: number,
): CoalescingLookup | undefined {
  if (contract.activeWorkDeduplication === 'job-id') {
    if (command.name === 'domain-event') return
    return { commandIndex, kind: 'job-id', key: handle.queue.toKey(identity) }
  }
  if (!usesSimpleDeduplication(command, contract.activeWorkDeduplication)) return
  return {
    commandIndex,
    kind: 'simple',
    key: `${handle.queue.toKey('de')}:${identity}`,
  }
}

function enqueueCoalescingLookup(
  pipeline: ReturnType<OperationsQueueHandle['connection']['pipeline']>,
  lookup: CoalescingLookup,
) {
  if (lookup.kind === 'job-id') {
    pipeline.exists(lookup.key)
    return
  }
  pipeline.get(lookup.key)
}

function isLookupCoalesced(lookup: CoalescingLookup, value: unknown) {
  return lookup.kind === 'job-id' ? value === 1 : value !== null
}

function usesSimpleDeduplication(
  command: QueueCommand,
  policy: ReturnType<typeof getJobContract<JobName>>['activeWorkDeduplication'],
) {
  return policy === 'simple' || (policy === 'planner-simple' && command.source === 'planner')
}

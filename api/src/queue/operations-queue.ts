import { Queue, type RepeatStrategy } from 'bullmq'
import {
  closeCoordinationRedisConnection,
  createCoordinationRedisConnection,
  type CoordinationRedisConnection,
} from '../coordination-redis.js'
import { operationsQueueName, queuePrefix } from './namespaces.js'

export interface OperationsQueueHandle {
  readonly queue: Queue
  readonly connection: CoordinationRedisConnection
  close(): Promise<void>
  disconnect(): void
}

export function createOperationsQueueHandle(
  options: {
    readonly connection?: CoordinationRedisConnection
    readonly repeatStrategy?: RepeatStrategy
  } = {},
): OperationsQueueHandle {
  const connection = options.connection ?? createCoordinationRedisConnection()
  const queue = new Queue(operationsQueueName, {
    connection,
    prefix: queuePrefix,
    ...(options.repeatStrategy ? { settings: { repeatStrategy: options.repeatStrategy } } : {}),
    skipWaitingForReady: true,
  })
  let closing: Promise<void> | undefined
  return {
    queue,
    connection,
    close() {
      closing ??= Promise.allSettled([
        queue.close(),
        closeCoordinationRedisConnection(connection),
      ]).then(() => undefined)
      return closing
    },
    disconnect() {
      connection.disconnect()
      void queue.disconnect().catch(() => {})
    },
  }
}

export const queuePrefix = 'eve-space:v1'
export const operationsQueueName = 'operations'
const workerHeartbeatPrefix = `${queuePrefix}:worker:heartbeat`
export const workerRegistryKey = `${queuePrefix}:worker:registry`
export const workerHeartbeatKey = (workerId: string) => `${workerHeartbeatPrefix}:${workerId}`
export const plannerStateKey = `${queuePrefix}:planner:state`
export const schedulerOutcomeKey = `${queuePrefix}:scheduler:outcome`
export const schedulerLockKey = (schedulerId: string) =>
  `${queuePrefix}:scheduler:${schedulerId}:lock`

export const queueNamespaces = [
  `${queuePrefix}:${operationsQueueName}:*`,
  `${workerHeartbeatPrefix}:*`,
  workerRegistryKey,
  plannerStateKey,
  schedulerOutcomeKey,
  `${queuePrefix}:scheduler:*:lock`,
] as const

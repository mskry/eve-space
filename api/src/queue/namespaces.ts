export const queuePrefix = 'eve-space:v1'
export const operationsQueueName = 'operations'
const workerHeartbeatPrefix = `${queuePrefix}:worker:heartbeat`
export const workerRegistryKey = `${queuePrefix}:worker:registry`
export const workerHeartbeatKey = (workerId: string) => `${workerHeartbeatPrefix}:${workerId}`
export const plannerStateKey = `${queuePrefix}:planner:state`
export const outboxRelayStateKey = `${queuePrefix}:outbox-relay:state`
export const outboxRelayOutcomeKey = `${queuePrefix}:outbox-relay:outcome`
export const schedulerOutcomeKey = `${queuePrefix}:scheduler:outcome`
export const affiliationPlannerOutcomeKey = `${queuePrefix}:planner:affiliation:outcome`
export const schedulerLockKey = (schedulerId: string) =>
  `${queuePrefix}:scheduler:${schedulerId}:lock`

export const queueNamespaces = [
  `${queuePrefix}:${operationsQueueName}:*`,
  `${workerHeartbeatPrefix}:*`,
  workerRegistryKey,
  plannerStateKey,
  outboxRelayStateKey,
  outboxRelayOutcomeKey,
  schedulerOutcomeKey,
  affiliationPlannerOutcomeKey,
  `${queuePrefix}:scheduler:*:lock`,
] as const

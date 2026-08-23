import type { QueueRedisConnection } from './redis.js'
import { schedulerOutcomeKey, workerHeartbeatKey, workerRegistryKey } from './namespaces.js'
import { workerHeartbeatIntervalMs, workerHeartbeatTtlSeconds } from './policy.js'
import { workerId as localWorkerId } from './worker-identity.js'

export function createActiveJobTracker() {
  let activeJobs = 0
  const idleWaiters = new Set<() => void>()

  return {
    async run<T>(operation: () => Promise<T>) {
      activeJobs += 1
      try {
        return await operation()
      } finally {
        activeJobs -= 1
        if (activeJobs === 0) {
          for (const resolve of idleWaiters) resolve()
          idleWaiters.clear()
        }
      }
    },
    waitForIdle(timeoutMs: number) {
      if (activeJobs === 0) return Promise.resolve(true)
      return new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout>
        const onIdle = () => {
          clearTimeout(timer)
          resolve(true)
        }
        timer = setTimeout(() => {
          idleWaiters.delete(onIdle)
          resolve(false)
        }, timeoutMs)
        idleWaiters.add(onIdle)
      })
    },
  }
}

export async function startWorkerHeartbeat(
  connection: QueueRedisConnection,
  workerId = localWorkerId,
) {
  const key = workerHeartbeatKey(workerId)
  const write = async () => {
    // Beat before registry entry, so a pruning replica never sees a registered id with no beat.
    await connection.set(key, new Date().toISOString(), 'EX', workerHeartbeatTtlSeconds)
    await connection.sadd(workerRegistryKey, workerId)
    await connection.set(schedulerOutcomeKey, 'registered', 'EX', workerHeartbeatTtlSeconds)
    await pruneWorkerRegistry(connection)
  }
  await write()
  const interval = setInterval(() => {
    void write().catch(() => console.error('Worker heartbeat update failed'))
  }, workerHeartbeatIntervalMs)
  return () => clearInterval(interval)
}

/** Drops expired replicas; every deployment adds a hostname, so the registry would grow forever. */
async function pruneWorkerRegistry(connection: QueueRedisConnection) {
  const registered = await connection.smembers(workerRegistryKey)
  if (registered.length === 0) return
  const beats = await connection.mget(registered.map(workerHeartbeatKey))
  const expired = registered.filter((_, index) => beats[index] === null)
  if (expired.length > 0) await connection.srem(workerRegistryKey, expired)
}

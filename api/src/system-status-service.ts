import { createStatusClient } from '@evespace/esi-client/domains/status'
import { sql } from './db/client.js'
import { esiFetch } from './esi-fetch.js'
import { esiErrorBudgetFloor } from './esi-policy.js'
import { probeQueueStatus, type QueueStatus } from './queue/status.js'

const cacheTtlMs = 30_000
const esiClient = createStatusClient({ fetch: esiFetch }).withMetadata()

type SystemStatusState = 'operational' | 'degraded' | 'unavailable' | 'stale'

interface DatabaseStatus {
  status: 'operational' | 'unavailable'
  latencyMs: number
}

interface EsiStatus {
  status: SystemStatusState
  latencyMs: number
  checkedAt: string
  players: number | null
  serverVersion: string | null
  startedAt: string | null
  vip: boolean | null
  errorBudgetRemaining: number | null
  errorBudgetResetSeconds: number | null
}

export interface SystemStatus {
  status: Exclude<SystemStatusState, 'stale'>
  checkedAt: string
  cachedUntil: string
  services: {
    api: {
      status: 'operational'
      uptimeSeconds: number
    }
    database: DatabaseStatus
    esi: EsiStatus
    queue: QueueStatus
  }
}

let cache: SystemStatus | undefined
let inFlight: Promise<SystemStatus> | undefined
let lastSuccessfulEsi: EsiStatus | undefined

export function getSystemStatus() {
  const now = Date.now()
  if (cache && Date.parse(cache.cachedUntil) > now) return Promise.resolve(cache)
  if (inFlight) return inFlight

  inFlight = probeSystemStatus(now).finally(() => {
    inFlight = undefined
  })
  return inFlight
}

async function probeSystemStatus(now: number): Promise<SystemStatus> {
  const [database, esi, queue] = await Promise.all([
    probeDatabase(),
    probeEsi(),
    probeQueueStatus(),
  ])
  const unavailableCount =
    Number(database.status === 'unavailable') + Number(esi.status === 'unavailable')
  const status =
    unavailableCount === 2
      ? 'unavailable'
      : database.status === 'operational' &&
          esi.status === 'operational' &&
          queue.status === 'operational'
        ? 'operational'
        : 'degraded'

  cache = {
    status,
    checkedAt: new Date(now).toISOString(),
    cachedUntil: new Date(now + cacheTtlMs).toISOString(),
    services: {
      api: {
        status: 'operational',
        uptimeSeconds: Math.floor(process.uptime()),
      },
      database,
      esi,
      queue,
    },
  }
  return cache
}

async function probeDatabase(): Promise<DatabaseStatus> {
  const startedAt = Date.now()
  try {
    await sql`select 1`
    return { status: 'operational', latencyMs: Date.now() - startedAt }
  } catch {
    return { status: 'unavailable', latencyMs: Date.now() - startedAt }
  }
}

async function probeEsi(): Promise<EsiStatus> {
  const startedAt = Date.now()
  const checkedAt = new Date(startedAt).toISOString()

  try {
    const response = await esiClient.get()
    const errorBudgetRemaining = response.meta.errorLimit?.remaining ?? null
    const status: EsiStatus = {
      status:
        response.data.vip ||
        response.data.players === 0 ||
        (errorBudgetRemaining !== null && errorBudgetRemaining <= esiErrorBudgetFloor)
          ? 'degraded'
          : 'operational',
      latencyMs: Date.now() - startedAt,
      checkedAt,
      players: response.data.players,
      serverVersion: response.data.server_version,
      startedAt: response.data.start_time,
      vip: response.data.vip,
      errorBudgetRemaining,
      errorBudgetResetSeconds: response.meta.errorLimit?.reset ?? null,
    }
    lastSuccessfulEsi = status
    return status
  } catch {
    if (lastSuccessfulEsi) {
      return {
        ...lastSuccessfulEsi,
        status: 'stale',
        latencyMs: Date.now() - startedAt,
      }
    }

    return {
      status: 'unavailable',
      latencyMs: Date.now() - startedAt,
      checkedAt,
      players: null,
      serverVersion: null,
      startedAt: null,
      vip: null,
      errorBudgetRemaining: null,
      errorBudgetResetSeconds: null,
    }
  }
}

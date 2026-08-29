import { createStatusClient } from '@evespace/esi-client/domains/status'
import { sql } from './db/client.js'
import { probeDomainEventStatus, type DomainEventStatus } from './domain-event-status.js'
import { esiErrorBudgetFloor } from './esi-policy.js'
import { getEsiResilienceLayer } from './esi-resilience/resilience.js'
import {
  probeEsiResilienceTelemetry,
  type EsiResilienceTelemetry,
} from './esi-resilience/telemetry.js'
import { createEsiTransport } from './esi-resilience/transport.js'
import { probeQueueStatus, type QueueStatus } from './queue/status.js'

const cacheTtlMs = 30_000

let localStatus: { value: SystemStatus; expiresAt: number } | undefined
let statusProbe: Promise<SystemStatus> | undefined

type SystemStatusState = 'operational' | 'degraded' | 'unavailable' | 'stale'

interface DatabaseStatus {
  status: 'operational' | 'unavailable'
  latencyMs: number
  checkedAt: string
}

interface EsiStatus {
  status: SystemStatusState
  latencyMs: number
  checkedAt: string
  cachedUntil: string
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
      checkedAt: string
    }
    database: DatabaseStatus
    esi: EsiStatus
    queue: QueueStatus & { checkedAt: string }
    eventRelay: DomainEventStatus & { checkedAt: string }
    esiResilience: EsiResilienceTelemetry
  }
}

export function getSystemStatus() {
  const now = Date.now()
  if (localStatus && localStatus.expiresAt > now) return Promise.resolve(localStatus.value)
  statusProbe ??= probeSystemStatus(now)
    .then((value) => {
      localStatus = { value, expiresAt: now + cacheTtlMs }
      return value
    })
    .finally(() => {
      statusProbe = undefined
    })
  return statusProbe
}

async function probeSystemStatus(now: number): Promise<SystemStatus> {
  const [database, esi, queue, esiResilience] = await Promise.all([
    probeDatabase(),
    probeEsi(),
    probeQueueStatus(),
    probeEsiResilienceTelemetry(),
  ])
  const eventRelay = await probeDomainEventStatus(queue)
  const unavailableCount =
    Number(database.status === 'unavailable') + Number(esi.status === 'unavailable')
  let status: SystemStatus['status'] = 'degraded'
  if (unavailableCount === 2) status = 'unavailable'
  else if (
    database.status === 'operational' &&
    esi.status === 'operational' &&
    queue.status === 'operational' &&
    eventRelay.status === 'operational' &&
    esiResilience.cache.status === 'operational' &&
    esiResilience.coordination.status === 'operational' &&
    esiResilience.cooldown.status === 'inactive' &&
    esiResilience.upstream.status === 'operational'
  )
    status = 'operational'

  const cachedUntil = Math.min(now + cacheTtlMs, Date.parse(esi.cachedUntil))
  return {
    status,
    checkedAt: new Date(now).toISOString(),
    cachedUntil: new Date(cachedUntil).toISOString(),
    services: {
      api: {
        status: 'operational',
        uptimeSeconds: Math.floor(process.uptime()),
        checkedAt: new Date(now).toISOString(),
      },
      database,
      esi,
      queue: { ...queue, checkedAt: new Date(now).toISOString() },
      eventRelay: { ...eventRelay, checkedAt: new Date(now).toISOString() },
      esiResilience,
    },
  }
}

async function probeDatabase(): Promise<DatabaseStatus> {
  const startedAt = Date.now()
  const checkedAt = new Date(startedAt).toISOString()
  try {
    await sql`select 1`
    return { status: 'operational', latencyMs: Date.now() - startedAt, checkedAt }
  } catch {
    return { status: 'unavailable', latencyMs: Date.now() - startedAt, checkedAt }
  }
}

async function probeEsi(): Promise<EsiStatus> {
  const startedAt = Date.now()
  const checkedAt = new Date(startedAt).toISOString()

  try {
    const response = await getEsiResilienceLayer().getPublic({
      operation: 'status',
      inputs: {},
      load: (revalidation) =>
        createStatusClient({ fetch: createEsiTransport('status') })
          .withMetadata()
          .get(revalidation),
    })
    const errorBudgetRemaining = response.quota.errorRemaining ?? null
    let status: EsiStatus['status'] = 'operational'
    if (response.stale) status = 'stale'
    else if (
      response.data.vip ||
      response.data.players === 0 ||
      (errorBudgetRemaining !== null && errorBudgetRemaining <= esiErrorBudgetFloor)
    )
      status = 'degraded'
    return {
      status,
      latencyMs: Date.now() - startedAt,
      checkedAt: response.validatedAt,
      players: response.data.players,
      serverVersion: response.data.server_version,
      startedAt: response.data.start_time,
      vip: response.data.vip,
      errorBudgetRemaining,
      errorBudgetResetSeconds: response.quota.errorResetSeconds ?? null,
      cachedUntil: response.cachedUntil,
    }
  } catch {
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
      cachedUntil: new Date(startedAt + cacheTtlMs).toISOString(),
    }
  }
}

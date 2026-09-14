import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { LogLayer, StructuredTransport, type LogLevelType } from 'loglayer'
import { containsSensitiveText } from './sensitive-data.js'

const maximumRequestPathLength = 2_048
const maximumDiagnosticIdentifierLength = 100
const diagnosticIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/
const correlationIdentifierPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const diagnosticFailureCategories = [
  'dependency-unavailable',
  'healthcheck-failure',
  'invalid-event',
  'migration-failure',
  'module-failure',
  'permanent job failure',
  'processing-failure',
  'persistence-failure',
  'queue-rejected',
  'queue-unavailable',
  'retryable dependency failure',
  'shutdown-failure',
  'shutdown-timeout',
  'startup-failure',
  'unexpected-failure',
  'unknown',
] as const

type DiagnosticFailureCategory = (typeof diagnosticFailureCategories)[number]
type DiagnosticContextKey = keyof DiagnosticContext

const diagnosticCatalog = {
  'api.request.failed': diagnostic('error', ['method', 'path'], 'unexpected-failure'),
  'api.runtime.started': diagnostic('info', ['port']),
  'api.server.failed': diagnostic('error', [], 'unexpected-failure'),
  'api.shutdown.failed': diagnostic('error', ['component'], 'shutdown-failure'),
  'api.shutdown.timed-out': diagnostic('error', [], 'shutdown-timeout'),
  'api.startup.failed': diagnostic('error', [], 'startup-failure'),
  'auth.sso-callback.failed': diagnostic('error', [], 'unexpected-failure'),
  'command.domain-event-redrive.failed': diagnostic('error', [], 'unexpected-failure'),
  'command.esi-call-rate-report.failed': diagnostic('error', [], 'unexpected-failure'),
  'command.organization-fixture.failed': diagnostic('error', [], 'unexpected-failure'),
  'command.worker-rollback-verification.failed': diagnostic('error', [], 'unexpected-failure'),
  'database.migration.failed': diagnostic('error', [], 'migration-failure'),
  'outbox.relay.event-failed': diagnostic('error', ['eventId', 'eventType', 'payloadVersion']),
  'outbox.relay.event-published': diagnostic('info', ['eventId', 'eventType', 'payloadVersion']),
  'platform.module.error': diagnostic('error', ['moduleId', 'moduleEvent'], 'module-failure'),
  'platform.module.info': diagnostic('info', ['moduleId', 'moduleEvent']),
  'platform.module.warn': diagnostic('warn', ['moduleId', 'moduleEvent']),
  'platform.persistence.failed': diagnostic(
    'error',
    ['moduleId', 'operationId', 'persistenceFailure'],
    'persistence-failure',
  ),
  'queue.runtime.failed': diagnostic('error', [], 'queue-unavailable'),
  'scheduler.marker-update.failed': diagnostic('error', [], 'dependency-unavailable'),
  'scheduler.overlap-lock.expired': diagnostic('error', ['schedulerId'], 'dependency-unavailable'),
  'scheduler.overlap-lock.lost': diagnostic('error', ['schedulerId'], 'processing-failure'),
  'scheduler.overlap-lock.release-failed': diagnostic(
    'error',
    ['schedulerId'],
    'dependency-unavailable',
  ),
  'scheduler.overlap-lock.renewal-failed': diagnostic(
    'error',
    ['schedulerId'],
    'dependency-unavailable',
  ),
  'worker.dependencies.verified': diagnostic('info', []),
  'worker.domain-event.processed': diagnostic('info', ['eventId']),
  'worker.healthcheck.cleanup-failed': diagnostic('error', [], 'healthcheck-failure'),
  'worker.healthcheck.failed': diagnostic('error', [], 'healthcheck-failure'),
  'worker.healthcheck.unhealthy': diagnostic('error', ['healthState'], 'dependency-unavailable'),
  'worker.heartbeat.failed': diagnostic('error', [], 'dependency-unavailable'),
  'worker.job.failed': diagnostic('error', ['jobName', 'eventId']),
  'worker.processing-loop.stopped': diagnostic('error', [], 'processing-failure'),
  'worker.run-loop.failed': diagnostic('error', [], 'processing-failure'),
  'worker.runtime.failed': diagnostic('error', [], 'processing-failure'),
  'worker.shutdown.failed': diagnostic('error', ['component'], 'shutdown-failure'),
  'worker.shutdown.timed-out': diagnostic('error', [], 'shutdown-timeout'),
  'worker.startup.failed': diagnostic('error', [], 'startup-failure'),
} as const

type DiagnosticEvent = keyof typeof diagnosticCatalog

interface DiagnosticContext {
  component?: string
  eventId?: string
  eventType?: string
  healthState?: string
  jobName?: string
  method?: string
  moduleEvent?: string
  moduleId?: string
  operationId?: string
  path?: string
  payloadVersion?: number
  port?: number
  persistenceFailure?: string
  schedulerId?: string
}

interface DiagnosticOptions {
  context?: DiagnosticContext
  correlationId?: string
  error?: unknown
  failureCategory?: DiagnosticFailureCategory
}

interface DiagnosticErrorSource {
  on(event: 'error', listener: (error: Error) => void): unknown
}

export const apiLogger = new LogLayer({
  enabled: process.env.NODE_ENV !== 'test',
  transport: new StructuredTransport({ logger: console, stringify: true }),
})

function safeErrorMetadata(error: unknown) {
  return { thrownType: error === null ? 'null' : typeof error }
}

export function recordDiagnostic(event: DiagnosticEvent, options: DiagnosticOptions = {}) {
  const definition = diagnosticCatalog[event]
  const correlationId = validatedCorrelationIdentifier(options.correlationId) ?? randomUUID()
  const failureCategory =
    definition.failureCategory ?? validatedFailureCategory(options.failureCategory)
  const metadata = {
    event,
    correlationId,
    ...safeDiagnosticContext(definition.contextKeys, options.context),
    ...(failureCategory ? { failureCategory } : {}),
    ...(Object.hasOwn(options, 'error') ? safeErrorMetadata(options.error) : {}),
  }
  const logger = apiLogger.child()
  logger.clearContext()
  logger.withMetadata(metadata)[definition.level]('Runtime diagnostic')
  return correlationId
}

export function attachDiagnosticErrorListener(
  source: DiagnosticErrorSource,
  event: 'queue.runtime.failed' | 'worker.runtime.failed',
) {
  source.on('error', (error) => recordDiagnostic(event, { error }))
}

export function safeRequestMetadata(request: Request, path: string) {
  const remoteAddress = validatedRemoteAddress(request)
  return {
    method: request.method,
    url: safeRequestPath(path),
    ...(remoteAddress ? { remoteAddress } : {}),
  }
}

function safeRequestPath(path: string) {
  if (
    path.length > maximumRequestPathLength ||
    path.includes('?') ||
    path.includes('#') ||
    hasUnsafeRequestPathCharacter(path) ||
    requestPathContainsSensitiveText(path)
  )
    return '[redacted]'
  return path
}

function hasUnsafeRequestPathCharacter(path: string) {
  for (const character of path) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 31 || codePoint === 127) return true
  }
  return false
}

function requestPathContainsSensitiveText(path: string) {
  let candidate = path
  for (let decodeCount = 0; decodeCount < 3; decodeCount++) {
    if (containsSensitiveText(candidate)) return true
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) return false
      candidate = decoded
    } catch {
      return true
    }
  }
  return containsSensitiveText(candidate)
}

function validatedRemoteAddress(request: Request) {
  const candidate =
    request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim()
  return candidate && isIP(candidate) !== 0 ? candidate : undefined
}

function diagnostic(
  level: LogLevelType,
  contextKeys: readonly DiagnosticContextKey[],
  failureCategory?: DiagnosticFailureCategory,
) {
  return { level, contextKeys, failureCategory }
}

function safeDiagnosticContext(
  allowedKeys: readonly DiagnosticContextKey[],
  context: DiagnosticContext | undefined,
) {
  if (!context) return {}
  return Object.fromEntries(
    allowedKeys.flatMap((key) => {
      const value = safeDiagnosticValue(key, context[key])
      return value === undefined ? [] : [[key, value] as const]
    }),
  )
}

function safeDiagnosticValue(key: DiagnosticContextKey, value: unknown) {
  if (key === 'port') return safePositiveDiagnosticInteger(value, 65_535)
  if (key === 'payloadVersion') return safePositiveDiagnosticInteger(value, 1_000)
  if (typeof value !== 'string') return undefined

  switch (key) {
    case 'path':
      return safeRequestPath(value)
    case 'method':
      return /^[A-Z]{1,16}$/.test(value) ? value : undefined
    case 'eventId':
      return correlationIdentifierPattern.test(value) ? value : undefined
    case 'component':
      return [
        'cache-redis',
        'coordination-redis',
        'esi-runtime',
        'http-server',
        'platform',
        'platform-force',
        'postgres',
      ].includes(value)
        ? value
        : undefined
    case 'healthState':
      return [
        'database-unavailable',
        'heartbeat-stale',
        'queue-unavailable',
        'schema-not-ready',
      ].includes(value)
        ? value
        : undefined
    default:
      return safeDiagnosticIdentifier(value)
  }
}

function safePositiveDiagnosticInteger(value: unknown, maximum: number) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= maximum
    ? value
    : undefined
}

function safeDiagnosticIdentifier(value: string) {
  return value.length <= maximumDiagnosticIdentifierLength &&
    diagnosticIdentifierPattern.test(value) &&
    !containsSensitiveText(value)
    ? value
    : undefined
}

function validatedFailureCategory(value: DiagnosticFailureCategory | undefined) {
  return value && diagnosticFailureCategories.includes(value) ? value : undefined
}

function validatedCorrelationIdentifier(value: unknown) {
  return typeof value === 'string' && correlationIdentifierPattern.test(value) ? value : undefined
}

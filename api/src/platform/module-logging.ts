import { isPlatformModuleId } from '@eve-space/platform-module-contract/identifiers'
import type {
  PlatformModuleLogFields,
  PlatformModuleLogger,
} from '@eve-space/platform-module-contract/server'
import { recordDiagnostic } from '../logging.js'
import { containsSensitiveText } from '../sensitive-data.js'

const eventPattern = /^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/
const fieldNamePattern = /^[A-Za-z]\w*$/
const sensitiveFieldPattern = /(?:authorization|cookie|credential|password|secret|token)/i
const maximumFieldCount = 20
const maximumStringLength = 200

interface PlatformModuleLogSink {
  info(message: string, context: Readonly<Record<string, unknown>>): void
  warn(message: string, context: Readonly<Record<string, unknown>>): void
  error(message: string, context: Readonly<Record<string, unknown>>): void
}

export function createPlatformModuleLogger(
  moduleId: string,
  sink?: PlatformModuleLogSink,
): PlatformModuleLogger {
  if (!isPlatformModuleId(moduleId)) {
    throw new Error('Platform module logger requires an installed module identity')
  }

  return {
    error: (event, fields) => writeModuleLog('error', sink, moduleId, event, fields),
    info: (event, fields) => writeModuleLog('info', sink, moduleId, event, fields),
    warn: (event, fields) => writeModuleLog('warn', sink, moduleId, event, fields),
  }
}

function writeModuleLog(
  level: keyof PlatformModuleLogSink,
  sink: PlatformModuleLogSink | undefined,
  moduleId: string,
  event: string,
  fields: PlatformModuleLogFields | undefined,
) {
  if (!eventPattern.test(event) || event.length > 100) {
    throw new Error('Platform module log event must be a bounded stable identifier')
  }
  const safeFields = sanitizeLogFields(fields)
  if (sink) {
    sink[level]('Platform module event', { ...safeFields, event, moduleId })
    return
  }
  recordDiagnostic(`platform.module.${level}`, {
    context: { moduleEvent: event, moduleId },
  })
}

function sanitizeLogFields(fields: PlatformModuleLogFields | undefined) {
  if (!fields) {
    return {}
  }
  const entries = Object.entries(fields)
  if (entries.length > maximumFieldCount) {
    throw new Error(`Platform module logs support at most ${maximumFieldCount} fields`)
  }

  return Object.fromEntries(
    entries.flatMap(([key, value]) => {
      if (!fieldNamePattern.test(key) || key.length > 100) {
        throw new Error('Platform module log field names must be bounded identifiers')
      }
      if (key === 'moduleId' || key === 'event' || sensitiveFieldPattern.test(key)) {
        return []
      }
      if (
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        throw new Error('Platform module log fields must contain primitive values')
      }
      if (typeof value === 'string' && value.length > maximumStringLength) {
        throw new Error(
          `Platform module log strings must not exceed ${maximumStringLength} characters`,
        )
      }
      if (typeof value === 'string' && containsSensitiveText(value)) {
        return []
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new TypeError('Platform module log numbers must be finite')
      }
      return [[key, value] as const]
    }),
  )
}

import { isIP } from 'node:net'
import { LogLayer, StructuredTransport } from 'loglayer'
import { containsSensitiveText } from './sensitive-data.js'

const maximumStackFrames = 8
const maximumRequestPathLength = 2_048
const stackFrameLocationPattern = /(?:\(|\s)([^()\s]+):(\d+):(\d+)\)?$/

export const apiLogger = new LogLayer({
  enabled: process.env.NODE_ENV !== 'test',
  transport: new StructuredTransport({ logger: console, stringify: true }),
})

export function safeErrorMetadata(error: unknown) {
  if (!(error instanceof Error)) return { thrownType: typeof error }
  return {
    errorName: error.name,
    stack: errorStackLocations(error),
    cause: errorCauseMetadata(error.cause),
  }
}

export function logSafeError(message: string, error: unknown) {
  apiLogger.withMetadata(safeErrorMetadata(error)).error(message)
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

function errorCauseMetadata(cause: unknown) {
  if (cause instanceof Error) return { errorName: cause.name, stack: errorStackLocations(cause) }
  if (cause === undefined) return undefined
  return { thrownType: typeof cause }
}

function errorStackLocations(error: Error) {
  const locations = error.stack
    ?.split('\n')
    .flatMap((line) => {
      const match = stackFrameLocationPattern.exec(line)
      if (!match) return []
      const source = match[1]!.split(/[?#]/, 1)[0]!.replaceAll('\\', '/')
      const segments = source.split('/').filter(Boolean)
      const file = segments.slice(-2).join('/')
      if (!file) return []
      return [`at ${file}:${match[2]}:${match[3]}`]
    })
    .slice(0, maximumStackFrames)
  return locations?.length ? locations.join('\n') : undefined
}

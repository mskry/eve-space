interface ApiErrorBody {
  code?: string
  message?: string
  authorizeUrl?: string
  requiredScope?: string
  retryAfterSeconds?: number
  retryAt?: string
  state?: string
  reviewDeadline?: string
}

export interface ApiQueryErrorOptions extends ApiErrorBody {
  status: number
}

export interface SerializedApiQueryError extends ApiQueryErrorOptions {
  message: string
}

export type SerializedNativeError = [name: string, message: string]

export interface ApiErrorResponse {
  readonly headers: Headers
  readonly status: number
  json(): Promise<unknown>
}

export class ApiQueryError extends Error {
  readonly status: number
  readonly code?: string
  readonly authorizeUrl?: string
  readonly requiredScope?: string
  readonly retryAfterSeconds?: number
  readonly retryAt?: string
  readonly state?: string
  readonly reviewDeadline?: string

  constructor(message: string, options: ApiQueryErrorOptions) {
    super(message)
    this.name = 'ApiQueryError'
    this.status = options.status
    this.code = options.code
    this.authorizeUrl = options.authorizeUrl
    this.requiredScope = options.requiredScope
    this.retryAfterSeconds = options.retryAfterSeconds
    this.retryAt = options.retryAt
    this.state = options.state
    this.reviewDeadline = options.reviewDeadline
  }
}

export async function toApiQueryError(response: ApiErrorResponse, fallbackMessage: string) {
  const body = await readErrorBody(response)
  const retryAfterValue = response.headers.get('Retry-After')
  const retryAfterHeader = retryAfterValue === null ? undefined : Number(retryAfterValue)

  return new ApiQueryError(body.message ?? fallbackMessage, {
    status: response.status,
    code: body.code,
    authorizeUrl: body.authorizeUrl,
    requiredScope: body.requiredScope,
    retryAfterSeconds:
      body.retryAfterSeconds ??
      (retryAfterHeader !== undefined && Number.isFinite(retryAfterHeader)
        ? retryAfterHeader
        : undefined),
    retryAt: body.retryAt,
    state: body.state,
    reviewDeadline: body.reviewDeadline,
  })
}

export function reduceApiQueryError(value: unknown): SerializedApiQueryError | false {
  if (!(value instanceof ApiQueryError)) return false
  return {
    message: value.message,
    status: value.status,
    code: value.code,
    authorizeUrl: value.authorizeUrl,
    requiredScope: value.requiredScope,
    retryAfterSeconds: value.retryAfterSeconds,
    retryAt: value.retryAt,
    state: value.state,
    reviewDeadline: value.reviewDeadline,
  }
}

export function reviveApiQueryError(value: SerializedApiQueryError) {
  return new ApiQueryError(value.message, value)
}

export function reduceNativeError(value: unknown): SerializedNativeError | false {
  if (!(value instanceof Error) || value instanceof ApiQueryError) return false
  if (!nativeErrorConstructors.has(value.constructor)) return false
  return [value.name, value.message]
}

export function reviveNativeError([name, message]: SerializedNativeError) {
  const ErrorConstructor = nativeErrorByName.get(name) ?? Error
  return new ErrorConstructor(message)
}

const nativeErrorByName = new Map<string, ErrorConstructor>([
  ['Error', Error],
  ['EvalError', EvalError],
  ['RangeError', RangeError],
  ['ReferenceError', ReferenceError],
  ['SyntaxError', SyntaxError],
  ['TypeError', TypeError],
  ['URIError', URIError],
])
const nativeErrorConstructors = new Set<Function>(nativeErrorByName.values())

async function readErrorBody(response: ApiErrorResponse): Promise<ApiErrorBody> {
  try {
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object') return {}

    const record = body as Record<string, unknown>
    return {
      code: stringValue(record.code),
      message: stringValue(record.message),
      authorizeUrl: stringValue(record.authorizeUrl),
      requiredScope: stringValue(record.requiredScope),
      retryAfterSeconds: numberValue(record.retryAfterSeconds),
      retryAt: stringValue(record.retryAt),
      state: stringValue(record.state),
      reviewDeadline: stringValue(record.reviewDeadline),
    }
  } catch {
    return {}
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

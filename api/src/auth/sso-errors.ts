export class SsoTransportError extends Error {
  constructor(cause: unknown) {
    super('EVE SSO request failed', { cause })
    this.name = 'SsoTransportError'
  }
}

export class SsoHttpError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number,
  ) {
    super(`${operation} returned HTTP ${status}`)
    this.name = 'SsoHttpError'
  }
}

export class SsoTokenRejectedError extends Error {
  readonly status = 401

  constructor(readonly upstreamStatus: number) {
    super('EVE rejected the stored refresh token')
    this.name = 'SsoTokenRejectedError'
  }
}

export function isTransientSsoError(error: unknown) {
  return (
    error instanceof SsoTransportError ||
    (error instanceof SsoHttpError &&
      (error.status === 429 || (error.status >= 500 && error.status < 600)))
  )
}

export class SsoTransportError extends Error {
  constructor(cause: unknown) {
    super('EVE SSO request failed', { cause })
    this.name = 'SsoTransportError'
  }
}

export class SsoHttpError extends Error {
  constructor(
    readonly operation: string,
    readonly upstreamStatus: number,
  ) {
    super(`${operation} returned HTTP ${upstreamStatus}`)
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
      (error.upstreamStatus === 429 || (error.upstreamStatus >= 500 && error.upstreamStatus < 600)))
  )
}

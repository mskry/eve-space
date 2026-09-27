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

export class SsoAccessTokenInvalidError extends SsoTokenRejectedError {
  constructor() {
    super(401)
    this.message = 'EVE access token is invalid'
    this.name = 'SsoAccessTokenInvalidError'
  }
}

export class SsoAccessTokenExpiredError extends Error {
  constructor() {
    super('EVE access token has expired')
    this.name = 'SsoAccessTokenExpiredError'
  }
}

export class CharacterOwnerMismatchError extends SsoTokenRejectedError {
  constructor() {
    super(401)
    this.message = 'EVE character ownership changed'
    this.name = 'CharacterOwnerMismatchError'
  }
}

export function isTransientSsoError(error: unknown) {
  return (
    error instanceof SsoTransportError ||
    (error instanceof SsoHttpError &&
      (error.upstreamStatus === 429 || (error.upstreamStatus >= 500 && error.upstreamStatus < 600)))
  )
}

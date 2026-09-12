export class ScopeRequiredError extends Error {
  constructor(readonly scope: string) {
    super(`EVE authorization is missing the ${scope} scope`)
  }
}

export class TokenRefreshUnavailableError extends Error {
  constructor() {
    super('EVE token refresh is temporarily unavailable')
  }
}

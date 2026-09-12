export class EsiQuotaError extends Error {
  readonly retryAt: Date

  constructor(
    readonly retryAfterSeconds: number,
    now = Date.now(),
    retryAt?: Date,
  ) {
    super('ESI quota is temporarily exhausted')
    this.name = 'EsiQuotaError'
    this.retryAt = retryAt ?? new Date(now + retryAfterSeconds * 1_000)
  }
}

export class GraphQLCachePolicy {
  private blocked = false
  private expiresAt = Infinity
  private verdicts = 0

  noStore = () => {
    this.blocked = true
  }

  publicUntil = (expiresAt: string, maximumAgeSeconds: number) => {
    const expiry = Date.parse(expiresAt)
    if (!Number.isFinite(expiry) || !Number.isFinite(maximumAgeSeconds) || maximumAgeSeconds <= 0) {
      this.noStore()
      return
    }
    this.verdicts += 1
    this.expiresAt = Math.min(this.expiresAt, expiry, Date.now() + maximumAgeSeconds * 1000)
  }

  field = (required: boolean) => {
    let supplied = false
    return {
      cache: {
        publicUntil: (expiresAt: string, maximumAgeSeconds: number) => {
          supplied = true
          this.publicUntil(expiresAt, maximumAgeSeconds)
        },
        noStore: () => {
          supplied = true
          this.noStore()
        },
      },
      finish: () => {
        if (required && !supplied) this.noStore()
      },
    }
  }

  header = (method: string, privateSelection: boolean, errors: boolean) => {
    const seconds = Math.floor((this.expiresAt - Date.now()) / 1000)
    if (
      method !== 'GET' ||
      privateSelection ||
      errors ||
      this.blocked ||
      !this.verdicts ||
      seconds <= 0
    )
      return 'no-store'
    return `public, max-age=${seconds}`
  }
}

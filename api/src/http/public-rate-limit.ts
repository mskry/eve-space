import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'

interface PublicRequestRateLimitOptions<Code extends string> {
  code: Code
  message: string
}

const rateLimitWindowMs = 60_000
const rateLimitMaximum = 60
const maxRateLimitEntries = 1_000

export function createPublicRequestRateLimit<const Code extends string>({
  code,
  message,
}: PublicRequestRateLimitOptions<Code>) {
  const entries = new Map<string, { count: number; resetAt: number }>()

  return createMiddleware(async (context, next) => {
    const now = Date.now()
    const client = getClientAddress(context)
    const current = entries.get(client)
    const entry =
      current && current.resetAt > now ? current : { count: 0, resetAt: now + rateLimitWindowMs }
    entry.count += 1
    entries.set(client, entry)
    if (entries.size > maxRateLimitEntries) {
      const oldest = entries.keys().next().value
      if (oldest !== undefined) entries.delete(oldest)
    }

    if (entry.count > rateLimitMaximum) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1_000))
      context.header('Retry-After', String(retryAfterSeconds))
      return context.json({ code, message }, 429)
    }

    await next()
  })
}

function getClientAddress(context: Context): string {
  try {
    return getConnInfo(context).remote.address ?? 'shared'
  } catch {
    return 'shared'
  }
}

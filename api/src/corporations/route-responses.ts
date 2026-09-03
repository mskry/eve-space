import type { Context } from 'hono'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'

export function npcCorporationsError(context: Context, error: unknown) {
  if (error instanceof EsiQuotaError) return esiCooldown(context, error)
  return context.json({ message: 'Corporation data is temporarily unavailable.' }, 502)
}

export function corporationResourceError(
  context: Context,
  error: unknown,
  unavailableMessage: string,
) {
  if (error instanceof EsiQuotaError) return esiCooldown(context, error)

  const status = errorStatus(error)
  if (status === 404 || status === 422) {
    return context.json({ code: 'CORPORATION_NOT_FOUND', message: 'Corporation not found.' }, 404)
  }
  return context.json({ message: unavailableMessage }, 502)
}

function esiCooldown(context: Context, error: EsiQuotaError) {
  context.header('Retry-After', String(error.retryAfterSeconds))
  return context.json(
    {
      code: 'ESI_COOLDOWN',
      message: 'Corporation data is temporarily rate limited by ESI.',
      retryAfterSeconds: error.retryAfterSeconds,
    },
    429,
  )
}

function errorStatus(error: unknown) {
  return typeof error === 'object' && error && 'status' in error ? Number(error.status) : undefined
}

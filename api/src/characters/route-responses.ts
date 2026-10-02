import type { Context } from 'hono'
import { env } from '../env.js'
import type { EsiReadResultMetadata } from '../esi-gateway/feature-execution.js'
import type { CharacterResourceFailure } from './resource-failure.js'
import {
  characterCooldownResponse,
  characterReadAdmissionResponse,
  characterReauthorizationUrlFor,
  characterResourceResponse,
  type OwnedCharacterResourceErrorOptions,
} from './resource-response.js'
import type { ReadAdmissionDenial } from '../auth/read-policy.js'

export const ownedCharacterReadAdmissionError = (
  context: Context,
  denial: ReadAdmissionDenial,
  characterId: number,
  options: OwnedCharacterResourceErrorOptions,
) => {
  const result = characterReadAdmissionResponse(denial, characterId, env.EVE_CALLBACK_URL, options)
  return context.json(result.body, result.status)
}

export const ownedCharacterResourceError = (
  context: Context,
  failure: CharacterResourceFailure,
  characterId: number,
  options: OwnedCharacterResourceErrorOptions,
) => {
  const result = characterResourceResponse(failure, characterId, env.EVE_CALLBACK_URL, options)
  if (failure.kind === 'cooldown') context.header('Retry-After', String(failure.retryAfterSeconds))
  return context.json(result.body, result.status)
}

export const esiCooldown = (context: Context, error: { readonly retryAfterSeconds: number }) => {
  const result = characterCooldownResponse(error.retryAfterSeconds)
  context.header('Retry-After', String(error.retryAfterSeconds))
  return context.json(result.body, result.status)
}

export const toCharacterEsiResponse = <Data extends EsiReadResultMetadata>(result: Data): Data =>
  result

export const characterReauthorizationUrl = (characterId: number, returnTo?: string) =>
  characterReauthorizationUrlFor(env.EVE_CALLBACK_URL, characterId, returnTo)

import { GraphQLError } from 'graphql'
import { ReadAdmissionError } from '../auth/read-policy.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../auth/token-errors.js'
import { classifyEsiOperationFailure, type EsiFailure } from '../esi-gateway/failures.js'
import { z } from 'zod'

const failures = {
  RESOURCE_UNAVAILABLE: [404, 'Resource is unavailable.'],
  ORGANIZATION_MEMBER_BLOCKED: [403, 'Organization access denied.'],
  ORGANIZATION_COMPLIANCE_REQUIRED: [403, 'Organization compliance is required.'],
  ORGANIZATION_PERMISSION_REQUIRED: [403, 'Organization permission is required.'],
  ORGANIZATION_HR_REQUIRED: [403, 'Organization access denied.'],
  ORGANIZATION_REVIEWER_REQUIRED: [403, 'Organization access denied.'],
  ORGANIZATION_MANAGER_REQUIRED: [403, 'Organization access denied.'],
  MARKET_CATALOGUE_REVISION_MISSING: [404, 'Market catalogue revision is unavailable.'],
  MARKET_TYPE_UNAVAILABLE: [404, 'Market type is unavailable.'],
  AUTH_REQUIRED: [401, 'Log in with EVE Online first.'],
  CHARACTER_NOT_FOUND: [404, 'Character not found.'],
  CHARACTER_AUTHORIZATION_CHANGED: [409, 'Character authorization changed. Restart this read.'],
  READ_AUTHORIZATION_CHANGED: [409, 'Read authorization changed. Restart this read.'],
  EVE_SCOPE_REQUIRED: [403, 'Authorize access for this character.'],
  EVE_REAUTH_REQUIRED: [403, 'EVE authorization is no longer valid.'],
  EVE_TOKEN_REFRESH_UNAVAILABLE: [503, 'EVE token refresh is temporarily unavailable.'],
  ESI_COOLDOWN: [429, 'EVE Online ESI is temporarily rate limited.'],
  ESI_QUOTA_EXHAUSTED: [429, 'EVE Online ESI is temporarily rate limited.'],
  ESI_UNAVAILABLE: [502, 'EVE Online ESI is temporarily unavailable.'],
  ESI_RESPONSE_INVALID: [502, 'EVE Online returned invalid asset pagination metadata.'],
  ASSET_CURSOR_RESTART: [409, 'Asset source changed. Restart pagination.'],
  BAD_USER_INPUT: [400, 'Invalid or excessive read operation.'],
  OPERATION_LIMIT: [400, 'Operation work limit exceeded.'],
  OPERATION_CANCELED: [408, 'Operation canceled or timed out.'],
  MODULE_NOT_FOUND: [404, 'Module is unavailable.'],
  MODULE_DISABLED: [404, 'Module is unavailable.'],
  ORGANIZATION_ACCESS_DENIED: [403, 'Organization access denied.'],
  ORGANIZATION_REQUIRED: [403, 'Organization access denied.'],
  MARKET_PROFILE_UNAVAILABLE: [404, 'Market profile is unavailable.'],
  MARKET_HISTORY_PROFILE_UNAVAILABLE: [404, 'Market history profile is unavailable.'],
  MARKET_HISTORY_PROFILE_CHANGED: [409, 'Market history profile changed. Restart this read.'],
  MARKET_OBSERVATION_UNAVAILABLE: [404, 'Market observation is unavailable. Restart pagination.'],
  MARKET_CATALOGUE_UNAVAILABLE: [503, 'Market catalogue is unavailable.'],
  MARKET_CATALOGUE_REVISION_UNAVAILABLE: [409, 'Market catalogue revision is unavailable.'],
  MARKET_CATALOGUE_TYPE_NOT_FOUND: [404, 'Market catalogue type was not found.'],
  INVALID_MARKET_READ_INPUT: [400, 'Invalid Market read input.'],
  INVENTORY_SCOPE_DENIED: [403, 'Inventory scope is unavailable.'],
  INVENTORY_AUTHORIZATION_CHANGED: [409, 'Inventory authorization changed. Restart this read.'],
  INVENTORY_SOURCE_CHANGED: [409, 'Inventory source changed. Restart pagination.'],
  INVENTORY_RESTART_REQUIRED: [409, 'Inventory changed. Restart pagination.'],
  INVENTORY_LIMIT: [400, 'Inventory exceeds supported bounds. Narrow the selected scope.'],
} satisfies Readonly<Record<string, readonly [number, string]>>

const failureByCode = new Map<string, readonly [number, string]>(Object.entries(failures))
const errorCode = z.object({ code: z.string().max(80) })
const safeExtensions = z.object({
  code: z.string().max(80).catch(''),
  requiredScope: z
    .string()
    .max(124)
    .regex(/^esi-[\w.-]+$/)
    .optional()
    .catch(undefined),
  authorizeUrl: z
    .string()
    .max(64)
    .regex(/^\/auth\/eve\/reauthorize\/[1-9]\d{0,15}$/)
    .optional()
    .catch(undefined),
  retryAfterSeconds: z.number().int().min(0).max(86400).optional().catch(undefined),
})

const esiGraphQLError = (failure: EsiFailure, characterId?: string, requiredScope?: string) => {
  switch (failure.kind) {
    case 'authorization':
      return new GraphQLError('EVE authorization is no longer valid.', {
        extensions: {
          code: 'EVE_REAUTH_REQUIRED',
          ...(requiredScope && { requiredScope }),
          ...(characterId && { authorizeUrl: `/auth/eve/reauthorize/${characterId}` }),
        },
      })
    case 'quota':
      return new GraphQLError('EVE Online ESI is temporarily rate limited.', {
        extensions: { code: 'ESI_QUOTA_EXHAUSTED', retryAfterSeconds: failure.retryAfterSeconds },
      })
    case 'response-invalid':
      return new GraphQLError(failures.ESI_RESPONSE_INVALID[1], {
        extensions: { code: 'ESI_RESPONSE_INVALID' },
      })
    case 'unavailable':
    case 'http':
      return new GraphQLError('EVE Online ESI is temporarily unavailable.', {
        extensions: { code: 'ESI_UNAVAILABLE' },
      })
    case 'unknown':
      return undefined
  }
}

export const safeGraphQLError = <Failure>(
  error: Failure,
  characterId?: string,
  requiredScope?: string,
): GraphQLError => {
  if (error instanceof ReadAdmissionError) {
    const { body, status } = error.denial
    return new GraphQLError(body.message, {
      extensions: {
        code: body.code ?? 'RESOURCE_UNAVAILABLE',
        status,
        ...(body.requiredScope && { requiredScope: body.requiredScope }),
        ...(body.requiredScope &&
          characterId && { authorizeUrl: `/auth/eve/reauthorize/${characterId}` }),
      },
    })
  }
  if (error instanceof ScopeRequiredError)
    return new GraphQLError('Authorize access for this character.', {
      extensions: {
        code: 'EVE_SCOPE_REQUIRED',
        requiredScope: error.scope,
        ...(characterId && { authorizeUrl: `/auth/eve/reauthorize/${characterId}` }),
      },
    })
  if (error instanceof TokenRefreshUnavailableError)
    return new GraphQLError('EVE token refresh is temporarily unavailable.', {
      extensions: { code: 'EVE_TOKEN_REFRESH_UNAVAILABLE' },
    })
  if (error instanceof GraphQLError) return error
  const esiError = esiGraphQLError(classifyEsiOperationFailure(error), characterId, requiredScope)
  if (esiError) return esiError
  const parsed = errorCode.safeParse(error)
  const known = parsed.success ? failureByCode.get(parsed.data.code) : undefined
  if (known && parsed.success)
    return new GraphQLError(known[1], { extensions: { code: parsed.data.code } })
  throw error
}

export const formatGraphQLError = (error: GraphQLError) => {
  const { code, ...guidance } = safeExtensions.parse(error.extensions)
  const known = failureByCode.get(code)
  return {
    message: known?.[1] ?? 'Unexpected error.',
    ...(error.path && { path: error.path }),
    extensions: known ? { code, status: known[0], ...guidance } : { code: 'INTERNAL_SERVER_ERROR' },
  }
}

import type {
  PublicCharacterProfileRequest,
  PublicCharacterProfileResult,
} from '@eve-space/core-data-contract'
import { getCharacterProfile } from '../characters/profile.js'

type PublicProfileReader = (
  characterId: number,
  signal?: AbortSignal,
) => Promise<PublicCharacterProfileResult>

export class PublicCharacterProfileUnavailableError extends Error {
  constructor() {
    super('Public character profile is unavailable')
    this.name = 'PublicCharacterProfileUnavailableError'
  }
}

const assertProfileResult = (profile: PublicCharacterProfileResult, characterId: number) => {
  if (
    profile?.id !== characterId ||
    !profile.name?.length ||
    profile.name.length > 256 ||
    (profile.bio && (profile.bio.plainText.length > 20_000 || profile.bio.runs.length > 1_000)) ||
    !Number.isFinite(Date.parse(profile.validatedAt)) ||
    !Number.isFinite(Date.parse(profile.cachedUntil))
  ) {
    throw new PublicCharacterProfileUnavailableError()
  }
  return profile
}

export const loadPublicCharacterProfileProduct = (
  request: PublicCharacterProfileRequest,
  readProfile: PublicProfileReader = getCharacterProfile,
): Promise<PublicCharacterProfileResult> => {
  if (
    !request ||
    Array.isArray(request) ||
    !Object.hasOwn(request, 'characterId') ||
    !Number.isSafeInteger(request.characterId) ||
    request.characterId <= 0 ||
    request.characterId > 2_147_483_647 ||
    Object.keys(request).some((key) => key !== 'characterId' && key !== 'signal') ||
    (request.signal !== undefined && !(request.signal instanceof AbortSignal))
  ) {
    throw new TypeError('Invalid public character profile request')
  }
  const { characterId, signal } = request
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Profile read cancelled', 'AbortError')
  }
  return Promise.resolve()
    .then(() => readProfile(characterId, signal))
    .then((profile) => {
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('Profile read cancelled', 'AbortError')
      }
      return assertProfileResult(profile, characterId)
    })
    .catch(() => {
      if (signal?.aborted) {
        throw signal.reason ?? new DOMException('Profile read cancelled', 'AbortError')
      }
      throw new PublicCharacterProfileUnavailableError()
    })
}

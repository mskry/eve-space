import { describe, expect, test, vi } from 'vitest'
import { createCoreDataCapability } from '../../src/core-data/capabilities.js'
import {
  loadPublicCharacterProfileProduct,
  PublicCharacterProfileUnavailableError,
} from '../../src/core-data/public-character-profile-adapter.js'

const profile = {
  id: 90_000_001,
  name: 'Pilot',
  validatedAt: '2026-09-18T12:00:00Z',
  cachedUntil: '2026-09-19T12:00:00Z',
  bio: { plainText: 'Sanitized biography', runs: [{ start: 0, text: 'Sanitized biography' }] },
}

describe('public character profile product admission', () => {
  test.each([
    null,
    [],
    { characterIds: [90_000_001] },
    { characterId: 0 },
    { characterId: 2_147_483_648 },
    { characterId: 90_000_001.5 },
    { characterId: '90000001' },
    { characterId: 90_000_001, characterIds: [90_000_002] },
    { characterId: 90_000_001, signal: 'not-a-signal' },
  ])('refuses invalid or batch input before canonical source access', (request) => {
    const readProfile = vi.fn()
    // SAFETY: These malformed fixtures intentionally bypass the typed request contract.
    expect(() => loadPublicCharacterProfileProduct(request as never, readProfile)).toThrow(
      'Invalid public character profile request',
    )
    expect(readProfile).not.toHaveBeenCalled()
  })

  test('admits one valid character and passes cancellation to the canonical source', async () => {
    const controller = new AbortController()
    const readProfile = vi.fn().mockResolvedValue(profile)

    await expect(
      loadPublicCharacterProfileProduct(
        { characterId: 90_000_001, signal: controller.signal },
        readProfile,
      ),
    ).resolves.toBe(profile)
    expect(readProfile).toHaveBeenCalledExactlyOnceWith(90_000_001, controller.signal)
  })

  test('preserves canonical cache validation time and sanitized biography on a cache hit', async () => {
    const cached = { ...profile, stale: false }
    const readProfile = vi.fn().mockResolvedValue(cached)
    await expect(
      loadPublicCharacterProfileProduct({ characterId: 90_000_001 }, readProfile),
    ).resolves.toBe(cached)
    expect(cached.validatedAt).toBe('2026-09-18T12:00:00Z')
  })

  test('classifies source failure and mismatched identity without exposing upstream details', async () => {
    const upstream = vi.fn().mockRejectedValue(new Error('sensitive transport detail'))
    await expect(
      loadPublicCharacterProfileProduct({ characterId: 90_000_001 }, upstream),
    ).rejects.toStrictEqual(new PublicCharacterProfileUnavailableError())
    await expect(
      loadPublicCharacterProfileProduct(
        { characterId: 90_000_001 },
        vi.fn().mockResolvedValue({ ...profile, id: 90_000_002 }),
      ),
    ).rejects.toBeInstanceOf(PublicCharacterProfileUnavailableError)
  })

  test('cancels work and never releases a late result after its signal aborts', async () => {
    const controller = new AbortController()
    let finish!: (result: typeof profile) => void
    const readProfile = vi.fn().mockImplementation(
      () =>
        new Promise<typeof profile>((resolve) => {
          finish = resolve
        }),
    )
    const result = loadPublicCharacterProfileProduct(
      { characterId: 90_000_001, signal: controller.signal },
      readProfile,
    )
    await Promise.resolve()
    controller.abort(new DOMException('Cancelled', 'AbortError'))
    finish(profile)
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('denies resource projection before exposing a network-backed method', () => {
    expect(() =>
      createCoreDataCapability(['public-character-profile'], 'resource-projection'),
    ).toThrow('not permitted')
  })
})

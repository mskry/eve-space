import { randomUUID } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import {
  loadPlatformCollectionState,
  upsertPlatformCollectionState,
} from '../src/platform/collection-state-store.js'
import {
  platformCollectionFailureClasses,
  platformCollectionStateWriteSchema,
  type PlatformCollectionStateWrite,
} from '../src/platform/collection-state.js'

describe('platform collection state', () => {
  test('accepts only sanitized failure classes and valid scheduling metadata', () => {
    for (const failureClass of platformCollectionFailureClasses) {
      expect(
        platformCollectionStateWriteSchema.parse(
          collectionState({ lastFailureClass: failureClass }),
        ),
      ).toMatchObject({ lastFailureClass: failureClass })
    }

    expect(() =>
      platformCollectionStateWriteSchema.parse(
        collectionState({ lastFailureClass: 'upstream body contained a token' as never }),
      ),
    ).toThrow(/Invalid option/)
    expect(() =>
      platformCollectionStateWriteSchema.parse(collectionState({ authorizationGeneration: -1 })),
    ).toThrow(/Too small/)
    expect(() =>
      platformCollectionStateWriteSchema.parse(
        collectionState({ subjectLifecycleId: 'reusable-character-id' }),
      ),
    ).toThrow(/Invalid UUID/)
    expect(() =>
      platformCollectionStateWriteSchema.parse(collectionState({ moduleId: 'platform' })),
    ).toThrow(/Reserved platform module identity/)
  })

  test('loads an exact five-part identity and returns null when it is absent', async () => {
    const where = vi.fn().mockResolvedValue([])
    const from = vi.fn().mockReturnValue({ where })
    const select = vi.fn().mockReturnValue({ from })

    const { moduleId, resourceId, subjectKind, subjectLifecycleId, subjectId } = collectionState()
    await expect(
      loadPlatformCollectionState(
        { moduleId, resourceId, subjectKind, subjectLifecycleId, subjectId },
        { select } as never,
      ),
    ).resolves.toBeNull()
    expect(select).toHaveBeenCalledOnce()
    expect(from).toHaveBeenCalledOnce()
    expect(where).toHaveBeenCalledOnce()
  })

  test('upserts mutable state without replacing the supplied validation time', async () => {
    const input = collectionState()
    const stored = {
      ...input,
      createdAt: new Date('2026-08-25T00:00:00Z'),
      updatedAt: new Date('2026-08-26T00:00:00Z'),
    }
    const returning = vi.fn().mockResolvedValue([stored])
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning })
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate })
    const insert = vi.fn().mockReturnValue({ values })

    await expect(upsertPlatformCollectionState(input, { insert } as never)).resolves.toEqual(stored)
    expect(values).toHaveBeenCalledWith(input)
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.any(Array),
        set: expect.objectContaining({
          authorizationGeneration: input.authorizationGeneration,
          lastFailureClass: input.lastFailureClass,
          nextEligibleAt: input.nextEligibleAt,
          validatedAt: input.validatedAt,
        }),
      }),
    )
  })

  test('validates writes before database access and fails closed on a missing result', async () => {
    const insert = vi.fn()
    await expect(
      upsertPlatformCollectionState(
        collectionState({ subjectId: '   ', lastFailureClass: 'unknown' }),
        { insert } as never,
      ),
    ).rejects.toThrow(/Too small/)
    expect(insert).not.toHaveBeenCalled()

    const returning = vi.fn().mockResolvedValue([])
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning })
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate })
    insert.mockReturnValue({ values })
    await expect(
      upsertPlatformCollectionState(collectionState(), { insert } as never),
    ).rejects.toThrow('Failed to persist platform collection state')
  })
})

function collectionState(
  overrides: Partial<PlatformCollectionStateWrite> = {},
): PlatformCollectionStateWrite {
  return {
    moduleId: 'member-audit',
    resourceId: 'character-skills',
    subjectKind: 'character',
    subjectLifecycleId: randomUUID(),
    subjectId: '1404328063',
    nextEligibleAt: new Date('2026-08-26T12:00:00Z'),
    authorizationGeneration: 3,
    validatedAt: new Date('2026-08-26T11:00:00Z'),
    lastFailureClass: null,
    ...overrides,
  }
}

import type {
  PlatformAdmittedCorporationInventory,
  PlatformCorporationInventorySubject,
} from '@eve-space/platform-module-contract/inventory'
import { afterEach, expect, test, vi } from 'vitest'
import { memberAssetInventoryProvider } from '../src/inventory-provider.js'
import {
  backfillAssetInventoryOperation,
  readAssetInventoryOperation,
  type InventoryReadPersistence,
} from '../src/inventory-persistence.js'

const now = Date.parse('2026-10-03T14:00:00Z')
const subject: PlatformCorporationInventorySubject = {
  characterId: 90_000_001,
  characterName: 'Pilot',
  userId: '22222222-2222-4222-8222-222222222222',
  characterLifecycle: '11111111-1111-4111-8111-111111111111',
  memberLifecycle: '33333333-3333-4333-8333-333333333333',
  corporationId: 98_000_001,
  authorizationGeneration: 8,
  authorizationRevision: 8,
  disclosureRevision: 2,
  sectionActivationRevision: 3,
  observationId: null,
  evidenceReadable: true,
  collection: {
    state: 'current',
    validatedAt: new Date(now).toISOString(),
    freshUntil: new Date(now + 3_600_000).toISOString(),
    lastFailureClass: null,
  },
}
const metadata = {
  characterId: subject.characterId,
  observationId: '44444444-4444-4444-8444-444444444444',
  ready: true,
  validatedAt: subject.collection!.validatedAt,
}
const empty = { groups: [], holders: [], hasNextPage: false, conflictingCharacters: [] }
// SAFETY: The provider receives only controlled subjects through this test-only nominal capability.
const binding = (subjects = [subject]) =>
  ({
    scope: 'corporation',
    actorUserId: 'actor',
    corporationId: subject.corporationId,
    organizationVersion: 4,
    authorizationRevision: 1,
    fingerprint: 'core-test-binding',
    subjects,
  }) as PlatformAdmittedCorporationInventory
const fixture = () => {
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const persistence = {
    readInventorySources: vi
      .fn<InventoryReadPersistence['readInventorySources']>()
      .mockResolvedValue([metadata]),
    readAssetInventory: vi
      .fn<InventoryReadPersistence['readAssetInventory']>()
      .mockResolvedValue(empty),
  }
  const controller = new AbortController()
  return {
    persistence,
    controller,
    provider: memberAssetInventoryProvider({ persistence, signal: controller.signal }),
  }
}
afterEach(() => vi.restoreAllMocks())

test('uses three set reads independent of subject count and never obtains full-snapshot operations', async () => {
  const { persistence, provider } = fixture()
  const subjects = Array.from({ length: 250 }, (_, i) => ({
    ...subject,
    characterId: subject.characterId + i,
  }))
  persistence.readInventorySources.mockResolvedValue(
    subjects.map((row) => ({ ...metadata, characterId: row.characterId })),
  )
  const result = await provider(binding(subjects), { kind: 'coverage', first: 100 })
  expect(result).toMatchObject({
    expectedSubjects: 250,
    sourcesComplete: true,
    coverage: { rows: { length: 100 }, hasNextPage: true },
  })
  expect(persistence.readInventorySources).toHaveBeenCalledTimes(2)
  expect(persistence.readAssetInventory).toHaveBeenCalledOnce()
  expect(persistence.readAssetInventory.mock.calls[0]?.[0].subjects).toHaveLength(250)
  const next = await provider(binding(subjects), {
    kind: 'coverage',
    first: 100,
    after: result.coverage.endCursor!,
  })
  expect(next.coverage.rows[0]?.characterId).toBe(subject.characterId + 100)
  await expect(
    provider(binding([...subjects, { ...subject, characterId: 99_000_001 }]), {
      kind: 'groups',
      first: 100,
    }),
  ).rejects.toThrow('Inventory read exceeds its declared scope')
})

test.each(['replacement', 'purge', 'readiness'] as const)(
  'refuses a %s race after aggregate rows were loaded',
  async (race) => {
    const { persistence, provider } = fixture()
    let changed: Awaited<ReturnType<InventoryReadPersistence['readInventorySources']>>[number] = {
      ...metadata,
      observationId: '55555555-5555-4555-8555-555555555555',
    }
    if (race === 'purge')
      changed = {
        ...metadata,
        observationId: null,
        validatedAt: null,
        ready: false,
      }
    if (race === 'readiness') changed = { ...metadata, ready: false }
    persistence.readInventorySources
      .mockResolvedValueOnce([metadata])
      .mockResolvedValueOnce([changed])
    await expect(provider(binding(), { kind: 'groups', first: 100 })).rejects.toMatchObject({
      code: 'INVENTORY_RESTART_REQUIRED',
    })
  },
)

test('refuses source clock mismatch, pinned replacement, and expiry during asynchronous reads', async () => {
  const { persistence, provider } = fixture()
  persistence.readInventorySources.mockResolvedValue([
    { ...metadata, validatedAt: new Date(now + 1000).toISOString() },
  ])
  await expect(provider(binding(), { kind: 'groups', first: 100 })).rejects.toMatchObject({
    code: 'INVENTORY_RESTART_REQUIRED',
  })
  persistence.readInventorySources.mockResolvedValue([metadata])
  await expect(
    provider(binding([{ ...subject, observationId: '55555555-5555-4555-8555-555555555555' }]), {
      kind: 'groups',
      first: 100,
    }),
  ).rejects.toMatchObject({ code: 'INVENTORY_RESTART_REQUIRED' })
  persistence.readAssetInventory.mockImplementation(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now + 3_600_000)
    return empty
  })
  await expect(provider(binding(), { kind: 'groups', first: 100 })).rejects.toMatchObject({
    code: 'INVENTORY_RESTART_REQUIRED',
  })
})

test('shows collection and backfill gaps without reading their quantities', async () => {
  const { persistence, provider } = fixture()
  const subjects = [
    subject,
    {
      ...subject,
      characterId: subject.characterId + 1,
      collection: {
        state: 'never-collected' as const,
        validatedAt: null,
        freshUntil: null,
        lastFailureClass: null,
      },
    },
    { ...subject, characterId: subject.characterId + 2, collection: undefined },
  ]
  persistence.readInventorySources.mockResolvedValue([
    { ...metadata, ready: false },
    { characterId: subjects[1]!.characterId, observationId: null, validatedAt: null, ready: false },
    { characterId: subjects[2]!.characterId, observationId: null, validatedAt: null, ready: false },
  ])
  const result = await provider(binding(subjects), { kind: 'coverage', first: 100 })
  expect(result.coverage.rows.map(({ state }) => state)).toEqual([
    'incomplete',
    'never-collected',
    'unavailable',
  ])
  expect(persistence.readAssetInventory).toHaveBeenCalledWith(
    expect.objectContaining({ subjects: [] }),
  )
  expect(result.sourcesComplete).toBe(false)
})

test('stops new work on cancellation and refuses unreadable or cross-corporation subjects', async () => {
  const { persistence, provider, controller } = fixture()
  await expect(
    provider(binding([{ ...subject, evidenceReadable: false }]), { kind: 'groups', first: 100 }),
  ).rejects.toThrow('Inventory requires core-bound readable subjects')
  await expect(
    provider(binding([{ ...subject, corporationId: subject.corporationId + 1 }]), {
      kind: 'groups',
      first: 100,
    }),
  ).rejects.toThrow('Inventory requires core-bound readable subjects')
  persistence.readInventorySources.mockImplementation(async () => {
    controller.abort()
    return [metadata]
  })
  await expect(provider(binding(), { kind: 'groups', first: 100 })).rejects.toThrow(/aborted/)
  expect(persistence.readAssetInventory).not.toHaveBeenCalled()
})

test('bounds and deduplicates persistence subjects before PostgreSQL execution', () => {
  const tuple = {
    organizationVersion: 4,
    targetUserId: subject.userId,
    managedMemberLifecycleId: subject.memberLifecycle,
    characterId: subject.characterId,
    characterLifecycleId: subject.characterLifecycle,
    authorizationGeneration: 8,
    disclosureVersion: 2,
    sectionActivationVersion: 3,
    observationId: metadata.observationId,
  }
  expect(
    backfillAssetInventoryOperation.inputSchema.safeParse({ subjects: [tuple, tuple] }).success,
  ).toBe(false)
  expect(
    readAssetInventoryOperation.inputSchema.safeParse({
      subjects: Array.from({ length: 251 }, (_, i) => ({
        ...tuple,
        characterId: tuple.characterId + i,
        stale: false,
      })),
      kind: 'groups',
      first: 100,
      after: null,
      groupKey: null,
      filters: {},
    }).success,
  ).toBe(false)
})

test('keeps latest complete current-authority assets stale without inventing an age-only expiry', async () => {
  const { provider } = fixture()
  vi.spyOn(Date, 'now').mockReturnValue(now + 120 * 86_400_000)
  const result = await provider(
    binding([{ ...subject, collection: { ...subject.collection!, state: 'stale' } }]),
    { kind: 'coverage', first: 100 },
  )
  expect(result.coverage.rows[0]).toMatchObject({
    state: 'included-stale',
    source: { retainedUntil: '9999-12-31T23:59:59.999Z' },
  })
  expect(result.sourcesComplete).toBe(true)
})

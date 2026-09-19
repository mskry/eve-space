import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hasCurrentSnapshot: vi.fn(),
  mainCharacterRows: [] as unknown[][],
  searchRows: [] as unknown[][],
  select: vi.fn(() => query(mocks.mainCharacterRows.shift() ?? [])),
  selectDistinctOn: vi.fn(() => query(mocks.searchRows.shift() ?? [], true)),
  tokenEncryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' as string | undefined,
  transaction: vi.fn((callback: (transaction: FakeTransaction) => Promise<unknown>) =>
    callback({ select: mocks.select, selectDistinctOn: mocks.selectDistinctOn }),
  ),
}))

vi.mock('../../src/db/client.js', () => ({
  db: { transaction: mocks.transaction },
}))

vi.mock('../../src/env.js', () => ({
  env: {
    get TOKEN_ENCRYPTION_KEY() {
      return mocks.tokenEncryptionKey
    },
  },
}))

vi.mock('../../src/organization/reviewer-organization-snapshot.js', () => ({
  hasCurrentReviewerOrganizationSnapshot: mocks.hasCurrentSnapshot,
}))

import {
  ReviewerAccountSearchInputError,
  searchManagedOrganizationAccounts,
  searchManagedOrganizationDirectory,
} from '../../src/organization/reviewer-account-search.js'

const now = new Date('2026-09-18T12:00:00.000Z')
const firstUserId = '00000000-0000-4000-8000-000000000001'
const secondUserId = '00000000-0000-4000-8000-000000000002'

describe('reviewer account search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasCurrentSnapshot.mockResolvedValue(true)
    mocks.mainCharacterRows = []
    mocks.searchRows = []
    mocks.tokenEncryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
  })

  test('returns unavailable without reading member rows when the snapshot is not current', async () => {
    mocks.hasCurrentSnapshot.mockResolvedValue(false)

    await expect(
      searchManagedOrganizationAccounts({ organizationVersion: 7, filters: {}, now }),
    ).resolves.toEqual({
      organizationVersion: 7,
      status: 'unavailable',
      items: [],
      nextCursor: null,
    })
    expect(mocks.selectDistinctOn).not.toHaveBeenCalled()
  })

  test('projects bounded results and continues with an authenticated cursor', async () => {
    mocks.searchRows = [
      [searchRow(), searchRow({ userId: secondUserId, characterId: 90_000_002 })],
      [
        searchRow({
          userId: secondUserId,
          characterId: 90_000_002,
          characterName: 'Second Pilot',
          allianceId: null,
          complianceState: 'review_required',
          complianceEvidenceFreshness: 'stale',
          complianceEvidenceAt: new Date('2026-09-18T10:00:00.000Z'),
          complianceReviewDeadline: new Date('2026-09-19T12:00:00.000Z'),
          complianceAccessValidUntil: new Date('2026-09-20T12:00:00.000Z'),
          complianceEvaluatedAt: new Date('2026-09-18T11:00:00.000Z'),
          blockedAt: new Date('2026-09-18T09:00:00.000Z'),
        }),
      ],
    ]
    mocks.mainCharacterRows = [
      [{ userId: firstUserId, characterId: 90_000_010, name: 'Main Pilot' }],
      [],
    ]

    const firstPage = await searchManagedOrganizationAccounts({
      organizationVersion: 7,
      filters: { limit: 1 },
      now,
    })

    expect(firstPage.items).toEqual([
      expect.objectContaining({
        account: {
          userId: firstUserId,
          mainCharacter: { characterId: 90_000_010, name: 'Main Pilot' },
        },
        compliance: expect.objectContaining({ state: 'pending' }),
        block: { blocked: false },
      }),
    ])
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    await expect(
      searchManagedOrganizationAccounts({
        organizationVersion: 7,
        filters: { cursor: firstPage.nextCursor!, limit: 1 },
        now,
      }),
    ).resolves.toEqual({
      organizationVersion: 7,
      status: 'available',
      items: [
        {
          managedMemberLifecycleId: '00000000-0000-4000-8000-000000000010',
          account: { userId: secondUserId, mainCharacter: null },
          managedAffiliation: {
            characterId: 90_000_002,
            name: 'Second Pilot',
            corporationId: 98_000_001,
            allianceId: null,
            checkedAt: '2026-09-18T11:00:00.000Z',
          },
          compliance: {
            state: 'review_required',
            evidenceFreshness: 'stale',
            evidenceAt: '2026-09-18T10:00:00.000Z',
            reviewDeadline: '2026-09-19T12:00:00.000Z',
            accessValidUntil: '2026-09-20T12:00:00.000Z',
            evaluatedAt: '2026-09-18T11:00:00.000Z',
          },
          block: { blocked: true, blockedAt: '2026-09-18T09:00:00.000Z' },
          evidenceSections: [],
        },
      ],
      nextCursor: null,
    })
  })

  test('applies supported filters and returns the reduced directory projection', async () => {
    mocks.searchRows = [[], [], [], [searchRow()]]
    mocks.mainCharacterRows = [
      [{ userId: firstUserId, characterId: 90_000_010, name: 'Main Pilot' }],
    ]

    await searchManagedOrganizationAccounts({
      organizationVersion: 7,
      filters: { query: '90000001', corporationId: 98_000_001, complianceState: 'pending' },
      now,
    })
    await searchManagedOrganizationAccounts({
      organizationVersion: 7,
      filters: { query: firstUserId, complianceState: 'compliant', blocked: true },
      now,
    })
    await searchManagedOrganizationAccounts({
      organizationVersion: 7,
      filters: { query: String.raw`Pilot%_\Name`, blocked: false },
      now,
    })

    await expect(
      searchManagedOrganizationDirectory({ organizationVersion: 7, filters: {}, now }),
    ).resolves.toEqual({
      organizationVersion: 7,
      status: 'available',
      items: [
        {
          managedMemberLifecycleId: '00000000-0000-4000-8000-000000000010',
          account: {
            userId: firstUserId,
            mainCharacter: { characterId: 90_000_010, name: 'Main Pilot' },
          },
          managedAffiliation: {
            characterId: 90_000_001,
            name: 'Managed Pilot',
            corporationId: 98_000_001,
            allianceId: 99_000_001,
            checkedAt: '2026-09-18T11:00:00.000Z',
          },
        },
      ],
      nextCursor: null,
    })
  })

  test.each([
    { query: 'x'.repeat(81) },
    { corporationId: 0 },
    { corporationId: 1.5 },
    { complianceState: 'unknown' },
    { blocked: 'yes' },
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { cursor: 'invalid cursor' },
  ])('rejects invalid filters %#', async (filters) => {
    await expect(
      searchManagedOrganizationAccounts({ organizationVersion: 7, filters, now } as Parameters<
        typeof searchManagedOrganizationAccounts
      >[0]),
    ).rejects.toBeInstanceOf(ReviewerAccountSearchInputError)
  })

  test('rejects malformed, mismatched, and unavailable cursors', async () => {
    await expect(
      searchManagedOrganizationAccounts({
        organizationVersion: 7,
        filters: { cursor: 'abc' },
        now,
      }),
    ).rejects.toBeInstanceOf(ReviewerAccountSearchInputError)

    mocks.searchRows = [[searchRow(), searchRow({ userId: secondUserId })]]
    const page = await searchManagedOrganizationAccounts({
      organizationVersion: 7,
      filters: { limit: 1 },
      now,
    })

    await expect(
      searchManagedOrganizationAccounts({
        organizationVersion: 8,
        filters: { cursor: page.nextCursor!, limit: 1 },
        now,
      }),
    ).rejects.toBeInstanceOf(ReviewerAccountSearchInputError)
    await expect(
      searchManagedOrganizationAccounts({
        organizationVersion: 7,
        filters: { cursor: page.nextCursor!, limit: 1, blocked: true },
        now,
      }),
    ).rejects.toBeInstanceOf(ReviewerAccountSearchInputError)

    mocks.tokenEncryptionKey = undefined
    mocks.searchRows = [[searchRow(), searchRow({ userId: secondUserId })]]
    await expect(
      searchManagedOrganizationAccounts({
        organizationVersion: 7,
        filters: { limit: 1 },
        now,
      }),
    ).rejects.toThrow('Reviewer account search is unavailable.')
  })
})

interface FakeTransaction {
  select: typeof mocks.select
  selectDistinctOn: typeof mocks.selectDistinctOn
}

function searchRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: firstUserId,
    managedMemberLifecycleId: '00000000-0000-4000-8000-000000000010',
    characterId: 90_000_001,
    characterName: 'Managed Pilot',
    corporationId: 98_000_001,
    allianceId: 99_000_001,
    affiliationCheckedAt: new Date('2026-09-18T11:00:00.000Z'),
    complianceState: null,
    complianceEvidenceFreshness: null,
    complianceEvidenceAt: null,
    complianceReviewDeadline: null,
    complianceAccessValidUntil: null,
    complianceEvaluatedAt: null,
    blockedAt: null,
    ...overrides,
  }
}

function query(result: unknown[], limited = false) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy'])
    builder[method] = () => builder
  if (limited) builder.limit = () => Promise.resolve(result)
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

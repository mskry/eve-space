import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  directoryRows: [] as unknown[][],
  execute: vi.fn(() => Promise.resolve(mocks.directoryRows.shift() ?? [])),
  hasCurrentSnapshot: vi.fn(),
  mainCharacterRows: [] as unknown[][],
  searchRows: [] as unknown[][],
  select: vi.fn(() => query(mocks.mainCharacterRows.shift() ?? [])),
  selectDistinctOn: vi.fn(() => query(mocks.searchRows.shift() ?? [], true)),
  tokenEncryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' as string | undefined,
  transaction: vi.fn((callback: (transaction: FakeTransaction) => Promise<unknown>) =>
    callback({
      execute: mocks.execute,
      select: mocks.select,
      selectDistinctOn: mocks.selectDistinctOn,
    }),
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
    mocks.directoryRows = []
    mocks.mainCharacterRows = []
    mocks.searchRows = []
    mocks.tokenEncryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
  })

  test('returns unavailable without reading member rows when the snapshot is not current', async () => {
    mocks.hasCurrentSnapshot.mockResolvedValue(false)

    await expect(
      searchManagedOrganizationAccounts({ filters: {}, now, organizationVersion: 7 }),
    ).resolves.toStrictEqual({
      items: [],
      nextCursor: null,
      organizationVersion: 7,
      status: 'unavailable',
    })
    expect(mocks.selectDistinctOn).not.toHaveBeenCalled()
  })

  test('projects bounded results and continues with an authenticated cursor', async () => {
    mocks.searchRows = [
      [searchRow(), searchRow({ characterId: 90_000_002, userId: secondUserId })],
      [
        searchRow({
          allianceId: null,
          blockedAt: new Date('2026-09-18T09:00:00.000Z'),
          characterId: 90_000_002,
          characterName: 'Second Pilot',
          complianceAccessValidUntil: new Date('2026-09-20T12:00:00.000Z'),
          complianceEvaluatedAt: new Date('2026-09-18T11:00:00.000Z'),
          complianceEvidenceAt: new Date('2026-09-18T10:00:00.000Z'),
          complianceEvidenceFreshness: 'stale',
          complianceReviewDeadline: new Date('2026-09-19T12:00:00.000Z'),
          complianceState: 'review_required',
          userId: secondUserId,
        }),
      ],
    ]
    mocks.mainCharacterRows = [
      [{ characterId: 90_000_010, name: 'Main Pilot', userId: firstUserId }],
      [],
    ]

    const firstPage = await searchManagedOrganizationAccounts({
      filters: { limit: 1 },
      now,
      organizationVersion: 7,
    })

    expect(firstPage.items).toStrictEqual([
      expect.objectContaining({
        account: {
          mainCharacter: { characterId: 90_000_010, name: 'Main Pilot' },
          userId: firstUserId,
        },
        block: { blocked: false },
        compliance: expect.objectContaining({ state: 'pending' }),
      }),
    ])
    expect(firstPage.nextCursor).toStrictEqual(expect.any(String))

    await expect(
      searchManagedOrganizationAccounts({
        filters: { cursor: firstPage.nextCursor!, limit: 1 },
        now,
        organizationVersion: 7,
      }),
    ).resolves.toStrictEqual({
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
      organizationVersion: 7,
      status: 'available',
    })
  })

  test('applies supported filters and returns the canonical directory projection', async () => {
    mocks.searchRows = [[], [], []]
    mocks.directoryRows = [[directoryRow()]]
    mocks.mainCharacterRows = [[], [{ organizationVersion: 7 }]]

    await searchManagedOrganizationAccounts({
      filters: { complianceState: 'pending', corporationId: 98_000_001, query: '90000001' },
      now,
      organizationVersion: 7,
    })
    await searchManagedOrganizationAccounts({
      filters: { blocked: true, complianceState: 'compliant', query: firstUserId },
      now,
      organizationVersion: 7,
    })
    await searchManagedOrganizationAccounts({
      filters: { blocked: false, query: String.raw`Pilot%_\Name` },
      now,
      organizationVersion: 7,
    })

    await expect(
      searchManagedOrganizationDirectory({ filters: {}, now, organizationVersion: 7 }),
    ).resolves.toStrictEqual({
      groupFacets: [],
      items: [
        {
          managedMemberLifecycleId: '00000000-0000-4000-8000-000000000010',
          managedSince: '2026-01-01T00:00:00.000Z',
          siteRegisteredAt: '2025-12-01T00:00:00.000Z',
          account: {
            userId: firstUserId,
            mainCharacter: { characterId: 90_000_010, name: 'Main Pilot' },
          },
          portraitCharacter: {
            characterId: 90_000_010,
            name: 'Main Pilot',
            source: 'main-character',
          },
          managedAffiliation: {
            characterId: 90_000_001,
            name: 'Managed Pilot',
            corporationId: 98_000_001,
            allianceId: 99_000_001,
            checkedAt: '2026-09-18T11:00:00.000Z',
          },
          disclosedCharacterCount: 2,
          groups: [],
          compliance: {
            state: 'compliant',
            evidenceFreshness: 'fresh',
            evidenceAt: '2026-09-18T10:00:00.000Z',
            reviewDeadline: null,
            accessValidUntil: '2026-09-19T12:00:00.000Z',
            evaluatedAt: '2026-09-18T11:00:00.000Z',
          },
          block: { blocked: false },
          auditData: {
            state: 'current',
            expected: 7,
            covered: 7,
            asOf: '2026-09-18T09:00:00.000Z',
          },
        },
      ],
      nextCursor: null,
      organizationVersion: 7,
      status: 'available',
    })
  })

  test('enriches a directory page with a constant number of database reads', async () => {
    mocks.directoryRows = [
      [
        directoryRow({
          disclosedCharacterCount: 0,
          mainCharacterId: null,
          mainCharacterName: null,
        }),
        directoryRow({
          characterId: 90_000_002,
          characterName: 'Second Pilot',
          managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
          sortValue: 'second pilot',
          userId: secondUserId,
        }),
        directoryRow({ userId: '00000000-0000-4000-8000-000000000003' }),
      ],
    ]
    mocks.mainCharacterRows = [
      [
        {
          groupId: '00000000-0000-4000-8000-000000000101',
          name: 'Alpha Group',
          userId: firstUserId,
        },
        {
          groupId: '00000000-0000-4000-8000-000000000102',
          name: 'Beta Group',
          userId: secondUserId,
        },
      ],
      [{ organizationVersion: 7 }],
    ]

    const page = await searchManagedOrganizationDirectory({
      filters: { limit: 2 },
      now,
      organizationVersion: 7,
    })

    expect(page.items).toHaveLength(2)
    expect(page.items[0]).toMatchObject({
      disclosedCharacterCount: 0,
      groups: [{ groupId: '00000000-0000-4000-8000-000000000101', name: 'Alpha Group' }],
      portraitCharacter: {
        characterId: 90_000_001,
        name: 'Managed Pilot',
        source: 'managed-affiliation',
      },
    })
    expect(page.groupFacets).toStrictEqual([
      { groupId: '00000000-0000-4000-8000-000000000101', name: 'Alpha Group' },
      { groupId: '00000000-0000-4000-8000-000000000102', name: 'Beta Group' },
    ])
    expect(page.nextCursor).toStrictEqual(expect.any(String))
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.select).toHaveBeenCalledTimes(2)
    expect(mocks.selectDistinctOn).not.toHaveBeenCalled()
  })

  test('continues directory ordering with a cursor bound to every normalized input', async () => {
    mocks.directoryRows = [
      [
        directoryRow(),
        directoryRow({
          characterId: 90_000_002,
          characterName: 'Second Pilot',
          managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
          sortValue: 'second pilot',
          userId: secondUserId,
        }),
      ],
    ]
    mocks.mainCharacterRows = [[], [{ organizationVersion: 7 }]]
    const firstPage = await searchManagedOrganizationDirectory({
      filters: { limit: 1 },
      now,
      organizationVersion: 7,
    })
    expect(firstPage.nextCursor).toStrictEqual(expect.any(String))
    expect(Buffer.from(firstPage.nextCursor!, 'base64url').toString('utf8')).not.toContain(
      firstUserId,
    )

    mocks.directoryRows = [
      [
        directoryRow({
          characterId: 90_000_002,
          characterName: 'Second Pilot',
          managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
          sortValue: 'second pilot',
          userId: secondUserId,
        }),
      ],
    ]
    mocks.mainCharacterRows = [[], [{ organizationVersion: 7 }]]
    await expect(
      searchManagedOrganizationDirectory({
        filters: { cursor: firstPage.nextCursor!, limit: 1 },
        now,
        organizationVersion: 7,
      }),
    ).resolves.toMatchObject({
      items: [{ account: { userId: secondUserId } }],
      nextCursor: null,
    })

    const changedInputs = [
      { filters: { limit: 1 }, organizationVersion: 8 },
      { filters: { limit: 1, query: 'pilot' }, organizationVersion: 7 },
      { filters: { corporationId: 98_000_001, limit: 1 }, organizationVersion: 7 },
      {
        filters: { groupId: '00000000-0000-4000-8000-000000000101', limit: 1 },
        organizationVersion: 7,
      },
      { filters: { complianceState: 'compliant' as const, limit: 1 }, organizationVersion: 7 },
      { filters: { blocked: true, limit: 1 }, organizationVersion: 7 },
      { filters: { auditState: 'current' as const, limit: 1 }, organizationVersion: 7 },
      { filters: { limit: 1, sort: 'corporation' as const }, organizationVersion: 7 },
      { filters: { direction: 'desc' as const, limit: 1 }, organizationVersion: 7 },
      { filters: { limit: 2 }, organizationVersion: 7 },
    ]
    for (const changed of changedInputs) {
      await expect(
        searchManagedOrganizationDirectory({
          ...changed,
          filters: { ...changed.filters, cursor: firstPage.nextCursor! },
          now,
        }),
      ).rejects.toBeInstanceOf(ReviewerAccountSearchInputError)
    }

    const tampered = `${firstPage.nextCursor!.startsWith('A') ? 'B' : 'A'}${firstPage.nextCursor!.slice(1)}`
    await expect(
      searchManagedOrganizationDirectory({
        filters: { cursor: tampered, limit: 1 },
        now,
        organizationVersion: 7,
      }),
    ).rejects.toBeInstanceOf(ReviewerAccountSearchInputError)
  })

  test.each([
    { groupId: 'not-a-uuid' },
    { complianceState: 'unknown' },
    { blocked: 'yes' },
    { auditState: 'unknown' },
    { sort: 'unknown' },
    { direction: 'sideways' },
  ])('rejects invalid directory filters %#', async (filters) => {
    await expect(
      searchManagedOrganizationDirectory({ filters, now, organizationVersion: 7 } as Parameters<
        typeof searchManagedOrganizationDirectory
      >[0]),
    ).rejects.toBeInstanceOf(ReviewerAccountSearchInputError)
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
      searchManagedOrganizationAccounts({ filters, now, organizationVersion: 7 } as Parameters<
        typeof searchManagedOrganizationAccounts
      >[0]),
    ).rejects.toBeInstanceOf(ReviewerAccountSearchInputError)
  })

  test('rejects malformed, mismatched, and unavailable cursors', async () => {
    await expect(
      searchManagedOrganizationAccounts({
        filters: { cursor: 'abc' },
        now,
        organizationVersion: 7,
      }),
    ).rejects.toBeInstanceOf(ReviewerAccountSearchInputError)

    mocks.searchRows = [[searchRow(), searchRow({ userId: secondUserId })]]
    const page = await searchManagedOrganizationAccounts({
      filters: { limit: 1 },
      now,
      organizationVersion: 7,
    })

    await expect(
      searchManagedOrganizationAccounts({
        filters: { cursor: page.nextCursor!, limit: 1 },
        now,
        organizationVersion: 8,
      }),
    ).rejects.toBeInstanceOf(ReviewerAccountSearchInputError)
    await expect(
      searchManagedOrganizationAccounts({
        filters: { blocked: true, cursor: page.nextCursor!, limit: 1 },
        now,
        organizationVersion: 7,
      }),
    ).rejects.toBeInstanceOf(ReviewerAccountSearchInputError)

    mocks.tokenEncryptionKey = undefined
    mocks.searchRows = [[searchRow(), searchRow({ userId: secondUserId })]]
    await expect(
      searchManagedOrganizationAccounts({
        filters: { limit: 1 },
        now,
        organizationVersion: 7,
      }),
    ).rejects.toThrow('Reviewer account search is unavailable.')
  })
})

interface FakeTransaction {
  execute: typeof mocks.execute
  select: typeof mocks.select
  selectDistinctOn: typeof mocks.selectDistinctOn
}

function directoryRow(overrides: Record<string, unknown> = {}) {
  return {
    affiliationCheckedAt: new Date('2026-09-18T11:00:00.000Z'),
    allianceId: 99_000_001,
    auditAsOf: new Date('2026-09-18T09:00:00.000Z'),
    auditCovered: 7,
    auditExpected: 7,
    auditState: 'current',
    blockedAt: null,
    characterId: 90_000_001,
    characterName: 'Managed Pilot',
    complianceAccessValidUntil: new Date('2026-09-19T12:00:00.000Z'),
    complianceEvaluatedAt: new Date('2026-09-18T11:00:00.000Z'),
    complianceEvidenceAt: new Date('2026-09-18T10:00:00.000Z'),
    complianceEvidenceFreshness: 'fresh',
    complianceReviewDeadline: null,
    complianceState: 'compliant',
    corporationId: 98_000_001,
    disclosedCharacterCount: 2,
    mainCharacterId: 90_000_010,
    mainCharacterName: 'Main Pilot',
    managedMemberLifecycleId: '00000000-0000-4000-8000-000000000010',
    managedSince: new Date('2026-01-01T00:00:00.000Z'),
    siteRegisteredAt: new Date('2025-12-01T00:00:00.000Z'),
    sortValue: 'main pilot',
    userId: firstUserId,
    ...overrides,
  }
}

function searchRow(overrides: Record<string, unknown> = {}) {
  return {
    affiliationCheckedAt: new Date('2026-09-18T11:00:00.000Z'),
    allianceId: 99_000_001,
    blockedAt: null,
    characterId: 90_000_001,
    characterName: 'Managed Pilot',
    complianceAccessValidUntil: null,
    complianceEvaluatedAt: null,
    complianceEvidenceAt: null,
    complianceEvidenceFreshness: null,
    complianceReviewDeadline: null,
    complianceState: null,
    corporationId: 98_000_001,
    managedMemberLifecycleId: '00000000-0000-4000-8000-000000000010',
    userId: firstUserId,
    ...overrides,
  }
}

function query(result: unknown[], limited = false) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy']) {
    builder[method] = () => builder
  }
  if (limited) {
    builder.limit = () => Promise.resolve(result)
  }
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

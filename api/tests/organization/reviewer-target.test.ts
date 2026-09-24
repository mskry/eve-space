import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  results: [] as unknown[][],
  select: vi.fn(() => query(mocks.results.shift() ?? [])),
  transaction: vi.fn(
    (callback: (transaction: { select: typeof mocks.select }) => Promise<unknown>) =>
      callback({ select: mocks.select }),
  ),
}))

vi.mock('../../src/db/client.js', () => ({
  db: { transaction: mocks.transaction },
}))

import { resolveOrganizationReviewerTarget } from '../../src/organization/reviewer-target.js'

const now = new Date('2026-09-16T12:00:00.000Z')
const targetUserId = '00000000-0000-4000-8000-000000000002'
const mainLifecycleId = '00000000-0000-4000-8000-000000000003'
const externalLifecycleId = '00000000-0000-4000-8000-000000000004'

describe('organization reviewer target', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.results = []
  })

  test('returns only the bounded account, lifecycle, affiliation, compliance, group, and block context', async () => {
    mocks.results = completeResults()

    await expect(
      resolveOrganizationReviewerTarget({ now, organizationVersion: 7, targetUserId }),
    ).resolves.toStrictEqual({
      account: {
        mainCharacter: { characterId: 90_000_001, name: 'Main Pilot' },
        userId: targetUserId,
      },
      block: { blocked: true, blockedAt: '2026-09-15T12:00:00.000Z' },
      characters: [
        {
          characterId: 90_000_001,
          subjectLifecycleId: mainLifecycleId,
          authorizationGeneration: 9,
          name: 'Main Pilot',
          isMain: true,
          affiliation: {
            corporationId: 98_000_001,
            allianceId: 99_000_001,
            membership: 'managed',
            freshness: 'fresh',
            checkedAt: '2026-09-16T11:00:00.000Z',
          },
        },
        {
          characterId: 90_000_002,
          subjectLifecycleId: externalLifecycleId,
          authorizationGeneration: 4,
          name: 'External Pilot',
          isMain: false,
          affiliation: {
            corporationId: 98_000_002,
            allianceId: null,
            membership: 'approved-external',
            freshness: 'stale',
            checkedAt: '2026-09-16T10:00:00.000Z',
          },
        },
      ],
      compliance: {
        accessValidUntil: null,
        evaluatedAt: '2026-09-16T11:30:00.000Z',
        evidenceAt: '2026-09-16T10:30:00.000Z',
        evidenceFreshness: 'stale',
        reviewDeadline: null,
        state: 'suspended',
      },
      groups: [
        {
          groupId: '00000000-0000-4000-8000-000000000010',
          assignmentId: '00000000-0000-4000-8000-000000000011',
          name: 'Registration complete',
          restricted: false,
          managementMode: 'manual',
          readOnly: true,
          assignedAt: '2026-09-01T12:00:00.000Z',
          expiresAt: null,
        },
      ],
      managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
      organizationVersion: 7,
      selection: { kind: 'account' },
    })
    expect(mocks.select).toHaveBeenCalledTimes(6)
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'repeatable read',
    })
    expect(mocks.lock).toHaveBeenCalledWith('key share', expect.any(Object))
  })

  test('binds a selected character to its exact current lifecycle', async () => {
    mocks.results = completeResults()

    const context = await resolveOrganizationReviewerTarget({
      characterId: 90_000_002,
      now,
      organizationVersion: 7,
      targetUserId,
    })

    expect(context?.selection).toStrictEqual({
      characterId: 90_000_002,
      kind: 'character',
      subjectLifecycleId: externalLifecycleId,
    })
  })

  test('refuses an account without a fresh managed character before summary reads', async () => {
    mocks.results = [
      [reviewerOrganization()],
      [
        reviewerCharacter({
          exceptionId: '00000000-0000-4000-8000-000000000006',
          managedCorporationId: null,
        }),
      ],
    ]

    await expect(
      resolveOrganizationReviewerTarget({ now, organizationVersion: 7, targetUserId }),
    ).resolves.toBeNull()
    expect(mocks.select).toHaveBeenCalledTimes(2)
  })

  test('refuses alliance membership when the managed-corporation collection is stale', async () => {
    mocks.results = [
      [
        reviewerOrganization({
          managedCorporationsNextEligibleAt: new Date('2026-09-16T12:00:00.000Z'),
        }),
      ],
    ]

    await expect(
      resolveOrganizationReviewerTarget({ now, organizationVersion: 7, targetUserId }),
    ).resolves.toBeNull()
    expect(mocks.select).toHaveBeenCalledTimes(1)
  })

  test('does not require managed-corporation collection evidence for corporation deployments', async () => {
    mocks.results = [
      [
        reviewerOrganization({
          managedCorporationsNextEligibleAt: null,
          managedCorporationsValidatedAt: null,
          organizationType: 'corporation',
        }),
      ],
      [reviewerCharacter()],
      [],
      [],
      [],
      [{ organizationVersion: 7 }],
    ]

    await expect(
      resolveOrganizationReviewerTarget({ now, organizationVersion: 7, targetUserId }),
    ).resolves.not.toBeNull()
  })

  test('refuses an unclassified selected character before summary reads', async () => {
    mocks.results = [
      [reviewerOrganization()],
      [
        reviewerCharacter(),
        reviewerCharacter({
          characterId: 90_000_009,
          exceptionId: null,
          isMain: false,
          managedCorporationId: null,
          name: 'Hidden Pilot',
          subjectLifecycleId: '00000000-0000-4000-8000-000000000009',
        }),
      ],
    ]

    await expect(
      resolveOrganizationReviewerTarget({
        characterId: 90_000_009,
        now,
        organizationVersion: 7,
        targetUserId,
      }),
    ).resolves.toBeNull()
    expect(mocks.select).toHaveBeenCalledTimes(2)
  })

  test('refuses a stale last-known managed character selected beside a fresh managed character', async () => {
    mocks.results = [
      [reviewerOrganization()],
      [
        reviewerCharacter(),
        reviewerCharacter({
          affiliationCheckedAt: new Date('2026-09-16T10:00:00.000Z'),
          characterId: 90_000_009,
          isMain: false,
          name: 'Stale Pilot',
          nextAffiliationCheck: new Date('2026-09-16T11:00:00.000Z'),
          subjectLifecycleId: '00000000-0000-4000-8000-000000000009',
        }),
      ],
    ]

    await expect(
      resolveOrganizationReviewerTarget({
        characterId: 90_000_009,
        now,
        organizationVersion: 7,
        targetUserId,
      }),
    ).resolves.toBeNull()
    expect(mocks.select).toHaveBeenCalledTimes(2)
  })

  test('maps absent compliance and block rows to safe summaries', async () => {
    mocks.results = [
      [reviewerOrganization()],
      [reviewerCharacter()],
      [],
      [],
      [],
      [{ organizationVersion: 7 }],
    ]

    const context = await resolveOrganizationReviewerTarget({
      now,
      organizationVersion: 7,
      targetUserId,
    })

    expect(context?.compliance).toStrictEqual({
      accessValidUntil: null,
      evaluatedAt: null,
      evidenceAt: null,
      evidenceFreshness: 'unavailable',
      reviewDeadline: null,
      state: 'pending',
    })
    expect(context?.groups).toStrictEqual([])
    expect(context?.block).toStrictEqual({ blocked: false })
  })

  test('fails closed when the active organization version changes during resolution', async () => {
    mocks.results = [...completeResults().slice(0, 5), []]

    await expect(
      resolveOrganizationReviewerTarget({ now, organizationVersion: 7, targetUserId }),
    ).resolves.toBeNull()
  })
})

function completeResults() {
  return [
    [reviewerOrganization()],
    [
      reviewerCharacter({
        authorizationGeneration: 9,
        encryptedToken: 'secret',
        scopes: ['private.scope'],
      }),
      reviewerCharacter({
        affiliationCheckedAt: new Date('2026-09-16T10:00:00.000Z'),
        allianceId: null,
        authorizationGeneration: 4,
        characterId: 90_000_002,
        corporationId: 98_000_002,
        exceptionId: '00000000-0000-4000-8000-000000000006',
        isMain: false,
        managedCorporationId: null,
        name: 'External Pilot',
        nextAffiliationCheck: new Date('2026-09-16T11:00:00.000Z'),
        subjectLifecycleId: externalLifecycleId,
      }),
      reviewerCharacter({
        characterId: 90_000_009,
        exceptionId: null,
        isMain: false,
        managedCorporationId: null,
        name: 'Undisclosed Pilot',
        subjectLifecycleId: '00000000-0000-4000-8000-000000000009',
      }),
    ],
    [
      {
        accessValidUntil: null,
        evaluatedAt: new Date('2026-09-16T11:30:00.000Z'),
        evidenceAt: new Date('2026-09-16T10:30:00.000Z'),
        evidenceFreshness: 'stale',
        issueCode: 'private-reason',
        reviewDeadline: null,
        state: 'suspended',
      },
    ],
    [
      {
        assignedAt: new Date('2026-09-01T12:00:00.000Z'),
        assignedByUserId: '00000000-0000-4000-8000-000000000012',
        assignmentId: '00000000-0000-4000-8000-000000000011',
        expiresAt: null,
        groupId: '00000000-0000-4000-8000-000000000010',
        hasReviewerPermission: true,
        managementMode: 'manual',
        name: 'Registration complete',
        permissionKey: 'private.permission',
        reason: 'private assignment reason',
        restricted: false,
      },
    ],
    [
      {
        blockedAt: new Date('2026-09-15T12:00:00.000Z'),
        blockedByUserId: '00000000-0000-4000-8000-000000000013',
        reason: 'private block reason',
      },
    ],
    [{ organizationVersion: 7 }],
  ]
}

function reviewerCharacter(overrides: Record<string, unknown> = {}) {
  return {
    affiliationCheckedAt: new Date('2026-09-16T11:00:00.000Z'),
    affiliationResolutionState: 'resolved',
    allianceId: 99_000_001,
    authorizationGeneration: 9,
    characterId: 90_000_001,
    corporationId: 98_000_001,
    exceptionId: null,
    isMain: true,
    managedCorporationId: 98_000_001,
    managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
    name: 'Main Pilot',
    nextAffiliationCheck: new Date('2026-09-16T13:00:00.000Z'),
    subjectLifecycleId: mainLifecycleId,
    ...overrides,
  }
}

function reviewerOrganization(overrides: Record<string, unknown> = {}) {
  return {
    managedCorporationsFailureStartedAt: null,
    managedCorporationsLastFailureClass: null,
    managedCorporationsNextEligibleAt: new Date('2026-09-16T13:00:00.000Z'),
    managedCorporationsValidatedAt: new Date('2026-09-16T11:00:00.000Z'),
    organizationType: 'alliance',
    ...overrides,
  }
}

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy']) {
    builder[method] = () => builder
  }
  builder.for = (...arguments_: unknown[]) => {
    mocks.lock(...arguments_)
    return builder
  }
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

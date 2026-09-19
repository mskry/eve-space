import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  results: [] as unknown[][],
  select: vi.fn(() => query(mocks.results.shift() ?? [])),
  lock: vi.fn(),
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
      resolveOrganizationReviewerTarget({ organizationVersion: 7, targetUserId, now }),
    ).resolves.toEqual({
      organizationVersion: 7,
      managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
      selection: { kind: 'account' },
      account: {
        userId: targetUserId,
        mainCharacter: { characterId: 90_000_001, name: 'Main Pilot' },
      },
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
        state: 'suspended',
        evidenceFreshness: 'stale',
        evidenceAt: '2026-09-16T10:30:00.000Z',
        reviewDeadline: null,
        accessValidUntil: null,
        evaluatedAt: '2026-09-16T11:30:00.000Z',
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
      block: { blocked: true, blockedAt: '2026-09-15T12:00:00.000Z' },
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
      organizationVersion: 7,
      targetUserId,
      characterId: 90_000_002,
      now,
    })

    expect(context?.selection).toEqual({
      kind: 'character',
      characterId: 90_000_002,
      subjectLifecycleId: externalLifecycleId,
    })
  })

  test('refuses an account without a fresh managed character before summary reads', async () => {
    mocks.results = [
      [reviewerOrganization()],
      [
        reviewerCharacter({
          managedCorporationId: null,
          exceptionId: '00000000-0000-4000-8000-000000000006',
        }),
      ],
    ]

    await expect(
      resolveOrganizationReviewerTarget({ organizationVersion: 7, targetUserId, now }),
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
      resolveOrganizationReviewerTarget({ organizationVersion: 7, targetUserId, now }),
    ).resolves.toBeNull()
    expect(mocks.select).toHaveBeenCalledTimes(1)
  })

  test('does not require managed-corporation collection evidence for corporation deployments', async () => {
    mocks.results = [
      [
        reviewerOrganization({
          organizationType: 'corporation',
          managedCorporationsValidatedAt: null,
          managedCorporationsNextEligibleAt: null,
        }),
      ],
      [reviewerCharacter()],
      [],
      [],
      [],
      [{ organizationVersion: 7 }],
    ]

    await expect(
      resolveOrganizationReviewerTarget({ organizationVersion: 7, targetUserId, now }),
    ).resolves.not.toBeNull()
  })

  test('refuses an unclassified selected character before summary reads', async () => {
    mocks.results = [
      [reviewerOrganization()],
      [
        reviewerCharacter(),
        reviewerCharacter({
          characterId: 90_000_009,
          subjectLifecycleId: '00000000-0000-4000-8000-000000000009',
          name: 'Hidden Pilot',
          isMain: false,
          managedCorporationId: null,
          exceptionId: null,
        }),
      ],
    ]

    await expect(
      resolveOrganizationReviewerTarget({
        organizationVersion: 7,
        targetUserId,
        characterId: 90_000_009,
        now,
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
          characterId: 90_000_009,
          subjectLifecycleId: '00000000-0000-4000-8000-000000000009',
          name: 'Stale Pilot',
          isMain: false,
          affiliationCheckedAt: new Date('2026-09-16T10:00:00.000Z'),
          nextAffiliationCheck: new Date('2026-09-16T11:00:00.000Z'),
        }),
      ],
    ]

    await expect(
      resolveOrganizationReviewerTarget({
        organizationVersion: 7,
        targetUserId,
        characterId: 90_000_009,
        now,
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
      organizationVersion: 7,
      targetUserId,
      now,
    })

    expect(context?.compliance).toEqual({
      state: 'pending',
      evidenceFreshness: 'unavailable',
      evidenceAt: null,
      reviewDeadline: null,
      accessValidUntil: null,
      evaluatedAt: null,
    })
    expect(context?.groups).toEqual([])
    expect(context?.block).toEqual({ blocked: false })
  })

  test('fails closed when the active organization version changes during resolution', async () => {
    mocks.results = [...completeResults().slice(0, 5), []]

    await expect(
      resolveOrganizationReviewerTarget({ organizationVersion: 7, targetUserId, now }),
    ).resolves.toBeNull()
  })
})

function completeResults() {
  return [
    [reviewerOrganization()],
    [
      reviewerCharacter({
        encryptedToken: 'secret',
        scopes: ['private.scope'],
        authorizationGeneration: 9,
      }),
      reviewerCharacter({
        characterId: 90_000_002,
        subjectLifecycleId: externalLifecycleId,
        name: 'External Pilot',
        corporationId: 98_000_002,
        allianceId: null,
        isMain: false,
        affiliationCheckedAt: new Date('2026-09-16T10:00:00.000Z'),
        nextAffiliationCheck: new Date('2026-09-16T11:00:00.000Z'),
        managedCorporationId: null,
        exceptionId: '00000000-0000-4000-8000-000000000006',
        authorizationGeneration: 4,
      }),
      reviewerCharacter({
        characterId: 90_000_009,
        subjectLifecycleId: '00000000-0000-4000-8000-000000000009',
        name: 'Undisclosed Pilot',
        isMain: false,
        managedCorporationId: null,
        exceptionId: null,
      }),
    ],
    [
      {
        state: 'suspended',
        evidenceFreshness: 'stale',
        evidenceAt: new Date('2026-09-16T10:30:00.000Z'),
        reviewDeadline: null,
        accessValidUntil: null,
        evaluatedAt: new Date('2026-09-16T11:30:00.000Z'),
        issueCode: 'private-reason',
      },
    ],
    [
      {
        groupId: '00000000-0000-4000-8000-000000000010',
        assignmentId: '00000000-0000-4000-8000-000000000011',
        name: 'Registration complete',
        restricted: false,
        managementMode: 'manual',
        hasReviewerPermission: true,
        assignedAt: new Date('2026-09-01T12:00:00.000Z'),
        expiresAt: null,
        reason: 'private assignment reason',
        assignedByUserId: '00000000-0000-4000-8000-000000000012',
        permissionKey: 'private.permission',
      },
    ],
    [
      {
        blockedAt: new Date('2026-09-15T12:00:00.000Z'),
        reason: 'private block reason',
        blockedByUserId: '00000000-0000-4000-8000-000000000013',
      },
    ],
    [{ organizationVersion: 7 }],
  ]
}

function reviewerCharacter(overrides: Record<string, unknown> = {}) {
  return {
    characterId: 90_000_001,
    subjectLifecycleId: mainLifecycleId,
    authorizationGeneration: 9,
    managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
    name: 'Main Pilot',
    corporationId: 98_000_001,
    allianceId: 99_000_001,
    isMain: true,
    affiliationResolutionState: 'resolved',
    affiliationCheckedAt: new Date('2026-09-16T11:00:00.000Z'),
    nextAffiliationCheck: new Date('2026-09-16T13:00:00.000Z'),
    managedCorporationId: 98_000_001,
    exceptionId: null,
    ...overrides,
  }
}

function reviewerOrganization(overrides: Record<string, unknown> = {}) {
  return {
    organizationType: 'alliance',
    managedCorporationsValidatedAt: new Date('2026-09-16T11:00:00.000Z'),
    managedCorporationsNextEligibleAt: new Date('2026-09-16T13:00:00.000Z'),
    managedCorporationsLastFailureClass: null,
    managedCorporationsFailureStartedAt: null,
    ...overrides,
  }
}

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy'])
    builder[method] = () => builder
  builder.for = (...arguments_: unknown[]) => {
    mocks.lock(...arguments_)
    return builder
  }
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
